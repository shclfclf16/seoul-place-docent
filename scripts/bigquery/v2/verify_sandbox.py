"""Opt-in cloud read-only verification. Does not create views, tables or load data."""
import argparse
import json
from pathlib import Path
from load_zip_bigquery import table_plan, verify_names, validate_existing


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--project', required=True)
    p.add_argument('--dataset', required=True)
    p.add_argument('--location', default='asia-northeast3')
    p.add_argument('--max-bytes', type=int, default=100_000_000)
    p.add_argument('--execute-counts', action='store_true')
    p.add_argument('--confirm-read', required=True)
    args = p.parse_args()
    verify_names(args.project, args.dataset, args.location)
    if args.confirm_read != args.project + '.' + args.dataset: p.error('Confirm exact read target')
    if not 1 <= args.max_bytes <= 1_000_000_000: p.error('Byte budget must be 1..1 GB')
    from google.cloud import bigquery
    from google.api_core.exceptions import NotFound
    m = json.loads(Path(__file__).with_name('schema_manifest.json').read_text('utf-8'))
    sha = m['archive_sha256']
    print('READ_ONLY: checking ADC, dataset and six snapshots; no uploads', flush=True)
    client = bigquery.Client(project=args.project)
    if client.get_dataset(args.project + '.' + args.dataset, timeout=15, retry=None).location.lower() != args.location.lower():
        raise ValueError('Location mismatch')
    plan = table_plan(args.project, args.dataset, m, sha)
    queries = []
    missing = []
    for kind, item in plan.items():
        try:
            table = client.get_table(item['table_id'], timeout=15, retry=None)
        except NotFound:
            missing.append(kind)
            print('MISSING_SNAPSHOT', kind, flush=True)
            continue
        schema = [bigquery.SchemaField(c['name'], c['type']) for c in item['schema']]
        validate_existing(table, schema, item['row_count_expected'],
                          f'seoul-raw-v2 sha256={sha} file={kind}.csv; private unreviewed research')
        print(kind, 'rows=', table.num_rows, 'bytes=', table.num_bytes, 'expires=', table.expires)
        queries.append(f"SELECT '{kind}' AS kind, COUNT(*) AS rows, COUNTIF(_batch_sha256 != '{sha}' OR _batch_sha256 IS NULL) AS wrong_batch FROM `{item['table_id']}`")
    if missing:
        raise SystemExit('NOT_LOADED: ' + ', '.join(missing) + '; dry run/count checks not performed')
    sql = '\nUNION ALL\n'.join(queries)
    dry = client.query(sql, location=args.location, timeout=15, retry=None, job_config=bigquery.QueryJobConfig(dry_run=True, use_query_cache=False))
    print('Dry run bytes:', dry.total_bytes_processed)
    if dry.total_bytes_processed > args.max_bytes: raise ValueError('Query exceeds budget')
    if args.execute_counts:
        job = client.query(sql, location=args.location, timeout=15, retry=None, job_config=bigquery.QueryJobConfig(maximum_bytes_billed=args.max_bytes))
        rows = list(job.result(max_results=6, timeout=120))
        if len(rows) != 6: raise ValueError('Missing tables')
        for row in rows:
            if row.rows != m['files'][row.kind]['rows'] or row.wrong_batch: raise ValueError('Count/provenance mismatch')
        print('CLOUD_COUNTS_VERIFIED', sum(row.rows for row in rows))


if __name__ == '__main__': main()
