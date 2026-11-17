#!/usr/bin/env python3
"""Validate and explicitly ingest only the three canonical review-catalog CSVs."""
import argparse
import csv
import hashlib
import io
import json
import os
import re
import sys
import uuid
from collections import Counter
from datetime import date, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
from history_catalog_utils import canonical_url  # noqa: E402

DATA = ROOT / "research-data"
TYPE_ALLOWLIST = {"PHOTO", "MAP", "DOCUMENT", "VIDEO", "ORAL", "NEWS"}
RELATION_ALLOWLIST = {"EXACT_SITE", "NEARBY", "DISTRICT_CONTEXT", "UNCERTAIN"}
FILES = {
    "historical_records": (DATA / "records.csv", "record_id"),
    "places": (DATA / "places.csv", "place_id"),
    "record_place_links": (DATA / "record_place_links.csv", None),
}
RECORD_FIELDS = [
    "record_id", "source_institution", "source_url", "record_title", "record_type", "created_year",
    "subject_start_year", "subject_end_year", "evidence_excerpt", "rights_status", "review_status",
    "newspaper_name", "published_date", "article_title", "historical_place_name", "event_type",
    "checked_date", "duplicate_status", "record_origin",
]
PLACE_FIELDS = ["place_id", "place_name", "current_address", "district", "legal_dong", "legal_dong_code", "historical_names", "historical_period", "location_review_status", "notes"]
PLACE_OPTIONAL_FIELDS = ["road_address", "jibun_address", "building_name", "building_management_number", "latitude", "longitude", "coordinate_system"]
LINK_FIELDS = ["record_id", "place_id", "relation_type", "relation_evidence", "link_review_status"]
DATE_FIELDS = {"published_date", "checked_date"}
YEAR_FIELDS = {"created_year", "subject_start_year", "subject_end_year"}


def clean(value):
    return value.strip() if isinstance(value, str) else ""


def parse_year(value):
    value = clean(value)
    if not value:
        return None
    if not re.fullmatch(r"\d{1,4}", value) or not 1 <= int(value) <= 9999:
        raise ValueError("INVALID_YEAR")
    return int(value)


def parse_date(value):
    value = clean(value)
    if not value:
        return None
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise ValueError("INVALID_DATE")
    try:
        return date.fromisoformat(value).isoformat()
    except ValueError as exc:
        raise ValueError("INVALID_DATE") from exc


def read_rows(path, required, issues):
    if not path.is_file():
        issues.append({"file": str(path.relative_to(ROOT)), "line": 1, "record_id": "", "reason": "MISSING_FILE"})
        return [], []
    rows = []
    headers = []
    try:
        with path.open(encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle, strict=True)
            headers = reader.fieldnames or []
            if len(headers) != len(set(headers)):
                issues.append({"file": str(path.relative_to(ROOT)), "line": 1, "record_id": "", "reason": "DUPLICATE_COLUMNS"})
                return [], headers
            missing = [name for name in required if name not in headers]
            if missing:
                issues.append({"file": str(path.relative_to(ROOT)), "line": 1, "record_id": "", "reason": "MISSING_COLUMNS:" + ",".join(missing)})
                return [], headers
            for line, row in enumerate(reader, 2):
                key = "record_id" if "record_id" in row else "place_id"
                identity = clean(row.get(key, ""))
                if None in row:
                    issues.append({"file": str(path.relative_to(ROOT)), "line": line, "record_id": identity, "reason": "FIELD_COUNT_MISMATCH"})
                    continue
                if all(not clean(value) for value in row.values()):
                    continue
                rows.append((line, {name: clean(row.get(name, "")) for name in headers}))
    except (OSError, UnicodeError, csv.Error) as exc:
        issues.append({"file": str(path.relative_to(ROOT)), "line": 0, "record_id": "", "reason": "CSV_READ_ERROR:" + type(exc).__name__})
    return rows, headers


def duplicate_values(rows, field, normalize=lambda x: x):
    buckets = {}
    for index, row in enumerate(rows):
        value = normalize(clean(row.get(field, "")))
        if value:
            buckets.setdefault(value, []).append(index)
    return {index for indexes in buckets.values() if len(indexes) > 1 for index in indexes}


def safe_canonical(value):
    if not value:
        return ""
    try:
        return canonical_url(value)
    except ValueError:
        return ""


