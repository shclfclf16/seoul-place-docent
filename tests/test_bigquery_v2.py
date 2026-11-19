import copy
import importlib
import json
import os
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
from types import SimpleNamespace as NS
import unittest
from unittest.mock import Mock, patch
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts/bigquery/v2'))
from load_zip_bigquery import *
from audit_snapshot import audit
from generate_views import gen_sql
from approval_gate import eligible

class Missing(Exception): pass
class Conflict(Exception): pass

class PipelineTests(unittest.TestCase):
    def setUp(self):
        self.manifest = load_manifest(ROOT / 'scripts/bigquery/v2/schema_manifest.json')
        self.sha = self.manifest['archive_sha256']

    def test_plan_and_views_are_isolated(self):
        plan = table_plan('sample-project', 'private_dataset', self.manifest, self.sha)
        self.assertEqual(len(plan), 6)
        self.assertEqual(sum(p['row_count_expected'] for p in plan.values()), 291520)
        for item in plan.values():
            self.assertTrue(item['table_id'].endswith(self.sha))
            self.assertTrue(all(c['type'] == 'STRING' for c in item['schema'][:-4]))
        sql = gen_sql('sample-project', 'private_dataset', self.sha)
        for field in ['segments_json', 'thumbnail_url', 'playback_review_status', 'rights_status',
                      'review_status', 'display_permission', 'embed_permission', 'storage_permission']:
            self.assertIn(field, sql)
        self.assertIn('FALSE AS approved_for_public_use', sql)
        self.assertNotIn('CREATE OR REPLACE', sql)
        self.assertNotIn('media_extra', sql)
        with self.assertRaises(ValueError): gen_sql('sample-project', 'x', "';DROP TABLE x")

    def test_existing_snapshot_requires_provenance(self):
        schema = [NS(name='id', field_type='STRING')]
        table = NS(schema=schema, num_rows=1, description='ours', table_type='TABLE')
        validate_existing(table, schema, 1, 'ours')
        for field, value in [('num_rows', 2), ('description', 'foreign'), ('table_type', 'VIEW')]:
            bad = copy.copy(table); setattr(bad, field, value)
            with self.assertRaises(RuntimeError): validate_existing(bad, schema, 1, 'ours')

    def test_failed_job_advances_pending_job_reconciles(self):
        with TemporaryDirectory() as tmp:
            path = Path(tmp)/'rows'; path.write_text('{}')
            failed = NS(destination='p.d.t', write_disposition='WRITE_EMPTY', state='DONE', error_result={'reason':'failed'})
            done = Mock(destination='p.d.t', write_disposition='WRITE_EMPTY', state='RUNNING', error_result=None)
            client = Mock(); client.get_job.side_effect = [failed, done]
            self.assertIs(resume_load(client,path,'p.d.t',None,'prefix','US',Missing,Conflict), done)
            client.load_table_from_file.assert_not_called()
            done.result.assert_called_once()
            self.assertEqual(client.get_job.call_args.args[0], 'prefix_1')

    def test_conflict_reconciles_same_job(self):
        with TemporaryDirectory() as tmp:
            path=Path(tmp)/'rows'; path.write_text('{}')
            done=Mock(destination='p.d.t',write_disposition='WRITE_EMPTY',state='DONE',error_result=None)
            client=Mock(); client.get_job.side_effect=[Missing(), done]
            client.load_table_from_file.side_effect=Conflict()
            resume_load(client,path,'p.d.t',None,'prefix','US',Missing,Conflict)
            self.assertEqual(client.load_table_from_file.call_args.kwargs['job_id'],'prefix_0')

    def test_unknown_network_outcome_does_not_start_another_job(self):
        with TemporaryDirectory() as tmp:
            path=Path(tmp)/'rows'; path.write_text('{}')
            client=Mock(); client.get_job.side_effect=Missing()
            client.load_table_from_file.side_effect=TimeoutError()
            with self.assertRaises(TimeoutError): resume_load(client,path,'p.d.t',None,'prefix','US',Missing,Conflict)
            self.assertEqual(client.load_table_from_file.call_count,1)

    def test_approval_bound_to_rows_action_and_review(self):
        record={'record_id':'r','record_type':'VIDEO','source_url':'https://example.org/r','_batch_sha256':self.sha,'_row_sha256':'rhash'}
        place={'place_id':'p','_batch_sha256':self.sha,'_row_sha256':'phash'}
        link={'record_id':'r','place_id':'p','relation_type':'EXACT_SITE','_batch_sha256':self.sha,'_row_sha256':'lhash'}
        self.assertFalse(eligible(record,place,link,{}))
        evidence={'status':'VERIFIED','evidence_url':'https://example.org/e'}
        review={'state':'APPROVED','reviewer_id':'person','review_id':'review1',
                'reviewed_at':'2026-01-01T00:00:00+00:00','expires_at':'2099-01-01T00:00:00+00:00',
                'checks':{key:evidence for key in ['human_review','original_source','rights','place','relation']},
                'permissions':{'metadata':{'status':'ALLOWED','evidence_url':'https://example.org/license'}},
                'verified_location':{'address':'verified address','latitude':37,'longitude':127,'evidence_url':'https://example.org/location'}}
        for name,row in [('record',record),('place',place),('link',link)]:
            for key in ['_batch_sha256','_row_sha256']: review[name+key]=row[key]
        self.assertTrue(eligible(record,place,link,review))
        self.assertFalse(eligible(record,place,link,review,'embed'))
        for mutate in [lambda r:r.update(state='REVOKED'),lambda r:r.update(verified_location={}),
                       lambda r:r.update(record_row_sha256='changed'),lambda r:r.update(expires_at='2020-01-01T00:00:00+00:00')]:
            bad=copy.deepcopy(review); mutate(bad)
            self.assertFalse(eligible(record,place,link,bad))

    def test_full_and_partial_load_failure_resume_without_duplicates(self):
        import csv
        import io
        for fail_kind in ('documents', 'news'):
            with self.subTest(fail_kind=fail_kind), TemporaryDirectory() as tmp:
                manifest=copy.deepcopy(self.manifest)
                source=Path(tmp)/'fixture.zip'
                with zipfile.ZipFile(source,'w') as zf:
                    for kind in FILES:
                        columns=manifest['files'][kind]['columns']
                        manifest['files'][kind]['rows']=1
                        row=dict.fromkeys(columns,'')
                        if kind in FILES[:4]: row['record_id']=kind
                        elif kind=='places': row['place_id']='place'
                        else: row.update(record_id='documents',place_id='place',relation_type='UNCERTAIN')
                        out=io.StringIO(newline=''); writer=csv.DictWriter(out,fieldnames=columns)
                        writer.writeheader(); writer.writerow(row); zf.writestr(kind+'.csv',out.getvalue())
                digest=archive_sha256(source)
                plan=table_plan('sample-project','private_dataset',manifest,digest)
                tables, jobs, loads = {}, {}, []
                def get_table(name):
                    if name not in tables: raise Missing()
                    return tables[name]
                def get_job(name,**kw):
                    if name not in jobs: raise Missing()
                    return jobs[name]
                def load(stream, destination, **kw):
                    cfg=kw['job_config']; jid=kw['job_id']
                    payload=[json.loads(line) for line in stream]
                    self.assertEqual(cfg.write_disposition,'WRITE_EMPTY')
                    self.assertEqual(len(payload),1)
                    job=NS(destination=destination,write_disposition='WRITE_EMPTY',state='RUNNING',error_result=None,job_id=jid)
                    def finish(**unused):
                        job.state='DONE'
                        if f'_{fail_kind}_0' in jid:
                            job.error_result={'reason':'backendError'}
                            raise RuntimeError('simulated terminal failure')
                        self.assertNotIn(destination,tables)
                        tables[destination]=NS(schema=cfg.schema,num_rows=1,description=cfg.destination_table_description,table_type='TABLE')
                    job.result=finish; jobs[jid]=job; loads.append(jid)
                    return job
                client=NS(get_dataset=lambda _:NS(location='US'), get_table=get_table,
                          get_job=get_job,load_table_from_file=load)
                sdk=NS(Client=lambda **_:client,SchemaField=lambda name,typ:NS(name=name,field_type=typ),
                       LoadJobConfig=lambda **kw:NS(**kw), SourceFormat=NS(NEWLINE_DELIMITED_JSON='JSON'),
                       CreateDisposition=NS(CREATE_IF_NEEDED='CREATE_IF_NEEDED'),WriteDisposition=NS(WRITE_EMPTY='WRITE_EMPTY'))
                modules={'google':NS(),'google.cloud':NS(bigquery=sdk), 'google.cloud.bigquery':sdk,
                         'google.api_core':NS(),'google.api_core.exceptions':NS(NotFound=Missing,Conflict=Conflict)}
                with patch.dict(sys.modules,modules), zipfile.ZipFile(source) as zf:
                    with self.assertRaises(RuntimeError): do_apply(zf,manifest,digest,plan,'sample-project','private_dataset','US')
                    do_apply(zf,manifest,digest,plan,'sample-project','private_dataset','US')
                    do_apply(zf,manifest,digest,plan,'sample-project','private_dataset','US')
                self.assertEqual(len(tables),6)
                self.assertEqual(len(loads),7)
                self.assertEqual(len(set(loads)),7)

    @unittest.skipUnless(os.environ.get('RAW_V2_ZIP'), 'Set RAW_V2_ZIP for real six-file full audit')
    def test_actual_six_files_full_roundtrip(self):
        path=Path(os.environ['RAW_V2_ZIP'])
        self.assertEqual(archive_sha256(path),self.sha)
        with zipfile.ZipFile(path) as zf: result=audit(zf,self.manifest,self.sha,roundtrip=True)
        self.assertEqual([result[k] for k in ['records','places','links','total_rows']],[105869,22306,163345,291520])
        self.assertEqual(result['relation_counts'],{'UNCERTAIN':81826,'DISTRICT_CONTEXT':79903,'NEARBY':1614,'EXACT_SITE':2})
        self.assertEqual(result['blank_place_ids'],2); self.assertEqual(result['duplicate_link_pairs'],2)
        for key in ['road_address','jibun_address','latitude','longitude']:
            self.assertEqual(result['files']['places']['blank'][key],22306)
        for stats in result['files'].values(): self.assertFalse(stats['invalid_json'])

if __name__=='__main__': unittest.main()
