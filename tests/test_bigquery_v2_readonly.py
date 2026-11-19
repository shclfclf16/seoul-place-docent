"""Read-only legacy reuse, schema comparison, content framing and budget guards."""
import csv
import hashlib
import io
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace as NS
import unittest
from unittest.mock import Mock, patch
import zipfile

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts/bigquery/v2'))
import verify_sandbox as verify
from generate_views import gen_sql
from load_zip_bigquery import archive_sha256, row_sha256


class ReadOnlyTests(unittest.TestCase):
    def setUp(self):
        self.manifest=json.loads((ROOT/'scripts/bigquery/v2/schema_manifest.json').read_text('utf-8'))
        self.sha=self.manifest['archive_sha256']
        self.plan=verify.snapshot_plan('sample-project','private_dataset',self.manifest,True)

    def test_legacy_requires_explicit_option_and_preserves_full_provenance(self):
        full=verify.snapshot_plan('sample-project','private_dataset',self.manifest)
        for kind in verify.FILES:
            self.assertTrue(self.plan[kind]['table_id'].endswith(self.sha[:12]))
            self.assertTrue(full[kind]['table_id'].endswith(self.sha))
        queries=verify.verification_queries(self.plan,self.manifest)
        self.assertIn(self.sha,queries['content'])
        self.assertIn('source_values_digest',queries['content'])
        for sql in queries.values():
            for forbidden in ['CREATE ', 'INSERT ', 'UPDATE ', 'DELETE ', 'MERGE ', 'EXPORT ', 'COPY ']:
                self.assertNotIn(forbidden,sql)

    def test_schema_compares_types_modes_missing_extra_order(self):
        expected=[{'name':'id','type':'STRING'},{'name':'n','type':'INTEGER'}]
        actual=[NS(name='id',field_type='STRING',mode='NULLABLE'),NS(name='n',field_type='INT64',mode='NULLABLE')]
        self.assertTrue(verify.compare_schema(actual,expected)['compatible'])
        self.assertTrue(verify.compare_schema(actual[::-1],expected)['order_changed'])
        self.assertFalse(verify.compare_schema(actual[:1],expected)['compatible'])
        actual[0].mode='REPEATED'
        self.assertFalse(verify.compare_schema(actual,expected)['compatible'])
        actual[0].mode='NULLABLE'; actual[0].field_type='INTEGER'
        self.assertFalse(verify.compare_schema(actual,expected)['compatible'])

    def test_original_framing_is_lossless_and_hash_bound(self):
        manifest={'files':{},'archive_sha256':''}
        row={'a':'서울\n"\\','b':'  ','c':''}
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'original.zip'
            with zipfile.ZipFile(path,'w') as zf:
                for kind in verify.FILES:
                    manifest['files'][kind]={'columns':list(row),'rows':1}
                    stream=io.StringIO(newline=''); writer=csv.DictWriter(stream,fieldnames=list(row))
                    writer.writeheader(); writer.writerow(row); zf.writestr(kind+'.csv',stream.getvalue())
            manifest['archive_sha256']=archive_sha256(path)
            result=verify.original_digests(path,manifest)
            framed=''.join(f'{len(v.encode("utf-8"))}:{v}' for v in row.values())
            expected=hashlib.sha256(hashlib.sha256(framed.encode()).hexdigest().encode()).hexdigest()
            self.assertEqual(result['photos']['source_values_digest'],expected)
            manifest['archive_sha256']='0'*64
            with self.assertRaises(ValueError): verify.original_digests(path,manifest)

    def test_views_reuse_legacy_tables_without_renaming_views_or_approving(self):
        sql=gen_sql('sample-project','private_dataset',self.sha,True)
        self.assertIn(f'.rawv2_photos_{self.sha[:12]}`',sql)
        self.assertNotIn(f'.rawv2_photos_{self.sha}`',sql)
        self.assertIn(f'.v2_records_{self.sha}`',sql)
        self.assertIn('FALSE AS approved_for_public_use',sql)
        saved=(ROOT/'scripts/bigquery/v2/candidate_views.sql').read_text('utf-8')
        self.assertEqual(saved,gen_sql('seoul-place-docent-514906','seoul_history',self.sha,True))

    def test_live_result_validation_detects_mutated_values(self):
        rows=[]; originals={}
        for kind in verify.FILES:
            n=self.manifest['files'][kind]['rows']
            originals[kind]={'source_row_hash_digest':'ab01','source_values_digest':'cd23'}
            rows.append(dict(kind=kind,row_count=n,distinct_row_numbers=n,first_row=2,last_row=n+1,
                wrong_batch=0,wrong_filename=0,null_source_rows=0,invalid_row_hash=0,**originals[kind]))
        relation=dict(records=105869,duplicate_record_ids=0,blank_record_ids=0,duplicate_place_ids=0,
            blank_place_ids=0,missing_record_refs=0,missing_nonblank_place_refs=0,
            blank_link_place_ids=2,unsafe_blank_links=0,duplicate_link_pairs=2,
            relation_counts=json.dumps([{'relation_type':k,'n':n} for k,n in
                {'UNCERTAIN':81826,'DISTRICT_CONTEXT':79903,'NEARBY':1614,'EXACT_SITE':2}.items()]))
        report={'queries':{'content':{'rows':rows},'relations':{'rows':[relation]}}}
        verify.validate_results(report,originals,self.manifest)
        self.assertTrue(report['reusable'])
        rows[0]['source_values_digest']='changed'
        with self.assertRaisesRegex(ValueError,'source_values_digest mismatch'):
            verify.validate_results(report,originals,self.manifest)
        self.assertFalse(report['reusable'])

    def fake_cloud(self, estimates=(80,80), incompatible=False):
        client=Mock()
        client.get_dataset.return_value=NS(location='asia-northeast3')
        def table(name,**kwargs):
            item=next(v for v in self.plan.values() if v['table_id']==name)
            schema=[NS(name=c['name'],field_type=c['type'],mode='NULLABLE') for c in item['schema']]
            if incompatible: schema=schema[:-1]
            return NS(schema=schema,num_rows=item['row_count_expected'],num_bytes=1,table_type='TABLE',description=None,expires=None)
        client.get_table.side_effect=table
        client.query.side_effect=[NS(total_bytes_processed=n) for n in estimates]
        sdk=NS(Client=lambda **kw:client,QueryJobConfig=lambda **kw:NS(**kw))
        modules={'google':NS(),'google.cloud':NS(bigquery=sdk),'google.cloud.bigquery':sdk,
                 'google.api_core':NS(),'google.api_core.exceptions':NS(NotFound=KeyError)}
        args=NS(project='sample-project',dataset='private_dataset',location='asia-northeast3',legacy_hash_tables=True,
                metadata_only=False,max_bytes=100,execute_counts=True,zip=None)
        return client,modules,args

    def test_cumulative_budget_blocks_all_actual_queries(self):
        client,modules,args=self.fake_cloud()
        report={}
        with patch.dict(sys.modules,modules), self.assertRaisesRegex(ValueError,'Cumulative'):
            verify.run(args,report)
        self.assertEqual(client.query.call_count,2)
        self.assertTrue(all(c.kwargs['job_config'].dry_run for c in client.query.call_args_list))
        self.assertEqual(report['total_estimated_bytes'],160)
        self.assertFalse(any(q['executed'] for q in report['queries'].values()))

    def test_schema_mismatch_blocks_even_dry_runs(self):
        client,modules,args=self.fake_cloud(incompatible=True)
        with patch.dict(sys.modules,modules), self.assertRaisesRegex(ValueError,'Schema'):
            verify.run(args,{})
        client.query.assert_not_called()

    def test_metadata_only_uses_no_queries(self):
        client,modules,args=self.fake_cloud(); args.metadata_only=True
        with patch.dict(sys.modules,modules): verify.run(args,{})
        client.query.assert_not_called()


if __name__=='__main__': unittest.main()
