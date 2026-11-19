#!/usr/bin/env python3
"""Safe, append-nothing-to-production, six-CSV BigQuery raw snapshot loader.

Uses one deterministic, content-addressed NEW table per uploaded CSV. Default is
local-only. The --apply action needs an explicit confirmation and Google ADC.
The existing historical_records / places / record_place_links are NEVER touched.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import os
import re
import sys
import tempfile
import zipfile
from pathlib import Path

csv.field_size_limit(2**31 - 1)
FILES = ("documents", "news", "photos", "videos", "places", "record_place_links")
EXTRA_SCHEMA = (
    ("_batch_sha256", "STRING"),
    ("_input_filename", "STRING"),
    ("_input_row_number", "INTEGER"),
    ("_row_sha256", "STRING"),
)
SAFE_NAME = re.compile(r"^[A-Za-z_][A-Za-z_0-9]{0,1023}$")
SAFE_PROJECT = re.compile(r"^[a-z][a-z0-9-]{4,28}[a-z0-9]$")


def archive_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(4 * 1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def load_manifest(path: Path) -> dict:
    return json.loads(path.read_text(encoding='utf-8'))


def verify_names(project: str, dataset: str, location: str):
    if not SAFE_PROJECT.fullmatch(project):
        raise ValueError('Invalid BigQuery project ID')
    if not SAFE_NAME.fullmatch(dataset):
        raise ValueError('Invalid BigQuery dataset ID')
    if not re.fullmatch(r'[a-z0-9-]{1,64}', location, re.I):
        raise ValueError('Invalid location')


def bq_table_name(kind: str, batch_sha: str) -> str:
    if kind not in FILES or not re.fullmatch(r'[a-f0-9]{64}', batch_sha):
        raise ValueError('Invalid snapshot identity')
    return f'rawv2_{kind}_{batch_sha}'


def bq_schema_fields(columns: list[str]) -> list[tuple[str, str]]:
    if len(columns) != len(set(columns)) or not columns:
        raise ValueError('Duplicate or empty CSV column names')
    if any(not SAFE_NAME.fullmatch(name) for name in columns):
        raise ValueError('Invalid CSV column name')
    if any(name in {x[0] for x in EXTRA_SCHEMA} for name in columns):
        raise ValueError('Input overlaps reserved metadata columns')
    return [(name, 'STRING') for name in columns] + list(EXTRA_SCHEMA)


def iter_input(zf: zipfile.ZipFile, kind: str, columns: list[str]):
    with zf.open(f'{kind}.csv') as raw:
        text = io.TextIOWrapper(raw, encoding='utf-8-sig', newline='')
        reader = csv.DictReader(text, strict=True)
        if reader.fieldnames != columns:
            raise ValueError(f'{kind}.csv header mismatch: actual {reader.fieldnames!r}')
        for row_no, row in enumerate(reader, 2):
            if None in row or any(value is None for value in row.values()):
                raise ValueError(f'{kind}.csv has incorrect column count at CSV record {row_no}')
            # All string fields, INCLUDING JSON columns and whitespace, are kept as provided.
            yield row_no, row


def row_sha256(row: dict) -> str:
    value = json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
    return hashlib.sha256(value.encode('utf-8')).hexdigest()


def stream_jsonl(zf: zipfile.ZipFile, kind: str, manifest: dict, batch_sha: str,
                 path: Path, limit: int | None = None) -> tuple[int, int]:
    fields = manifest['files'][kind]['columns']
    count = 0
    with path.open('w', encoding='utf-8', newline='\n') as f:
        for row_no, row in iter_input(zf, kind, fields):
            data = dict(row)
            data['_batch_sha256'] = batch_sha
            data['_input_filename'] = f'{kind}.csv'
            data['_input_row_number'] = row_no
            data['_row_sha256'] = row_sha256(row)
            f.write(json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n')
            count += 1
            if limit is not None and count >= limit:
                break
    return count, path.stat().st_size


def header_check(zf: zipfile.ZipFile, manifest: dict):
    expected = {f'{x}.csv' for x in FILES}
    if len(zf.namelist()) != 6 or set(zf.namelist()) != expected:
        raise ValueError(f'Archive must have only the six expected root CSV files: {sorted(expected)}')
    for kind in FILES:
        with zf.open(f'{kind}.csv') as raw:
            reader = csv.reader(io.TextIOWrapper(raw, encoding='utf-8-sig', newline=''))
            head = next(reader)
        expected_columns = manifest['files'][kind]['columns']
        if head != expected_columns:
            raise ValueError(f'Header mismatch: {kind}.csv')
        bq_schema_fields(head)


def table_plan(project: str, dataset: str, manifest: dict, digest: str):
    return {
        k: {
            'table_id': f'{project}.{dataset}.{bq_table_name(k, digest)}',
            'row_count_expected': manifest['files'][k]['rows'],
            'schema': [{'name': name, 'type': typ} for name, typ in bq_schema_fields(manifest['files'][k]['columns'])],
        } for k in FILES
    }


def validate_existing(table, schema, expected, description):
    actual = [(f.name, f.field_type.upper()) for f in table.schema]
    wanted = [(f.name, f.field_type.upper()) for f in schema]
    if (actual != wanted or table.num_rows != expected
            or table.description != description or table.table_type != 'TABLE'):
        raise RuntimeError('Existing snapshot differs in schema/count/provenance/type; refusing overwrite')


def resume_load(client, path, table_id, config, job_prefix, location, not_found, conflict):
    # A failed job ID cannot be reused. Only advance after a known terminal failure.
    # Unknown network outcomes propagate: the next invocation reconciles the same ID.
    for attempt in range(20):
        job_id = f'{job_prefix}_{attempt}'
        try:
            job = client.get_job(job_id, location=location)
        except not_found:
            try:
                with path.open('rb') as stream:
                    job = client.load_table_from_file(
                        stream, table_id, rewind=True, size=path.stat().st_size,
                        job_config=config, job_id=job_id, location=location)
            except conflict:
                job = client.get_job(job_id, location=location)
        if str(job.destination) != table_id or job.write_disposition != 'WRITE_EMPTY':
            raise RuntimeError('Job identity/configuration mismatch')
        if job.state == 'DONE' and job.error_result:
            continue
        job.result(timeout=1800)
        return job
    raise RuntimeError('20 failed attempts; manual investigation required')


def do_apply(zf, manifest, digest, plan, project, dataset, location):
    from google.cloud import bigquery
    from google.api_core.exceptions import NotFound, Conflict
    # All six files must pass local validation before the first network operation.
    from audit_snapshot import audit
    audit(zf, manifest, digest)
    client = bigquery.Client(project=project)
    dataset_meta = client.get_dataset(f'{project}.{dataset}')
    if str(dataset_meta.location).lower() != location.lower():
        raise ValueError('Dataset location mismatch')
    for kind in FILES:
        table_id = plan[kind]['table_id']
        expected = plan[kind]['row_count_expected']
        schema = [bigquery.SchemaField(c['name'], c['type']) for c in plan[kind]['schema']]
        description = f'seoul-raw-v2 sha256={digest} file={kind}.csv; private unreviewed research'
        try:
            existing = client.get_table(table_id)
        except NotFound:
            existing = None
        if existing is not None:
            # A failed atomic load may leave an empty destination. Only an owned,
            # schema-identical empty snapshot is eligible for a fresh load job.
            validate_existing(existing, schema, expected if existing.num_rows else 0, description)
            if existing.num_rows == expected:
                print(f'SKIP verified snapshot: {kind}', flush=True)
                continue
        with tempfile.TemporaryDirectory(prefix='seoul_bq_v2_') as temporary:
            path = Path(temporary) / f'{kind}.jsonl'
            rows, size = stream_jsonl(zf, kind, manifest, digest, path)
            if rows != expected:
                raise RuntimeError('Row count mismatch')
            cfg = bigquery.LoadJobConfig(
                schema=schema,
                source_format=bigquery.SourceFormat.NEWLINE_DELIMITED_JSON,
                create_disposition=bigquery.CreateDisposition.CREATE_IF_NEEDED,
                write_disposition=bigquery.WriteDisposition.WRITE_EMPTY,
                destination_table_description=description,
                max_bad_records=0, ignore_unknown_values=False)
            job = resume_load(client, path, table_id, cfg,
                              f'seoulv2_{dataset}_{digest}_{kind}', location, NotFound, Conflict)
            validate_existing(client.get_table(table_id), schema, expected, description)
            print(f'OK {kind}: {rows} rows, job={job.job_id}', flush=True)
    print('Six raw snapshots verified. No views or public data were modified.')


def main():
    parser = argparse.ArgumentParser(description='Strict six-CSV staging ingest, no default BigQuery writes')
    parser.add_argument('--zip', required=True, type=Path, help='Path to raw_data(1).zip')
    parser.add_argument('--manifest', type=Path, default=Path(__file__).with_name('schema_manifest.json'))
    parser.add_argument('--project', default='seoul-place-docent-514906')
    parser.add_argument('--dataset', default='seoul_history')
    parser.add_argument('--location', default='asia-northeast3')
    parser.add_argument('--plan-out', type=Path, help='Write exact table plan JSON')
    parser.add_argument('--sample-out-dir', type=Path, help='Emit 3 actual source rows per file to JSONL, locally only')
    parser.add_argument('--apply', action='store_true', help='Write six *new* immutable staging tables')
    parser.add_argument('--confirm', default='', help='Required project.dataset:SHA256 to apply')
    args = parser.parse_args()
    verify_names(args.project, args.dataset, args.location)
    if not args.zip.is_file():
        parser.error(f'ZIP file not found: {args.zip}')
    manifest = load_manifest(args.manifest)
    digest = archive_sha256(args.zip)
    if digest != manifest['archive_sha256']:
        parser.error('Archive checksum differs from audited upload. Regenerate audit/schema after inspecting changed source.')
    if args.apply and args.confirm != f'{args.project}.{args.dataset}:{digest}':
        parser.error('Upload requires explicit confirmation of project.dataset:SHA256')
    with zipfile.ZipFile(args.zip) as zf:
        header_check(zf, manifest)
        plan = table_plan(args.project, args.dataset, manifest, digest)
        print(json.dumps({'archive_sha256': digest, 'staging_tables':
              {k: {'table_id': v['table_id'], 'rows': v['row_count_expected']}
               for k, v in plan.items()}, 'action': 'APPLY_RAW_ONLY' if args.apply else 'NO_WRITES'},
                         indent=2, ensure_ascii=False))
        if args.plan_out:
            args.plan_out.parent.mkdir(parents=True, exist_ok=True)
            args.plan_out.write_text(json.dumps(plan, ensure_ascii=False, indent=2), encoding='utf-8')
        if args.sample_out_dir:
            args.sample_out_dir.mkdir(parents=True, exist_ok=True)
            for kind in FILES:
                p = args.sample_out_dir / f'{kind}.sample.jsonl'
                n, size = stream_jsonl(zf, kind, manifest, digest, p, limit=3)
                print(f'LOCAL SAMPLE {kind}: {n} rows, {size} bytes')
        if args.apply:
            do_apply(zf, manifest, digest, plan, args.project, args.dataset, args.location)
        else:
            print('Verified structure; no Google Cloud requests or writes performed.')


if __name__ == '__main__':
    main()
