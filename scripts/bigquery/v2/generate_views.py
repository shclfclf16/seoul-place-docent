#!/usr/bin/env python3
"""Generate independent read-only candidate views SQL; never apply it automatically."""
import argparse
import json
from pathlib import Path
from load_zip_bigquery import FILES, verify_names, bq_table_name

CORE = [
 'record_id', 'record_title', 'record_type', 'source_institution', 'institution_record_id',
 'source_url', 'summary', 'created_date_raw', 'created_year', 'published_date_raw',
 'published_date', 'historical_period_raw', 'subject_start_year', 'subject_end_year',
 'historical_place_name', 'review_status', 'rights_status', 'rights_evidence_url',
 'attribution', 'checked_date', 'duplicate_status', 'record_origin', 'original_ids_json',
 'source_locations_json', 'original_metadata_json', 'classification_status',
 'identity_status', 'source_url_kind', 'cleaning_issues_json', 'field_conflicts_json'
]


def gen_sql(project, dataset, sha):
    verify_names(project, dataset, 'asia-northeast3')
    bq_table_name('documents', sha)
    batch=sha
    full=lambda name: f'`{project}.{dataset}.{name}`'
    raw=lambda typ: full(f'rawv2_{typ}_{batch}')
    view=lambda name:full(f'v2_{name}_{batch}')
    queries=[]
    branches=[]
    for typ in ('documents','news','photos','videos'):
        cols = [f'r.{f}' if f not in {'created_year','subject_start_year','subject_end_year'} else f'SAFE_CAST(NULLIF(r.{f}, \'\') AS INT64) AS {f}' for f in CORE]
        nullable=lambda field: f'r.{field}' if field else 'CAST(NULL AS STRING)'
        fields = json.loads(Path(__file__).with_name('schema_manifest.json').read_text('utf-8'))['files'][typ]['columns']
        media_field = {'documents':'document_file_url', 'news':'original_scan_url',
                       'photos':'image_url', 'videos':'video_url'}[typ]
        # Never merge review, display, storage, embed or thumbnail permissions.
        special = ['thumbnail_url', 'playback_review_status', 'image_review_status',
                   'segments_json', 'embed_url', 'embed_permission', 'display_permission',
                   'thumbnail_permission', 'storage_permission', 'modification_permission',
                   'original_access_status', 'access_status']
        cols += [f"'{typ}' AS source_file_type", f'r.{media_field} AS media_url']
        cols += [f'r.{field}' if field in fields else f'CAST(NULL AS STRING) AS {field}'
                 for field in special]
        cols += ['TO_JSON_STRING(r) AS source_row_json',
                 'r._batch_sha256 AS batch_sha256',
                 'r._input_row_number AS input_row_number',
                 'r._row_sha256 AS row_sha256',
                 'FALSE AS approved_for_public_use', 'FALSE AS may_embed',
                 'FALSE AS may_display', 'FALSE AS may_store']
        branches.append('SELECT\n  '+',\n  '.join(cols)+'\nFROM '+raw(typ)+' AS r')
    queries.append('CREATE VIEW IF NOT EXISTS '+view('records')+' AS\n'+'\nUNION ALL\n'.join(branches)+';')
    queries.append('''CREATE VIEW IF NOT EXISTS %s AS
SELECT p.*,
  SAFE_CAST(NULLIF(p.latitude, '') AS FLOAT64) AS latitude_value,
  SAFE_CAST(NULLIF(p.longitude, '') AS FLOAT64) AS longitude_value,
  FALSE AS approved_location
FROM %s AS p;'''%(view('places'),raw('places')))
    queries.append('''CREATE VIEW IF NOT EXISTS %s AS
SELECT l.*,
  FALSE AS approved_relation
FROM %s AS l;'''%(view('links'),raw('record_place_links')))
    queries.append('''CREATE VIEW IF NOT EXISTS %s AS
SELECT
  l.record_id, l.place_id, l.relation_type, l.link_review_status,
  l.relation_evidence, l.evidence_url,
  r.record_title, r.record_type, r.source_institution, r.source_url,
  r.review_status, r.rights_status, r.media_url,
  r.playback_review_status, r.image_review_status, r.source_file_type,
  p.place_name, p.place_type, p.district, p.legal_dong,
  p.location_review_status, p.road_address, p.jibun_address,
  CASE WHEN r.record_id IS NULL THEN 'MISSING_RECORD'
       WHEN l.place_id IS NULL OR l.place_id = '' THEN 'EMPTY_PLACE_ID'
       WHEN p.place_id IS NULL THEN 'MISSING_PLACE'
       WHEN l.relation_type = 'EXACT_SITE' THEN 'UNVERIFIED_EXACT_SITE'
       ELSE 'REVIEW_REQUIRED' END AS audit_state,
  FALSE AS approved_for_public_use
FROM %s l
LEFT JOIN %s r ON r.record_id=l.record_id
LEFT JOIN %s p ON p.place_id=l.place_id;'''%(view('relation_audit'),view('links'),view('records'),view('places')))
    summary=f'''-- NOTE: Only private reviewer/admin read access. No public MCP, no auto-approval.
-- ZIP SHA256: {sha}
-- Dataset: {project}.{dataset}
-- The four views below are intentionally named with the input ZIP hash.
-- They do not replace historical_records / places / record_place_links.

'''
    return summary+'\n\n'.join(queries)+'\n'


def audit_sql(project,dataset,sha):
    verify_names(project, dataset, 'asia-northeast3')
    bq_table_name('documents', sha)
    view=lambda name:f'`{project}.{dataset}.v2_{name}_{sha}`'
    return f'''-- Read-only queries. Execute ONLY after uploading six staging tables and creating candidate views.
SELECT source_file_type, record_type, COUNT(*) AS record_count
FROM {view('records')}
GROUP BY 1,2 ORDER BY record_count DESC;

SELECT audit_state, relation_type, COUNT(*) AS link_count
FROM {view('relation_audit')}
GROUP BY 1,2 ORDER BY link_count DESC;

-- These are unreviewed research records, not published evidence.
SELECT record_id, record_title, review_status, source_url, media_url
FROM {view('records')}
WHERE record_type = 'PHOTO' LIMIT 20;

-- Inspect only, NEVER assume place coordinates / address or any DIRECT match exists.
SELECT district, COUNT(*) AS places,
  COUNTIF(NULLIF(road_address, '') IS NOT NULL) AS with_road_address,
  COUNTIF(latitude_value IS NOT NULL AND longitude_value IS NOT NULL) AS with_coordinates
FROM {view('places')}
GROUP BY 1 ORDER BY places DESC LIMIT 25;
'''


def main():
    pa=argparse.ArgumentParser()
    pa.add_argument('--manifest',type=Path,default=Path(__file__).with_name('schema_manifest.json'))
    pa.add_argument('--project',default='seoul-place-docent-514906')
    pa.add_argument('--dataset',default='seoul_history')
    pa.add_argument('--out-dir',type=Path,default=Path(__file__).parent)
    a=pa.parse_args()
    manifest=json.loads(a.manifest.read_text(encoding='utf-8'))
    sha=manifest['archive_sha256']
    a.out_dir.mkdir(parents=True,exist_ok=True)
    (a.out_dir/'candidate_views.sql').write_text(gen_sql(a.project,a.dataset,sha),encoding='utf-8')
    (a.out_dir/'audit_queries.sql').write_text(audit_sql(a.project,a.dataset,sha),encoding='utf-8')
    print('Generated read-only candidate views and verification queries; no BigQuery writes.')

if __name__=='__main__':main()