def validate_catalog():
    issues = []
    raw_records, record_headers = read_rows(FILES["historical_records"][0], RECORD_FIELDS, issues)
    raw_places, place_headers = read_rows(FILES["places"][0], PLACE_FIELDS, issues)
    raw_links, link_headers = read_rows(FILES["record_place_links"][0], LINK_FIELDS, issues)
    record_duplicates = duplicate_values([row for _, row in raw_records], "record_id")
    place_duplicates = duplicate_values([row for _, row in raw_places], "place_id")
    url_duplicates = duplicate_values([row for _, row in raw_records], "source_url", safe_canonical)
    link_keys = [(clean(row.get("record_id")), clean(row.get("place_id")), clean(row.get("relation_type"))) for _, row in raw_links]
    duplicate_link_keys = {key for key, count in Counter(link_keys).items() if key[0] and count > 1}
    link_key_duplicates = {index for index, key in enumerate(link_keys) if key in duplicate_link_keys}
    valid_records, valid_places, valid_links = [], [], []
    record_ids = {clean(row.get("record_id")) for _, row in raw_records}
    place_ids = {clean(row.get("place_id")) for _, row in raw_places}

    for index, (line, row) in enumerate(raw_records):
        identity = clean(row.get("record_id"))
        reasons = []
        if not identity: reasons.append("EMPTY_RECORD_ID")
        if index in record_duplicates: reasons.append("DUPLICATE_RECORD_ID")
        if not clean(row.get("source_institution")) or not clean(row.get("record_title")): reasons.append("MISSING_REQUIRED_RECORD_FIELD")
        try: canonical = canonical_url(row.get("source_url", ""))
        except ValueError: canonical = ""; reasons.append("INVALID_SOURCE_URL")
        if index in url_duplicates: reasons.append("DUPLICATE_CANONICAL_SOURCE_URL")
        if row.get("record_type") not in TYPE_ALLOWLIST: reasons.append("INVALID_RECORD_TYPE")
        if not clean(row.get("rights_status")) or not clean(row.get("review_status")): reasons.append("MISSING_REVIEW_OR_RIGHTS_STATUS")
        if row.get("record_type") == "NEWS" and not all(clean(row.get(key)) for key in ("newspaper_name", "published_date", "article_title")):
            reasons.append("INCOMPLETE_NEWS_METADATA")
        cooked = dict(row)
        for key in YEAR_FIELDS:
            try: cooked[key] = parse_year(row.get(key, ""))
            except ValueError: reasons.append("INVALID_YEAR:" + key)
        start, end = cooked.get("subject_start_year"), cooked.get("subject_end_year")
        if start is not None and end is not None and start > end: reasons.append("INVALID_SUBJECT_PERIOD")
        for key in DATE_FIELDS:
            try: cooked[key] = parse_date(row.get(key, ""))
            except ValueError: reasons.append("INVALID_DATE:" + key)
        if reasons:
            issues.append({"file": str(FILES["historical_records"][0].relative_to(ROOT)), "line": line, "record_id": identity, "reason": "|".join(sorted(set(reasons)))})
        else:
            cooked["canonical_source_url"] = canonical
            cooked["_source_payload"] = dict(row)
            valid_records.append(cooked)

    for index, (line, row) in enumerate(raw_places):
        identity = clean(row.get("place_id"))
        reasons = []
        if not identity: reasons.append("EMPTY_PLACE_ID")
        if index in place_duplicates: reasons.append("DUPLICATE_PLACE_ID")
        if not clean(row.get("place_name")) or not clean(row.get("location_review_status")): reasons.append("MISSING_REQUIRED_PLACE_FIELD")
        cooked = dict(row)
        for field in PLACE_OPTIONAL_FIELDS: cooked.setdefault(field, "")
        lat, lon, coordinate_system = (clean(cooked.get(key)) for key in ("latitude", "longitude", "coordinate_system"))
        if bool(lat) != bool(lon): reasons.append("INCOMPLETE_COORDINATE_PAIR")
        elif lat and lon:
            try:
                lat_value, lon_value = float(lat), float(lon)
                if not (-90 <= lat_value <= 90 and -180 <= lon_value <= 180): raise ValueError()
                if coordinate_system not in {"EPSG:4326", "WGS84"}: raise ValueError()
                cooked["latitude"], cooked["longitude"] = lat_value, lon_value
                cooked["coordinate_system"] = "EPSG:4326"
            except (ValueError, OverflowError): reasons.append("INVALID_COORDINATE_OR_CRS")
        elif coordinate_system:
            reasons.append("COORDINATE_SYSTEM_WITHOUT_COORDINATES")
        if reasons:
            issues.append({"file": str(FILES["places"][0].relative_to(ROOT)), "line": line, "record_id": identity, "reason": "|".join(reasons)})
        else:
            cooked["_source_payload"] = dict(row)
            valid_places.append(cooked)

    for link_index, (line, row) in enumerate(raw_links):
        record_id, place_id = clean(row.get("record_id")), clean(row.get("place_id"))
        reasons = []
        if not record_id or record_id not in record_ids: reasons.append("UNKNOWN_RECORD_ID")
        if record_id not in {r["record_id"] for r in valid_records}: reasons.append("REJECTED_OR_DUPLICATE_RECORD_ID")
        if place_id and place_id not in place_ids: reasons.append("UNKNOWN_PLACE_ID")
        if place_id and place_id not in {p["place_id"] for p in valid_places}: reasons.append("REJECTED_OR_DUPLICATE_PLACE_ID")
        if row.get("relation_type") not in RELATION_ALLOWLIST: reasons.append("INVALID_RELATION_TYPE")
        if not place_id and row.get("relation_type") != "UNCERTAIN": reasons.append("EMPTY_PLACE_REQUIRES_UNCERTAIN")
        if not clean(row.get("link_review_status")): reasons.append("MISSING_LINK_REVIEW_STATUS")
        if link_index in link_key_duplicates: reasons.append("DUPLICATE_RECORD_PLACE_RELATION")
        if reasons:
            issues.append({"file": str(FILES["record_place_links"][0].relative_to(ROOT)), "line": line, "record_id": record_id, "reason": "|".join(sorted(set(reasons)))})
        else:
            valid_links.append(dict(row))

    return {"records": valid_records, "places": valid_places, "links": valid_links,
            "raw_counts": {"records": len(raw_records), "places": len(raw_places), "links": len(raw_links)},
            "issues": issues, "headers": {"records": record_headers, "places": place_headers, "links": link_headers}}


