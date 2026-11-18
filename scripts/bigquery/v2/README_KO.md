# 서울 도슨트 BigQuery v2 — 비공개 원본 스냅샷

> **2026-11-19 갱신:** 기존 `rawv2_<kind>_15dcc4c58945` 6개 테이블에 291,520행이 이미 있습니다.
> 실조회 및 원본 전체 필드 해시 대조를 통과했으므로 **재업로드·복제하지 않습니다**.
> 이전 전체 64자리 이름의 NOT_LOADED 결과는 이름 선택의 차이이며 데이터 누락이 아닙니다.
> 검증 결과: `docs/bigquery-v2-legacy-validation-ko.md`.

## 기존 12자리 해시 테이블 읽기 전용 재사용

```powershell
# 메타데이터·스키마 비교만 (쿼리 실행 없음)
python scripts/bigquery/v2/verify_sandbox.py --project seoul-place-docent-514906 --dataset seoul_history --confirm-read seoul-place-docent-514906.seoul_history --legacy-hash-tables --metadata-only --report outputs/bigquery-v2/legacy-schema.json
# 전체 원본 필드 및 관계 검증: 모든 dry run 합계를 먼저 확인, 누적 750 MB 제한
python scripts/bigquery/v2/verify_sandbox.py --project seoul-place-docent-514906 --dataset seoul_history --confirm-read seoul-place-docent-514906.seoul_history --legacy-hash-tables --max-bytes 750000000 --execute-counts --zip $zip --report outputs/bigquery-v2/legacy-live.json
# 기존 테이블 참조 SQL 파일만 생성. CREATE VIEW 실행은 별도 승인 필요.
python scripts/bigquery/v2/generate_views.py --legacy-hash-tables
```

`--legacy-hash-tables`는 명시적 읽기 이름 선택입니다. 자동 fallback이나 테이블 이름 변경이 아닙니다.
전체 SHA256은 manifest와 모든 행의 `_batch_sha256`에서 검증하고, 원본 ZIP 파일 자체도 해시 대조합니다.
원본 필드는 열 순서대로 UTF-8 바이트 길이와 값을 결합하여 행 해시를 계산하고, CSV 행 번호 순서로
행 해시를 결합하여 다시 SHA256을 계산합니다. SQL과 Python 모두 소문자 hex를 사용합니다.
저장된 `_row_sha256`도 별도 집계하여 원본과 대조하므로 기존 해시 열만 신뢰하지 않습니다.
클라우드에서 반환하는 것은 6개 내용 집계와 1개 관계 집계뿐이며 원문/미디어를 내려받지 않습니다.
테이블 description 공란은 데이터 불일치로 간주하지 않습니다. 스키마 불일치는 dry run 전에 중단합니다.
모든 dry run의 예상 바이트 합계가 예산을 넘으면 어떤 실제 쿼리도 실행하지 않습니다.
실제 쿼리는 이전 쿼리의 과금 바이트를 뺀 잔여 예산을 maximum_bytes_billed로 설정합니다.
기본 100 MB에서는 이번 전체 검증을 차단합니다. 필요할 때만 명시적 상한(최대 1 GB)을 설정합니다.

아래 기존 적재 절차는 **다른 신규 ZIP에 대한 별도 승인 시에만 참고**합니다.
이번 기존 스냅샷을 새 64자리 이름으로 다시 적재하는 절차가 아닙니다.


## 보호 범위

기존 historical_records, places, record_place_links, historical_records_test,
ingestion_runs와 공개 MCP·홈페이지·수업용 프리뷰는 수정하거나 연결하지 않습니다.
BIGQUERY_PLACE_SEARCH_ENABLED=false를 유지합니다. 관리자 Preview API도 추가하지 않았습니다.
따라서 기존 ARCHIVE_ADMIN_TOKEN·no-store·접근 정책에 변화가 없습니다.

원본 ZIP SHA256: `15dcc4c5894501266afb2062e7ba8eb4dd9f12970b7f2309e8c14410b80bae90`.
원본 패키지의 schema_manifest.json, analysis.json, conversion_full_check.json은 제공된 근거입니다.
새 실행 결과는 `outputs/bigquery-v2/`에 별도로 기록합니다. 제공된 분석 결과를 새 실행 결과로 간주하지 않습니다.
원본·CSV·샘플·개별 연구 내용은 Git이나 public/data에 추가하지 않습니다.

| 파일 | 행 | 열 |
|---|---:|---:|
| documents.csv | 1,336 | 40 |
| news.csv | 25,085 | 42 |
| photos.csv | 74,836 | 45 |
| videos.csv | 4,612 | 43 |
| places.csv | 22,306 | 21 |
| record_place_links.csv | 163,345 | 8 |

