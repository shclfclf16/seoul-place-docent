"""Explicit read-only verification of full or legacy hash snapshots; no mutations."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile
from load_zip_bigquery import FILES, archive_sha256, iter_input, row_sha256, table_plan, verify_names


def snapshot_plan(project, dataset, manifest, legacy=False):
    verify_names(project, dataset, 'asia-northeast3')
    sha = manifest['archive_sha256']
    plan = table_plan(project, dataset, manifest, sha)
    if legacy:
        for kind, item in plan.items():
            item['table_id'] = f'{project}.{dataset}.rawv2_{kind}_{sha[:12]}'
    return plan


def compare_schema(actual, expected):
    def typ(value): return {'INT64': 'INTEGER'}.get(value.upper(), value.upper())
    wanted = {c['name']: typ(c['type']) for c in expected}
    found = {c.name: (typ(c.field_type), c.mode) for c in actual}
    missing = sorted(set(wanted) - set(found))
    extra = sorted(set(found) - set(wanted))
    changed = {k: {'expected': wanted[k], 'actual': found[k]} for k in wanted.keys() & found.keys()
               if found[k] != (wanted[k], 'NULLABLE')}
    return {'missing': missing, 'extra': extra, 'changed': changed,
            'order_changed': list(found) != list(wanted),
            'compatible': not (missing or extra or changed)}


def original_digests(path, manifest):
    if archive_sha256(path) != manifest['archive_sha256']: raise ValueError('Original ZIP hash mismatch')
    result = {}
    with zipfile.ZipFile(path) as zf:
        for kind in FILES:
            stored, values = hashlib.sha256(), hashlib.sha256()
            columns = manifest['files'][kind]['columns']
            for _, row in iter_input(zf, kind, columns):
                stored.update(row_sha256(row).encode('ascii'))
                framed = ''.join(f'{len(row[c].encode("utf-8"))}:{row[c]}' for c in columns)
                values.update(hashlib.sha256(framed.encode('utf-8')).hexdigest().encode('ascii'))
            result[kind] = {'source_row_hash_digest': stored.hexdigest(),
                            'source_values_digest': values.hexdigest()}
    return result


def verification_queries(plan, manifest):
    sha = manifest['archive_sha256']
    branches = []
    for kind, item in plan.items():
        columns = manifest['files'][kind]['columns']
        framed = ', '.join(f"CAST(BYTE_LENGTH(r.`{c}`) AS STRING), ':', r.`{c}`" for c in columns)
        nulls = ' OR '.join(f'r.`{c}` IS NULL' for c in columns)
        branches.append(f"""SELECT '{kind}' AS kind, COUNT(*) AS row_count,
 COUNTIF(_batch_sha256 IS NULL OR _batch_sha256 != '{sha}') AS wrong_batch,
 COUNTIF(_input_filename IS NULL OR _input_filename != '{kind}.csv') AS wrong_filename,
 COUNT(DISTINCT _input_row_number) AS distinct_row_numbers,
 MIN(_input_row_number) AS first_row, MAX(_input_row_number) AS last_row,
 COUNTIF({nulls}) AS null_source_rows,
 COUNTIF(_row_sha256 IS NULL OR NOT REGEXP_CONTAINS(_row_sha256, r'^[0-9a-f]{{64}}$')) AS invalid_row_hash,
 TO_HEX(SHA256(STRING_AGG(_row_sha256, '' ORDER BY _input_row_number))) AS source_row_hash_digest,
 TO_HEX(SHA256(STRING_AGG(TO_HEX(SHA256(CONCAT({framed}))), '' ORDER BY _input_row_number))) AS source_values_digest
 FROM `{item['table_id']}` r""")
    records = ' UNION ALL '.join(f"SELECT record_id FROM `{plan[k]['table_id']}`" for k in FILES[:4])
    relations = f"""WITH records AS ({records}),
 places AS (SELECT place_id FROM `{plan['places']['table_id']}`),
 links AS (SELECT record_id, place_id, relation_type FROM `{plan['record_place_links']['table_id']}`)
 SELECT (SELECT COUNT(*) FROM records) AS records,
 (SELECT COUNT(*)-COUNT(DISTINCT record_id) FROM records) AS duplicate_record_ids,
 (SELECT COUNTIF(record_id IS NULL OR record_id='') FROM records) AS blank_record_ids,
 (SELECT COUNT(*)-COUNT(DISTINCT place_id) FROM places) AS duplicate_place_ids,
 (SELECT COUNTIF(place_id IS NULL OR place_id='') FROM places) AS blank_place_ids,
 (SELECT COUNT(*) FROM links l WHERE NOT EXISTS (SELECT 1 FROM records r WHERE r.record_id=l.record_id)) AS missing_record_refs,
 (SELECT COUNT(*) FROM links l WHERE NULLIF(l.place_id,'') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM places p WHERE p.place_id=l.place_id)) AS missing_nonblank_place_refs,
 (SELECT COUNTIF(place_id IS NULL OR place_id='') FROM links) AS blank_link_place_ids,
 (SELECT COUNTIF((place_id IS NULL OR place_id='') AND relation_type!='UNCERTAIN') FROM links) AS unsafe_blank_links,
 (SELECT COALESCE(SUM(n-1),0) FROM (SELECT COUNT(*) n FROM links GROUP BY record_id,place_id)) AS duplicate_link_pairs,
 (SELECT TO_JSON_STRING(ARRAY_AGG(t ORDER BY relation_type)) FROM (SELECT relation_type, COUNT(*) AS n FROM links GROUP BY relation_type) t) AS relation_counts"""
    return {'content': '\nUNION ALL\n'.join(branches), 'relations': relations}


def run(args, report):
    from google.cloud import bigquery
    from google.api_core.exceptions import NotFound
    manifest = json.loads(Path(__file__).with_name('schema_manifest.json').read_text('utf-8'))
    plan = snapshot_plan(args.project, args.dataset, manifest, args.legacy_hash_tables)
    client = bigquery.Client(project=args.project)
    ds = client.get_dataset(f'{args.project}.{args.dataset}', timeout=20, retry=None)
    report['dataset_location'] = ds.location
    if ds.location.lower() != args.location.lower(): raise ValueError('Location mismatch')
    report['tables'] = {}
    for kind, item in plan.items():
        try: table = client.get_table(item['table_id'], timeout=20, retry=None)
        except NotFound:
            report['tables'][kind] = {'exists': False, 'table_id': item['table_id']}
            continue
        comparison = compare_schema(table.schema, item['schema'])
        report['tables'][kind] = {'exists': True, 'table_id': item['table_id'],
            'metadata_rows': table.num_rows, 'bytes': table.num_bytes,
            'table_type': table.table_type, 'schema_comparison': comparison,
            'description': table.description, 'expires': str(table.expires)}
    if any(not t['exists'] or t['table_type'] != 'TABLE' or not t['schema_comparison']['compatible']
           for t in report['tables'].values()): raise ValueError('Schema/existence mismatch; no queries executed')
    report['schema_reusable'] = True
    if args.metadata_only: return
    queries = verification_queries(plan, manifest)
    report['queries'] = {}
    total = 0
    # All dry runs must pass the cumulative budget before ANY actual query.
    for name, sql in queries.items():
        dry = client.query(sql, location=args.location, timeout=20, retry=None,
            job_config=bigquery.QueryJobConfig(dry_run=True, use_query_cache=False))
        estimate = dry.total_bytes_processed
        total += estimate
        report['queries'][name] = {'estimated_bytes': estimate, 'executed': False}
    report['total_estimated_bytes'] = total
    if total > args.max_bytes: raise ValueError('Cumulative dry run estimate exceeds budget; no actual queries')
    if not args.execute_counts: return
    if not args.zip: raise ValueError('--zip required to verify original content')
    originals = original_digests(args.zip, manifest)
    report['original_zip_sha256_verified'] = manifest['archive_sha256']
    remaining = args.max_bytes
    for name, sql in queries.items():
        job = client.query(sql, location=args.location, timeout=20, retry=None,
            job_config=bigquery.QueryJobConfig(maximum_bytes_billed=remaining, use_query_cache=False))
        rows = [dict(row) for row in job.result(timeout=180, max_results=6)]
        report['queries'][name].update(executed=True, job_id=job.job_id, rows=rows,
            processed_bytes=job.total_bytes_processed, billed_bytes=job.total_bytes_billed)
        remaining -= job.total_bytes_billed or 0
        if remaining < 0: raise ValueError('Cumulative billing budget exhausted')
    validate_results(report, originals, manifest)


def validate_results(report, originals, manifest):
    errors = []
    content = report['queries']['content']['rows']
    if len(content) != 6: errors.append('Expected six content result rows')
    for row in content:
        kind = row['kind']; expected = manifest['files'][kind]['rows']
        for key in ('wrong_batch','wrong_filename','null_source_rows','invalid_row_hash'):
            if row[key] != 0: errors.append(f'{kind}: {key}={row[key]}')
        if (row['row_count'], row['distinct_row_numbers'], row['first_row'], row['last_row']) != (expected,expected,2,expected+1):
            errors.append(f'{kind}: counts/row numbers mismatch')
        for key,value in originals[kind].items():
            if row[key] != value: errors.append(f'{kind}: {key} mismatch')
    relation = report['queries']['relations']['rows'][0]
    expected = {'records':105869,'duplicate_record_ids':0,'blank_record_ids':0,'duplicate_place_ids':0,
        'blank_place_ids':0,'missing_record_refs':0,'missing_nonblank_place_refs':0,
        'blank_link_place_ids':2,'unsafe_blank_links':0,'duplicate_link_pairs':2}
    for key,value in expected.items():
        if relation[key] != value: errors.append(f'relations: {key}={relation[key]}')
    counts = {r['relation_type']:r['n'] for r in json.loads(relation['relation_counts'])}
    if counts != {'UNCERTAIN':81826,'DISTRICT_CONTEXT':79903,'NEARBY':1614,'EXACT_SITE':2}:
        errors.append('Relation distribution mismatch')
    report['validation_errors'] = errors
    report['reusable'] = not errors
    if errors: raise ValueError('; '.join(errors))


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--project',required=True); p.add_argument('--dataset',required=True)
    p.add_argument('--location',default='asia-northeast3')
    p.add_argument('--legacy-hash-tables',action='store_true',help='Explicitly read the 12-character ZIP hash names; never auto-fallback')
    p.add_argument('--metadata-only',action='store_true')
    p.add_argument('--max-bytes',type=int,default=100_000_000)
    p.add_argument('--execute-counts',action='store_true',help='Execute bounded content and integrity SELECTs')
    p.add_argument('--zip',type=Path)
    p.add_argument('--report',type=Path,required=True)
    p.add_argument('--confirm-read',required=True)
    args=p.parse_args()
    verify_names(args.project,args.dataset,args.location)
    if args.confirm_read != f'{args.project}.{args.dataset}': p.error('Confirm exact read target')
    if not 1 <= args.max_bytes <= 1_000_000_000: p.error('Budget must be 1..1 GB')
    report={'mode':'READ_ONLY','legacy_hash_tables':args.legacy_hash_tables,'budget_bytes':args.max_bytes}
    try: run(args,report)
    except Exception as error:
        report['error']=str(error)
    args.report.parent.mkdir(parents=True,exist_ok=True)
    args.report.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False,indent=2),flush=True)
    if 'error' in report: raise SystemExit(1)


if __name__=='__main__': main()