def content_hash(row):
    payload = json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def catalog_hash():
    digest = hashlib.sha256()
    for key in FILES:
        path = FILES[key][0]
        digest.update(key.encode("utf-8"))
        digest.update(path.read_bytes())
    return digest.hexdigest()


def read_config():
    required = ["BIGQUERY_PROJECT_ID", "BIGQUERY_DATASET_ID", "BIGQUERY_LOCATION"]
    missing = [key for key in required if not os.environ.get(key, "").strip()]
    if missing:
        raise RuntimeError("BQ_CONFIG_MISSING")
    project, dataset, location = (os.environ[key].strip() for key in required)
    if not re.fullmatch(r"[a-z][a-z0-9-]{4,28}[a-z0-9]", project) or not re.fullmatch(r"[A-Za-z0-9_-]{1,1024}", dataset) or not re.fullmatch(r"[A-Za-z0-9_-]{2,40}", location):
        raise RuntimeError("BQ_CONFIG_MISSING")
    return project, dataset, location


def json_report(result, run_id, mode):
    print(json.dumps({"runId": run_id, "mode": mode, "source": "three-canonical-research-csvs-only",
                      "counts": result["raw_counts"], "valid": {"records": len(result["records"]), "places": len(result["places"]), "links": len(result["links"])},
                      "rejected": len(result["issues"]), "issues": result["issues"]}, ensure_ascii=False, indent=2))


def write_reject_report(path, issues):
    if not issues:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["file", "line", "record_id", "reason"])
        writer.writeheader()
        writer.writerows(issues)