자료 105,869 / 장소 22,306 / 관계 163,345 / 총 291,520행.
PHOTO, MAP, DRAWING은 photos.csv에 함께 있으며 record_type을 임의로 바꾸지 않습니다.

## 로컬 전수 검사 — 클라우드 호출 없음

저장소 루트에서 PowerShell:

```powershell
$zip = 'C:\Users\shclf\Downloads\seoul_bigquery_v2\raw_data.zip'
python scripts/bigquery/v2/audit_snapshot.py --zip $zip --out outputs/bigquery-v2/full-audit.json --preserve-dir outputs/bigquery-v2/originals
python scripts/bigquery/v2/load_zip_bigquery.py --zip $zip --plan-out outputs/bigquery-v2/load-plan.json
python scripts/bigquery/v2/generate_views.py --legacy-hash-tables
$env:RAW_V2_ZIP = $zip
python -m unittest discover -s tests -p test_bigquery_v2.py -v
```

전수 검사는 ZIP 해시, 헤더 순서, 필드 수, 모든 필드의 JSONL 왕복 동일성,
조사 JSON 파싱, 전체 자료 ID 고유성, 장소 ID, 관계 외래키, 중복과 검토상태를 검사합니다.
원본 ZIP 및 6개 CSV는 private outputs 경로에 바이트 그대로 보존하고 해시를 대조합니다.
빈 place_id와 중복 관계는 삭제하지 않습니다. 원본 URL을 자동 열거나 사진·영상을 내려받지 않습니다.
CI에는 원본이 없어 실제 ZIP 테스트는 명시적으로 skip하고 모의 테스트만 실행합니다.

## 적재 — 별도 명시적 사용자 승인 후에만

`requirements-bigquery.txt`의 BigQuery 라이브러리를 사용합니다. 기본 실행은 인증조차 요청하지 않습니다.
승인 전 아래 쓰기 명령은 실행하지 않습니다. 서비스 계정에는 해당 비공개 데이터셋만 접근을 허용합니다.
데이터셋 자체는 자동 생성하지 않습니다.

```powershell
$target = 'seoul-place-docent-514906.seoul_history'
$sha = '15dcc4c5894501266afb2062e7ba8eb4dd9f12970b7f2309e8c14410b80bae90'
python scripts/bigquery/v2/load_zip_bigquery.py --zip $zip --apply --confirm "${target}:$sha"
```

`rawv2_<파일종류>_<전체 SHA256>` 여섯 테이블만 대상으로 합니다.
원본 모든 열은 STRING이며 원본 JSON·빈 문자열·공백도 보존합니다.
추가 필드는 ZIP 해시·파일명·CSV 행 번호·행 해시입니다. 날짜/숫자 변환은 후보 뷰에만 있습니다.
적재 전에 여섯 파일 모두 검사하고 각 파일을 Load Job/WRITE_EMPTY로 원자적 적재합니다.
스키마·행 수·전체 해시 출처·테이블 종류가 일치하는 완료 테이블은 건너뜁니다.
소유권·스키마가 확인된 빈 테이블만 재시도하며 다른 데이터는 중단합니다.

Job ID는 데이터셋·전체 ZIP 해시·파일·시도번호에 고정됩니다.
진행 중/결과 미확인 작업은 같은 ID로 재확인하고, 확정 실패에만 다음 번호를 사용합니다.
한 번의 네트워크 오류 후 임의의 새 ID를 생성하지 않습니다. 최대 20개 실패 이력에서 중단합니다.
여섯 테이블 전체의 트랜잭션은 아니므로 부분 성공은 가능하지만 같은 명령 재실행으로 복구합니다.
공개 승격이나 뷰 생성은 로더가 수행하지 않으며 여섯 테이블 모두 검증 전 후보 뷰를 만들지 않습니다.

## 후보 뷰와 비용 검증

candidate_views.sql은 내부 records/places/links/relation_audit 네 뷰의 DDL입니다.
뷰 SELECT는 읽기 전용이지만 CREATE VIEW 실행 자체는 클라우드 쓰기이므로 별도 승인 대상입니다.
기존 뷰를 교체하지 않습니다. 모든 공개·표시·저장·임베드 허용값은 FALSE입니다.
records는 유형별 누락 필드를 NULL로 채우고 source_row_json에 전체 원본 행을 함께 제공합니다.
media_url, thumbnail_url, record_type, rights_status, review_status,
image_review_status, playback_review_status, segments_json과 각 이용권한은 별도 열입니다.
ALLOWED_REPORTED나 원문확인완료 등의 자유서술을 승인값으로 치환하지 않습니다.

