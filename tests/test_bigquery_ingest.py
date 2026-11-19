import csv
import importlib.util
import io
import json
import os
import re
import sys
import tempfile
import types
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
SPEC = importlib.util.spec_from_file_location("bigquery_ingest", ROOT / "scripts/bigquery/ingest.py")
ingest = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ingest)


class BigQueryIngestTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.files = {
            "historical_records": (self.root / "records.csv", "record_id"),
            "places": (self.root / "places.csv", "place_id"),
            "record_place_links": (self.root / "links.csv", None),
        }
        self.old_files, self.old_root = ingest.FILES, ingest.ROOT
        ingest.FILES, ingest.ROOT = self.files, self.root
        (self.root / "bigquery").mkdir()
        (self.root / "bigquery/schema.sql").write_text("CREATE TABLE IF NOT EXISTS test", encoding="utf-8")
        self.old_env = dict(os.environ)
        os.environ.update({"BIGQUERY_PROJECT_ID":"seoul-place-docent-514906", "BIGQUERY_DATASET_ID":"seoul_history",
                           "BIGQUERY_LOCATION":"asia-northeast3", "BIGQUERY_MAX_BYTES_BILLED":"104857600",
                           "BIGQUERY_INGEST_BATCH_SIZE":"1"})
        self.write(self.files["historical_records"][0], ingest.RECORD_FIELDS, [{
            "record_id": "REC-1", "source_institution": "서울시", "source_url": "https://example.org/a?utm_source=test",
            "record_title": "한글 역사 자료", "record_type": "DOCUMENT", "created_year": "2020",
            "subject_start_year": "1930", "subject_end_year": "", "evidence_excerpt": "검토 전 설명",
            "rights_status": "원문 이용조건 미확인", "review_status": "NEEDS_REVIEW", "newspaper_name": "",
            "published_date": "", "article_title": "", "historical_place_name": "옛 지명", "event_type": "",
            "checked_date": "2026-11-11", "duplicate_status": "UNVERIFIED", "record_origin": "테스트",
        }])
        self.write(self.files["places"][0], ingest.PLACE_FIELDS, [{
            "place_id": "PLACE-1", "place_name": "확인 전 장소", "current_address": "", "district": "마포구",
            "legal_dong": "당인동", "legal_dong_code": "", "historical_names": "당인리", "historical_period": "",
            "location_review_status": "UNVERIFIED", "notes": "주소 검토 전",
        }])
        self.write(self.files["record_place_links"][0], ingest.LINK_FIELDS, [{
            "record_id": "REC-1", "place_id": "PLACE-1", "relation_type": "DISTRICT_CONTEXT",
            "relation_evidence": "검토 전 관계", "link_review_status": "NEEDS_REVIEW",
        }])

    def tearDown(self):
        ingest.FILES, ingest.ROOT = self.old_files, self.old_root
        os.environ.clear(); os.environ.update(self.old_env)
        self.temp.cleanup()

    @staticmethod
    def write(path, headers, rows):
        with path.open("w", encoding="utf-8-sig", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=headers)
            writer.writeheader(); writer.writerows(rows)

    def test_utf8_bom_canonical_url_and_raw_metadata_states_are_preserved(self):
        data = ingest.validate_catalog()
        self.assertEqual(data["issues"], [])
        record = data["records"][0]
        self.assertEqual(record["canonical_source_url"], "https://example.org/a")
        self.assertEqual(record["source_url"], "https://example.org/a?utm_source=test")
        self.assertEqual(record["rights_status"], "원문 이용조건 미확인")
        self.assertEqual(record["review_status"], "NEEDS_REVIEW")
        staged = ingest.stage_rows(data, "run-1", "2026-11-16T00:00:00+00:00")
        payload = staged["historical_records"][0]["source_payload"]
        self.assertEqual(payload["subject_end_year"], "")
        self.assertEqual(payload["review_status"], "NEEDS_REVIEW")
        self.assertEqual(payload["duplicate_status"], "UNVERIFIED")

    def test_duplicate_ids_urls_unknown_references_and_invalid_values_are_rejected(self):
        rows = [
            {"record_id": "REC-1", "source_institution": "서울시", "source_url": "https://example.org/a", "record_title": "제목", "record_type": "DOCUMENT", "rights_status": "unknown", "review_status": "NEEDS_REVIEW"},
            {"record_id": "REC-1", "source_institution": "서울시", "source_url": "https://EXAMPLE.org/a?utm_medium=x", "record_title": "중복", "record_type": "BAD", "rights_status": "unknown", "review_status": "NEEDS_REVIEW", "created_year": "bad"},
        ]
        self.write(self.files["historical_records"][0], ingest.RECORD_FIELDS, rows)
        self.write(self.files["record_place_links"][0], ingest.LINK_FIELDS, [{"record_id":"MISSING","place_id":"NO-PLACE","relation_type":"BAD","relation_evidence":"","link_review_status":""}])
        result = ingest.validate_catalog()
        reasons = " ".join(item["reason"] for item in result["issues"])
        self.assertIn("DUPLICATE_RECORD_ID", reasons)
        self.assertIn("DUPLICATE_CANONICAL_SOURCE_URL", reasons)
        self.assertIn("INVALID_RECORD_TYPE", reasons)
        self.assertIn("INVALID_YEAR:created_year", reasons)
        self.assertIn("UNKNOWN_RECORD_ID", reasons)
        self.assertIn("UNKNOWN_PLACE_ID", reasons)

    def test_empty_place_in_uncertain_relation_is_valid_and_link_key_is_stable(self):
        self.write(self.files["record_place_links"][0], ingest.LINK_FIELDS, [{
            "record_id":"REC-1", "place_id":"", "relation_type":"UNCERTAIN", "relation_evidence":"장소 미확인", "link_review_status":"NEEDS_REVIEW",
        }])
        data = ingest.validate_catalog()
        self.assertEqual(data["issues"], [])
        staged = ingest.stage_rows(data, "run-1", "2026-11-16T00:00:00+00:00")
        self.assertEqual(ingest.key_tuple(staged["record_place_links"][0], ["record_id", "place_id", "relation_type"]),
                         ("REC-1", "", "UNCERTAIN"))
        self.assertIn("Load Job", ingest.load_json_rows.__doc__)

    def test_ndjson_load_job_payload_is_lossless_unicode(self):
        payload = ingest.encode_ndjson([{"record_id":"REC-한글", "source_payload":{"name":"당인리"}}])
        self.assertEqual(json.loads(payload.decode("utf-8")), {"record_id":"REC-한글", "source_payload":{"name":"당인리"}})

    def _sandbox_client(self):
        class Field:
            def __init__(self, name, field_type=None, mode=None): self.name=name; self.field_type=field_type; self.mode=mode
        class Config:
            def __init__(self, **kwargs): self.__dict__.update(kwargs)
        class Parameter:
            def __init__(self, name, param_type, value): self.name=name; self.type_=param_type; self.value=value
        class ArrayParameter(Parameter):
            def __init__(self, name, param_type, values): super().__init__(name,param_type,values)
        class Job:
            def __init__(self, rows=None): self.rows=rows or []; self.errors=None; self.total_bytes_processed=100
            def result(self, timeout=None): return self.rows
        class Client:
            def __init__(self): self.tables={}; self.queries=[]; self.loads=[]; self.fail_once_on=None
            def query(self, sql, job_config=None, location=None):
                self.queries.append(sql)
                if job_config and getattr(job_config,"dry_run",False): return Job()
                match=re.search(r"FROM `([^`]+)`",sql)
                if not match: return Job()
                table=match.group(1); rows=self.tables.get(table,[])
                params={p.name:p.value for p in getattr(job_config,"query_parameters",[])}
                if "canonical_source_url IN UNNEST(@urls)" in sql:
                    return Job([{key:r[key] for key in ("record_id","canonical_source_url")} for r in rows if r.get("canonical_source_url") in params["urls"]])
                if "WHERE run_id=@run_id" in sql:
                    found=sorted((r for r in rows if r.get("run_id")==params["run_id"]),key=lambda r:r["started_at"],reverse=True)
                    return Job([{key:found[0].get(key) for key in ("run_id","source_hash","record_limit","status")}] if found else [])
                key_match=re.search(r"WHERE ([a-z_]+) IN UNNEST\(@keys\)",sql)
                if key_match:
                    key=key_match.group(1); keys=params["keys"]
                    selected=re.search(r"SELECT (.+?) FROM",sql).group(1).split(", ")
                    return Job([{field:r.get(field) for field in selected} for r in rows if r.get(key) in keys])
                return Job()
            def load_table_from_file(self, handle, table_id, job_config=None, location=None):
                self.loads.append((table_id,getattr(job_config,"write_disposition",None)))
                if self.fail_once_on==table_id:
                    self.fail_once_on=None
                    raise RuntimeError("simulated load failure")
                rows=[json.loads(line) for line in handle.getvalue().decode("utf-8").splitlines() if line]
                self.tables.setdefault(table_id,[]).extend(rows)
                return Job()
        client=Client()
        bq=types.ModuleType("google.cloud.bigquery")
        bq.SchemaField=Field; bq.LoadJobConfig=Config; bq.QueryJobConfig=Config
        bq.ScalarQueryParameter=Parameter; bq.ArrayQueryParameter=ArrayParameter
        bq.SourceFormat=types.SimpleNamespace(NEWLINE_DELIMITED_JSON="NEWLINE_DELIMITED_JSON")
        bq.WriteDisposition=types.SimpleNamespace(WRITE_APPEND="WRITE_APPEND")
        bq.Client=lambda project,location:client
        google=types.ModuleType("google"); cloud=types.ModuleType("google.cloud"); cloud.bigquery=bq
        modules={"google":google,"google.cloud":cloud,"google.cloud.bigquery":bq}
        return client, modules

    def _apply_with_fake(self, client, modules, data, run_id, *, resume=False):
        with patch.dict(sys.modules,modules):
            return ingest.apply_data(data,run_id,len(data["issues"]),resume=resume)

    def test_sandbox_load_jobs_are_append_only_and_reruns_skip_matching_keys(self):
        data=ingest.validate_catalog();self.assertEqual(data["issues"],[])
        client,modules=self._sandbox_client()
        with patch.dict(sys.modules,modules):
            ingest.apply_data(data,"11111111-1111-4111-8111-111111111111",0)
            first_counts={table:len(client.tables.get("seoul-place-docent-514906.seoul_history."+table,[]))
                          for table in ("historical_records","places","record_place_links")}
            ingest.apply_data(data,"22222222-2222-4222-8222-222222222222",0)
        self.assertEqual(first_counts,{"historical_records":1,"places":1,"record_place_links":1})
        self.assertEqual({table:len(client.tables.get("seoul-place-docent-514906.seoul_history."+table,[]))
                          for table in ("historical_records","places","record_place_links")},first_counts)
        self.assertTrue(all(mode=="WRITE_APPEND" for _,mode in client.loads))
        self.assertFalse(any(re.search(r"\b(INSERT|UPDATE|DELETE|MERGE|TRUNCATE)\b",sql,re.I) for sql in client.queries))
        self.assertFalse(any("historical_records_test" in sql for sql in client.queries))

    def test_changed_existing_content_reports_conflict_without_overwriting(self):
        data=ingest.validate_catalog();client,modules=self._sandbox_client()
        with patch.dict(sys.modules,modules):
            ingest.apply_data(data,"33333333-3333-4333-8333-333333333333",0)
            old_count=len(client.tables["seoul-place-docent-514906.seoul_history.historical_records"])
            row={key:data["records"][0].get(key,"") for key in ingest.RECORD_FIELDS}
            row["evidence_excerpt"]="내용 변경"
            self.write(self.files["historical_records"][0],ingest.RECORD_FIELDS,[row])
            changed_data=ingest.validate_catalog()
            with self.assertRaisesRegex(RuntimeError,"BQ_CONTENT_CONFLICT"), redirect_stdout(io.StringIO()):
                ingest.apply_data(changed_data,"66666666-6666-4666-8666-666666666666",0)
            self.assertEqual(len(client.tables["seoul-place-docent-514906.seoul_history.historical_records"]),old_count)

    def test_partial_load_failure_can_resume_without_duplicate_rows(self):
        data=ingest.validate_catalog();client,modules=self._sandbox_client()
        run_id="44444444-4444-4444-8444-444444444444"
        client.fail_once_on="seoul-place-docent-514906.seoul_history.places"
        with patch.dict(sys.modules,modules):
            with self.assertRaisesRegex(RuntimeError,"simulated load failure"):
                ingest.apply_data(data,run_id,0)
            self.assertEqual(len(client.tables["seoul-place-docent-514906.seoul_history.historical_records"]),1)
            self.assertEqual(len(client.tables.get("seoul-place-docent-514906.seoul_history.places",[])),0)
            ingest.apply_data(data,run_id,0,resume=True)
        for table in ("historical_records","places","record_place_links"):
            self.assertEqual(len(client.tables["seoul-place-docent-514906.seoul_history."+table]),1)
        run_events=client.tables["seoul-place-docent-514906.seoul_history.ingestion_runs"]
        self.assertEqual(run_events[-1]["status"],"COMPLETED")

    def test_query_dry_run_uses_nonreserved_alias(self):
        data=ingest.validate_catalog();client,modules=self._sandbox_client()
        with patch.dict(sys.modules,modules):
            ingest.apply_data(data,"55555555-5555-4555-8555-555555555555",0,query_dry_run=True)
        self.assertIn("AS record_count",client.queries[-1])

    def test_configuration_requires_explicit_project_dataset_and_location(self):
        before = dict(__import__("os").environ)
        try:
            for key in ("BIGQUERY_PROJECT_ID", "BIGQUERY_DATASET_ID", "BIGQUERY_LOCATION"):
                __import__("os").environ.pop(key, None)
            with self.assertRaisesRegex(RuntimeError, "BQ_CONFIG_MISSING"):
                ingest.read_config()
        finally:
            __import__("os").environ.clear(); __import__("os").environ.update(before)

    def test_place_coordinates_are_optional_but_pair_and_coordinate_system_are_validated(self):
        places_path = self.files["places"][0]
        self.write(places_path, ingest.PLACE_FIELDS + ingest.PLACE_OPTIONAL_FIELDS, [{
            "place_id":"PLACE-1", "place_name":"검토 장소", "current_address":"", "district":"마포구", "legal_dong":"당인동",
            "legal_dong_code":"", "historical_names":"", "historical_period":"", "location_review_status":"UNVERIFIED",
            "notes":"", "latitude":"37.55", "longitude":"126.91", "coordinate_system":"EPSG:4326",
        }])
        data = ingest.validate_catalog()
        self.assertEqual(data["issues"], [])
        self.assertEqual(data["places"][0]["latitude"], 37.55)
        self.assertEqual(data["places"][0]["coordinate_system"], "EPSG:4326")
        self.write(places_path, ingest.PLACE_FIELDS + ingest.PLACE_OPTIONAL_FIELDS, [{
            "place_id":"PLACE-1", "place_name":"검토 장소", "location_review_status":"UNVERIFIED",
            "latitude":"37.55", "longitude":"", "coordinate_system":"EPSG:4326",
        }])
        data = ingest.validate_catalog()
        self.assertIn("INCOMPLETE_COORDINATE_PAIR", " ".join(row["reason"] for row in data["issues"]))


if __name__ == "__main__":
    unittest.main()