def schemas():
    from google.cloud import bigquery
    return {
        "historical_records": [
            bigquery.SchemaField("record_id", "STRING", mode="REQUIRED"), bigquery.SchemaField("source_institution", "STRING", mode="REQUIRED"),
            bigquery.SchemaField("source_url", "STRING", mode="REQUIRED"), bigquery.SchemaField("record_title", "STRING", mode="REQUIRED"),
            bigquery.SchemaField("record_type", "STRING", mode="REQUIRED"), bigquery.SchemaField("created_year", "INT64"),
            bigquery.SchemaField("subject_start_year", "INT64"), bigquery.SchemaField("subject_end_year", "INT64"), bigquery.SchemaField("evidence_excerpt", "STRING"),
            bigquery.SchemaField("rights_status", "STRING", mode="REQUIRED"), bigquery.SchemaField("review_status", "STRING", mode="REQUIRED"),
            bigquery.SchemaField("newspaper_name", "STRING"), bigquery.SchemaField("published_date", "DATE"), bigquery.SchemaField("article_title", "STRING"),
            bigquery.SchemaField("historical_place_name", "STRING"), bigquery.SchemaField("event_type", "STRING"), bigquery.SchemaField("checked_date", "DATE"),
            bigquery.SchemaField("duplicate_status", "STRING"), bigquery.SchemaField("record_origin", "STRING"), bigquery.SchemaField("source_payload", "JSON", mode="REQUIRED"), bigquery.SchemaField("canonical_source_url", "STRING", mode="REQUIRED"),
            bigquery.SchemaField("ingested_at", "TIMESTAMP", mode="REQUIRED"), bigquery.SchemaField("updated_at", "TIMESTAMP", mode="REQUIRED"),
            bigquery.SchemaField("content_hash", "STRING", mode="REQUIRED"), bigquery.SchemaField("ingestion_run_id", "STRING", mode="REQUIRED"),
        ],
        "places": [bigquery.SchemaField(name, "STRING", mode="REQUIRED" if name in {"place_id", "place_name", "location_review_status"} else "NULLABLE") for name in PLACE_FIELDS] + [
            bigquery.SchemaField("road_address", "STRING"), bigquery.SchemaField("jibun_address", "STRING"), bigquery.SchemaField("building_name", "STRING"), bigquery.SchemaField("building_management_number", "STRING"),
            bigquery.SchemaField("latitude", "FLOAT64"), bigquery.SchemaField("longitude", "FLOAT64"), bigquery.SchemaField("coordinate_system", "STRING"),
            bigquery.SchemaField("source_payload", "JSON", mode="REQUIRED"),
            bigquery.SchemaField("updated_at", "TIMESTAMP", mode="REQUIRED"), bigquery.SchemaField("content_hash", "STRING", mode="REQUIRED"), bigquery.SchemaField("ingestion_run_id", "STRING", mode="REQUIRED")],
        "record_place_links": [bigquery.SchemaField(name, "STRING", mode="REQUIRED" if name in {"record_id", "relation_type", "link_review_status"} else "NULLABLE") for name in LINK_FIELDS] + [bigquery.SchemaField("source_payload", "JSON", mode="REQUIRED"),
            bigquery.SchemaField("updated_at", "TIMESTAMP", mode="REQUIRED"), bigquery.SchemaField("content_hash", "STRING", mode="REQUIRED"), bigquery.SchemaField("ingestion_run_id", "STRING", mode="REQUIRED")],
    }


def bq_tables(project, dataset):
    prefix = f"`{project}.{dataset}."
    names = ("historical_records", "places", "record_place_links", "ingestion_runs", "ingestion_run_sources")
    return {key: prefix + key + "`" for key in names}


def stage_rows(data, run_id, now):
    result = {"historical_records": [], "places": [], "record_place_links": []}
    for row in data["records"]:
        source_payload = row.get("_source_payload", {key: value for key, value in row.items() if key != "canonical_source_url"})
        normalized = {key: value for key, value in row.items() if key != "_source_payload"}
        result["historical_records"].append({**normalized, "source_payload": source_payload, "ingested_at": now, "updated_at": now, "content_hash": content_hash({**normalized, "source_payload": source_payload}), "ingestion_run_id": run_id})
    for row in data["places"]:
        source_payload = row.get("_source_payload", row)
        normalized = {key: value for key, value in row.items() if key != "_source_payload"}
        result["places"].append({**normalized, "source_payload": source_payload, "updated_at": now, "content_hash": content_hash({**normalized, "source_payload": source_payload}), "ingestion_run_id": run_id})
    for row in data["links"]:
        result["record_place_links"].append({**row, "source_payload": row, "updated_at": now, "content_hash": content_hash(row), "ingestion_run_id": run_id})
    return result