적재 승인 및 여섯 테이블 생성 후 실제 Sandbox 읽기 검증:

```powershell
python scripts/bigquery/v2/verify_sandbox.py --project seoul-place-docent-514906 --dataset seoul_history --confirm-read seoul-place-docent-514906.seoul_history --report outputs/bigquery-v2/full-hash-check.json
# 위 단계는 메타데이터/쿼리 dry run. 실제 COUNT 조회는 추가 옵션이 필요합니다.
python scripts/bigquery/v2/verify_sandbox.py --project seoul-place-docent-514906 --dataset seoul_history --confirm-read seoul-place-docent-514906.seoul_history --execute-counts --zip $zip --report outputs/bigquery-v2/full-hash-check.json
```

기본 쿼리 예산은 100,000,000 bytes, CLI 상한은 1,000,000,000 bytes입니다.
dry run 예상량과 실제 maximum_bytes_billed를 모두 제한합니다. 집계 반환은 6행만입니다.
로컬 계획의 크기는 과금 예측값이 아닙니다. 현재 실제 스토리지·쿼리 비용은 미검증입니다.
직접 SQL 편집기에서 audit_queries.sql을 실행할 때도 같은 바이트 상한을 직접 설정해야 합니다.
Sandbox의 자동 만료(60일)에 대비해 원본을 별도 보관하고 만료 메타데이터를 확인합니다.

공식 근거: [원자적 배치 적재](https://docs.cloud.google.com/bigquery/docs/batch-loading-data),
[Sandbox 제한](https://docs.cloud.google.com/bigquery/docs/sandbox),
[쿼리 비용 제한](https://docs.cloud.google.com/bigquery/docs/best-practices-costs).

## 사람의 승인 및 공개 승격 제안

`approval_gate.py`는 공개 전송 없이 승인 자격만 판정하는 독립 모듈입니다.
원본의 review_status/rights_status로 자동 승인하지 않습니다.
검토자가 접근 통제된 별도 레지스트리에 검토 ID·검토자·시각·만료일·증빙을 기록해야 합니다.
레지스트리 저장소/서명·관리자 편집 화면·실제 공개 exporter는 아직 구현하지 않았습니다.
이 모듈을 사용자 요청의 JSON으로 직접 호출하여 공개를 허용해서는 안 됩니다.

1. 원본 ZIP/기록·장소·관계 각 행 해시를 고정하여 검토 대상을 지정합니다.
2. 사람 재검토, 원문 확인, 권리, 장소, 관계의 다섯 검토 모두 VERIFIED와 HTTPS 증빙을 요구합니다.
3. metadata/display/thumbnail/embed/storage/modification 각각 별도 허가와 근거를 요구합니다.
4. 영상 embed는 별도 재생 확인, 사진·지도·도면 표시/썸네일은 이미지 확인도 요구합니다.
5. EXACT_SITE는 독립적으로 검증된 주소와 유효 좌표·출처가 모두 있어야 합니다.
   UNCERTAIN은 승인 불가, NEARBY/DISTRICT_CONTEXT는 그 범위를 그대로 유지합니다.
6. 만료·반려·철회·원본 변경 시 허용하지 않습니다. 공개 직전 최신 레지스트리로 다시 검사해야 합니다.
7. 향후 exporter는 기존 공개 데이터와 별도 승인 릴리스를 생성하고 담당자가 최종 대조 후 공개합니다.
   이 PR은 그 exporter를 실행하거나 기존 공개 테이블을 갱신하지 않습니다.

장소 22,306개의 도로명/지번/위도/경도는 모두 공란입니다.
EXACT_SITE 원본 2건도 검증된 직접일치가 아닙니다.
관계 UNCERTAIN 81,826 / DISTRICT_CONTEXT 79,903 / NEARBY 1,614 / EXACT_SITE 2.
빈 place_id 2건은 UNCERTAIN, 중복 쌍 2개는 검토 대상으로 보존합니다.
사진 display_permission UNKNOWN 70,786건, ALLOWED_REPORTED 3,791건은 추가 권리 확인 대상입니다.
영상 embed_permission UNKNOWN 4,612건 전부는 임베드 허용하지 않습니다.

## 실행 상태

로컬 전수 검사/모의 재시도/승인 게이트/기존 회귀/빌드 결과는 docs/bigquery-v2-validation-ko.md에 기록합니다.
기존 12자리 테이블의 Sandbox 실쿼리는 후속 보고서에서 확인했습니다. 이번 작업에서 업로드·클라우드 뷰 생성·실배포는 하지 않았습니다.
Draft PR #6 유지, main 병합 및 Production 배포 금지.