def encode_ndjson(rows):
    return ("".join(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n" for row in rows)).encode("utf-8")


def load_json_rows(client, table_id, rows, schema, location, timeout):
    """Append a batch through a BigQuery Load Job; never use streaming inserts."""
    if not rows:
        return None
    from google.cloud import bigquery
    payload = io.BytesIO(encode_ndjson(rows))
    config = bigquery.LoadJobConfig(
        schema=schema,
        source_format=bigquery.SourceFormat.NEWLINE_DELIMITED_JSON,
        write_disposition=bigquery.WriteDisposition.WRITE_APPEND,
    )
    job = client.load_table_from_file(payload, table_id, job_config=config, location=location)
    job.result(timeout=timeout)
    if getattr(job, "errors", None):
        raise RuntimeError("BQ_LOAD_JOB_FAILED")
    return job


def key_tuple(row, fields):
    return tuple(row.get(field) for field in fields)


def fetch_existing_rows(client, table_id, key_fields, incoming_rows, location, timeout, max_bytes):
    """Read only matching keys in bounded arrays; return metadata needed for idempotency."""
    if not incoming_rows:
        return []
    from google.cloud import bigquery
    ids = sorted({str(row[key_fields[0]]) for row in incoming_rows if row.get(key_fields[0]) not in (None, "")})
    if not ids:
        return []
    fields = ", ".join(key_fields + ["content_hash"])
    result = []
    batch_size = int(os.environ.get("BIGQUERY_INGEST_BATCH_SIZE", "5000"))
    if not 1 <= batch_size <= 10000:
        raise RuntimeError("BQ_INVALID_BATCH_SIZE")
    for start in range(0, len(ids), batch_size):
        batch = ids[start:start + batch_size]
        sql = f"SELECT {fields} FROM `{table_id}` WHERE {key_fields[0]} IN UNNEST(@keys)"
        config = bigquery.QueryJobConfig(
            query_parameters=[bigquery.ArrayQueryParameter("keys", "STRING", batch)],
            maximum_bytes_billed=max_bytes,
        )
        result.extend(client.query(sql, job_config=config, location=location).result(timeout=timeout))
    return result


def preflight_catalog(client, tables, staged, location, timeout, max_bytes):
    """Find identical rows and conflicts before any catalog table is written."""
    keys = {
        "historical_records": ["record_id"],
        "places": ["place_id"],
        "record_place_links": ["record_id", "place_id", "relation_type"],
    }
    pending = {}
    counts = {}
    conflicts = []
    for table_name, key_fields in keys.items():
        table_id = tables[table_name].strip("`")
        incoming = staged[table_name]
        existing_rows = fetch_existing_rows(client, table_id, key_fields, incoming, location, timeout, max_bytes)
        existing = {}
        for row in existing_rows:
            key = key_tuple(row, key_fields)
            if key in existing:
                conflicts.append({"table": table_name, "key": key, "reason": "DUPLICATE_KEY_IN_DESTINATION"})
            existing[key] = row["content_hash"]
        new_rows = []
        duplicate_count = 0
        for row in incoming:
            key = key_tuple(row, key_fields)
            old_hash = existing.get(key)
            if old_hash is None:
                new_rows.append(row)
            elif old_hash == row["content_hash"]:
                duplicate_count += 1
            else:
                conflicts.append({"table": table_name, "key": key, "reason": "CONTENT_CHANGED"})
        pending[table_name] = new_rows
        counts[table_name] = {"inserted": len(new_rows), "duplicates": duplicate_count}

    # Keep canonical URLs unique across different record IDs without scanning the full table.
    incoming_records = staged["historical_records"]
    record_by_url = {row["canonical_source_url"]: row["record_id"] for row in incoming_records}
    urls = sorted(record_by_url)
    from google.cloud import bigquery
    for start in range(0, len(urls), 5000):
        batch = urls[start:start + 5000]
        if not batch:
            continue
        sql = f"SELECT record_id, canonical_source_url FROM `{tables['historical_records'].strip('`')}` WHERE canonical_source_url IN UNNEST(@urls)"
        config = bigquery.QueryJobConfig(
            query_parameters=[bigquery.ArrayQueryParameter("urls", "STRING", batch)],
            maximum_bytes_billed=max_bytes,
        )
        for row in client.query(sql, job_config=config, location=location).result(timeout=timeout):
            if row["record_id"] != record_by_url[row["canonical_source_url"]]:
                conflicts.append({"table": "historical_records", "key": (row["canonical_source_url"],), "reason": "DUPLICATE_SOURCE_URL"})
    return pending, counts, conflicts


def event_time():
    return datetime.now(timezone.utc).isoformat()


def append_run_event(client, table_id, row, schema, location, timeout):
    load_json_rows(client, table_id.strip("`"), [row], schema, location, timeout)


def make_run_event(run_id, source_name, attempted, inserted, updated, duplicates, rejected,
                   status, source_hash, limit, cursor, error=None, finished=False):
    now = event_time()
    return {
        "run_id": run_id, "started_at": now, "finished_at": now if finished else None,
        "source_name": source_name, "attempted_count": attempted, "inserted_count": inserted,
        "updated_count": updated, "duplicate_count": duplicates, "rejected_count": rejected,
        "status": status, "error_summary": error, "source_hash": source_hash,
        "record_limit": limit, "resume_cursor": cursor,
    }


def make_source_event(run_id, table_name, source_hash, attempted, status, cursor, error=None,
                      inserted=0, duplicates=0):
    return {
        "run_id": run_id, "source_name": str(FILES[table_name][0].relative_to(ROOT)),
        "source_hash": source_hash, "attempted_count": attempted,
        "inserted_count": inserted, "updated_count": 0, "duplicate_count": duplicates,
        "rejected_count": 0, "status": status, "resume_cursor": cursor,
        "error_summary": error, "updated_at": event_time(),
    }


def latest_run_event(client, table_id, run_id, location, timeout, max_bytes):
    from google.cloud import bigquery
    sql = f"SELECT run_id,source_hash,record_limit,status FROM `{table_id.strip('`')}` WHERE run_id=@run_id ORDER BY started_at DESC LIMIT 1"
    config = bigquery.QueryJobConfig(
        query_parameters=[bigquery.ScalarQueryParameter("run_id", "STRING", run_id)],
        maximum_bytes_billed=max_bytes,
    )
    rows = list(client.query(sql, job_config=config, location=location).result(timeout=timeout))
    return rows[0] if rows else None


def apply_data(data, run_id, rejected, *, limit=None, query_dry_run=False, resume=False):
    from google.cloud import bigquery
    project, dataset, location = read_config()
    timeout = int(os.environ.get("BIGQUERY_QUERY_TIMEOUT_MS", "8000")) / 1000
    max_bytes = int(os.environ.get("BIGQUERY_MAX_BYTES_BILLED", "104857600"))
    client = bigquery.Client(project=project, location=location)
    tables = bq_tables(project, dataset)
    if query_dry_run:
        query = f"SELECT COUNT(*) AS record_count FROM {tables['historical_records']} WHERE review_status = 'content_checked'"
        job = client.query(query, job_config=bigquery.QueryJobConfig(dry_run=True, use_query_cache=False, maximum_bytes_billed=max_bytes), location=location)
        print(json.dumps({"queryDryRun": True, "estimatedBytesProcessed": job.total_bytes_processed, "maximumBytesBilled": max_bytes}))
        return

    ddl = (ROOT / "bigquery/schema.sql").read_text(encoding="utf-8").replace("{{project}}", project).replace("{{dataset}}", dataset)
    client.query(ddl, location=location, job_config=bigquery.QueryJobConfig(maximum_bytes_billed=max_bytes)).result(timeout=timeout)
    source_hash = catalog_hash()
    if resume:
        latest = latest_run_event(client, tables["ingestion_runs"], run_id, location, timeout, max_bytes)
        if not latest or latest["status"] not in {"FAILED", "RUNNING"} or latest["source_hash"] != source_hash or (limit is not None and latest["record_limit"] != limit):
            raise RuntimeError("BQ_RESUME_MISMATCH")
        limit = latest["record_limit"]
    started = datetime.now(timezone.utc)
    now = started.isoformat()
    staged = stage_rows(data, run_id, now)
    if limit:
        keep_ids = {row["record_id"] for row in staged["historical_records"][:limit]}
        staged["historical_records"] = staged["historical_records"][:limit]
        needed_places = {row["place_id"] for row in staged["record_place_links"] if row["record_id"] in keep_ids and row["place_id"]}
        staged["places"] = [row for row in staged["places"] if row["place_id"] in needed_places]
        staged["record_place_links"] = [row for row in staged["record_place_links"] if row["record_id"] in keep_ids]

    run_row = {"run_id": run_id, "started_at": now, "finished_at": None, "source_name": "research-data/records.csv,places.csv,record_place_links.csv",
               "attempted_count": sum(len(rows) for rows in staged.values()) + rejected,
               "inserted_count": 0, "updated_count": 0, "duplicate_count": 0, "rejected_count": rejected,
               "status": "RUNNING", "error_summary": None, "source_hash": source_hash, "record_limit": limit, "resume_cursor": "preflight"}
    run_schema = [
        bigquery.SchemaField("run_id", "STRING", mode="REQUIRED"), bigquery.SchemaField("started_at", "TIMESTAMP", mode="REQUIRED"),
        bigquery.SchemaField("finished_at", "TIMESTAMP"), bigquery.SchemaField("source_name", "STRING", mode="REQUIRED"),
        bigquery.SchemaField("attempted_count", "INT64", mode="REQUIRED"), bigquery.SchemaField("inserted_count", "INT64", mode="REQUIRED"),
        bigquery.SchemaField("updated_count", "INT64", mode="REQUIRED"), bigquery.SchemaField("duplicate_count", "INT64", mode="REQUIRED"),
        bigquery.SchemaField("rejected_count", "INT64", mode="REQUIRED"), bigquery.SchemaField("status", "STRING", mode="REQUIRED"),
        bigquery.SchemaField("error_summary", "STRING"), bigquery.SchemaField("source_hash", "STRING"),
        bigquery.SchemaField("record_limit", "INT64"), bigquery.SchemaField("resume_cursor", "STRING"),
    ]
    source_schema = [
        bigquery.SchemaField("run_id", "STRING", mode="REQUIRED"), bigquery.SchemaField("source_name", "STRING", mode="REQUIRED"),
        bigquery.SchemaField("source_hash", "STRING", mode="REQUIRED"), bigquery.SchemaField("attempted_count", "INT64", mode="REQUIRED"),
        bigquery.SchemaField("inserted_count", "INT64", mode="REQUIRED"), bigquery.SchemaField("updated_count", "INT64", mode="REQUIRED"),
        bigquery.SchemaField("duplicate_count", "INT64", mode="REQUIRED"), bigquery.SchemaField("rejected_count", "INT64", mode="REQUIRED"),
        bigquery.SchemaField("status", "STRING", mode="REQUIRED"), bigquery.SchemaField("resume_cursor", "STRING"),
        bigquery.SchemaField("error_summary", "STRING"), bigquery.SchemaField("updated_at", "TIMESTAMP", mode="REQUIRED"),
    ]
    load_json_rows(client, tables["ingestion_runs"].strip("`"), [run_row], run_schema, location, timeout)
    for table_name in ("historical_records", "places", "record_place_links"):
        path = FILES[table_name][0]
        append_run_event(client, tables["ingestion_run_sources"], make_source_event(
            run_id, table_name, hashlib.sha256(path.read_bytes()).hexdigest(), len(staged[table_name]), "RUNNING", "preflight"),
            source_schema, location, timeout)
    if rejected:
        for table_name in ("historical_records", "places", "record_place_links"):
            path = str(FILES[table_name][0].relative_to(ROOT))
            append_run_event(client, tables["ingestion_run_sources"], make_source_event(
                run_id, table_name, hashlib.sha256(FILES[table_name][0].read_bytes()).hexdigest(),
                len(staged[table_name]), "REJECTED", "validation", "CSV validation rejected rows"),
                source_schema, location, timeout)
        append_run_event(client, tables["ingestion_runs"], make_run_event(
            run_id, run_row["source_name"], run_row["attempted_count"], 0, 0, 0, rejected,
            "REJECTED", source_hash, limit, "validation", "CSV validation rejected rows; no catalog rows were loaded.", True),
            run_schema, location, timeout)
        raise RuntimeError("BQ_INGEST_VALIDATION_FAILED")

    schemas_by_table = schemas()
    inserted = 0
    duplicates = 0
    current_source = None
    source_hashes = {name: hashlib.sha256(FILES[name][0].read_bytes()).hexdigest() for name in FILES}
    source_counts = {}
    try:
        chunk_size = int(os.environ.get("BIGQUERY_INGEST_BATCH_SIZE", "5000"))
        if not 1 <= chunk_size <= 10000:
            raise RuntimeError("BQ_INVALID_BATCH_SIZE")
        pending, preflight_counts, conflicts = preflight_catalog(
            client, tables, staged, location, timeout, max_bytes)
        if conflicts:
            print(json.dumps({"runId": run_id, "status": "CONFLICT", "conflicts": conflicts[:100],
                              "conflictCount": len(conflicts), "catalogRowsWritten": 0}, ensure_ascii=False))
            raise RuntimeError("BQ_CONTENT_CONFLICT")
        # All keys and hashes are checked before the first append. Re-running after a partial
        # failure re-reads the destination and skips rows already loaded with the same hash.
        for table_name in ("historical_records", "places", "record_place_links"):
            current_source = table_name
            rows = pending[table_name]
            loaded_count = 0
            if rows:
                append_run_event(client, tables["ingestion_run_sources"], make_source_event(
                    run_id, table_name, source_hashes[table_name], len(staged[table_name]), "LOADING", "load-job"),
                    source_schema, location, timeout)
                for chunk_index in range(0, len(rows), chunk_size):
                    chunk = rows[chunk_index:chunk_index + chunk_size]
                    load_json_rows(client, tables[table_name].strip("`"), chunk,
                                   schemas_by_table[table_name], location, timeout)
                    loaded_count += len(chunk)
                    source_counts[table_name] = {"inserted": loaded_count,
                                                 "duplicates": preflight_counts[table_name]["duplicates"]}
                    append_run_event(client, tables["ingestion_run_sources"], make_source_event(
                        run_id, table_name, source_hashes[table_name], len(staged[table_name]), "LOADING",
                        f"loaded:{loaded_count}", inserted=loaded_count,
                        duplicates=preflight_counts[table_name]["duplicates"]), source_schema, location, timeout)
            source_counts[table_name] = {"inserted": loaded_count,
                                         "duplicates": preflight_counts[table_name]["duplicates"]}
            append_run_event(client, tables["ingestion_run_sources"], make_source_event(
                run_id, table_name, source_hashes[table_name], len(staged[table_name]), "COMPLETED", "complete",
                inserted=loaded_count, duplicates=preflight_counts[table_name]["duplicates"]),
                source_schema, location, timeout)
            inserted += loaded_count
            duplicates += preflight_counts[table_name]["duplicates"]
        append_run_event(client, tables["ingestion_runs"], make_run_event(
            run_id, run_row["source_name"], run_row["attempted_count"], inserted, 0, duplicates, 0,
            "COMPLETED", source_hash, limit, "complete", finished=True), run_schema, location, timeout)
        print(json.dumps({"runId": run_id, "status": "COMPLETED", "attempted": run_row["attempted_count"],
                          "inserted": inserted, "updated": 0, "duplicates": duplicates, "rejected": 0,
                          "writeMode": "BigQuery Load Jobs / WRITE_APPEND"}, ensure_ascii=False))
    except Exception as exc:
        safe_code = str(exc) if str(exc).startswith("BQ_") else type(exc).__name__
        affected_sources = [current_source] if current_source else ["historical_records", "places", "record_place_links"]
        for failed_source in affected_sources:
            append_run_event(client, tables["ingestion_run_sources"], make_source_event(
                run_id, failed_source, source_hashes[failed_source], len(staged[failed_source]),
                "CONFLICT" if safe_code == "BQ_CONTENT_CONFLICT" else "FAILED", "retry-from-csv", safe_code,
                inserted=source_counts.get(failed_source, {}).get("inserted", 0),
                duplicates=source_counts.get(failed_source, {}).get("duplicates", 0)),
                source_schema, location, timeout)
        append_run_event(client, tables["ingestion_runs"], make_run_event(
            run_id, run_row["source_name"], run_row["attempted_count"], inserted, 0, duplicates, 0,
            "CONFLICT" if safe_code == "BQ_CONTENT_CONFLICT" else "FAILED", source_hash, limit,
            "retry-from-csv", safe_code, finished=True),
            run_schema, location, timeout)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Actually write to BigQuery. Requires --confirm APPLY.")
    parser.add_argument("--confirm", choices=["APPLY"], help="Explicit second confirmation for writes.")
    parser.add_argument("--limit", type=int, help="Limit to this many records and their linked places for a small first import.")
    parser.add_argument("--query-dry-run", action="store_true", help="Run a BigQuery API query dry-run after the dataset/tables exist.")
    parser.add_argument("--resume", metavar="RUN_ID", help="Resume a FAILED or RUNNING import with the same CSV content and limit.")
    parser.add_argument("--reject-report", type=Path, help="Optional metadata-only CSV report path for rejected rows.")
    args = parser.parse_args()
    if args.limit is not None and args.limit < 1: parser.error("--limit must be positive")
    if args.apply != (args.confirm == "APPLY"): parser.error("writes require both --apply and --confirm APPLY")
    if args.query_dry_run and args.apply: parser.error("--query-dry-run and --apply are separate operations")
    if args.resume and not args.apply: parser.error("--resume requires --apply --confirm APPLY")
    if args.resume and not re.fullmatch(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}", args.resume):
        parser.error("--resume must be a run ID UUID")
    run_id = args.resume or str(uuid.uuid4())
    result = validate_catalog()
    json_report(result, run_id, "apply-request" if args.apply else "pipeline-dry-run")
    if args.reject_report:
        write_reject_report(args.reject_report, result["issues"])
    if not args.apply:
        if args.query_dry_run:
            try: apply_data(result, run_id, len(result["issues"]), query_dry_run=True)
            except Exception as exc:
                print(json.dumps({"queryDryRun": False, "errorCode": str(exc) if str(exc).startswith("BQ_") else type(exc).__name__}), file=sys.stderr)
                return 1
        return 1 if result["issues"] else 0
    try:
        apply_data(result, run_id, len(result["issues"]), limit=args.limit, resume=bool(args.resume))
    except Exception as exc:
        print(json.dumps({"runId": run_id, "status": "FAILED", "errorCode": str(exc) if str(exc).startswith("BQ_") else type(exc).__name__}), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
