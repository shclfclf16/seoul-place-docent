# BigQuery v2 검증 결과 — 2026-11-19 (KST)

대상: shclfclf16/seoul-place-docent, codex/bigquery-place-search, Draft PR #6.

## 구현 파일

- scripts/bigquery/v2/load_zip_bigquery.py: 전체 SHA256 기반 6개 전용 스냅샷, 명시적 대상 확인, Load Job/WRITE_EMPTY, 실패·부분 성공 재개.
- scripts/bigquery/v2/audit_snapshot.py: 실제 6개 CSV 전수 검사, 모든 필드 왕복 비교, 원본 ZIP/CSV 바이트 보존.
- scripts/bigquery/v2/schema_manifest.json: 원본 6개 스키마와 해시.
- scripts/bigquery/v2/generate_views.py, candidate_views.sql, audit_queries.sql: records/places/관계 분리, 미디어 권한 분리, 공개 승인 FALSE.
- scripts/bigquery/v2/approval_gate.py: 기록·장소·관계 해시에 묶인 사람 검토·권리·위치·행위별 승인 자격 검사.
- scripts/bigquery/v2/verify_sandbox.py: 읽기 전용 메타데이터 검증, 예산 제한 dry run 및 선택적 6행 집계.
- scripts/bigquery/v2/analysis.json, conversion_full_check.json: 사용자 제공 패키지의 분석 근거 보존. 이번 실행 결과와 구분.
- scripts/bigquery/v2/README_KO.md, tests/test_bigquery_v2.py, package.json, .github/workflows/bigquery-ingest-tests.yml: 절차·테스트·실행 명령·CI 통합.

## 로컬 실행 결과

| 검사 | 결과 |
|---|---|
| 실제 ZIP SHA256 | 제공 manifest와 일치 |
| 실제 6개 CSV 전체 값 JSONL 왕복 | 291,520행 전수 동일 |
| 자료/장소/연결 | 105,869 / 22,306 / 163,345 |
| 전 자료 record_id 고유성 | 통과 |
| 비어 있지 않은 외래키 | 누락 0 |
| 빈 place_id / 중복 연결 쌍 | 2 / 2, 원본 보존 |
| 원본 JSON 파싱 | 모든 JSON 열 오류 0 |
| v2 Python 테스트 | 8개 통과, 실제 ZIP 포함, skip 0 |
| 기존 Python 적재 테스트 | 10개 통과 |
| 기존 Node 회귀 테스트 | 354개 통과, 실패/skip 0 |
| npm run typecheck | 성공 |
| npm run build:vercel | 성공, 배포 없음 |
| Python compileall / git diff --check | 성공 |

기본 PATH의 Node 26은 기존 --experimental-transform-types 옵션을 지원하지 않았습니다.
프로젝트 요구 Node 22.21.1로 회귀 테스트와 빌드를 실행했습니다.
샌드박스의 .next 폴더 생성 EPERM 오류는 로컬 빌드 권한 확장 후 해소했습니다.

원본 ZIP 및 6개 CSV는 Git 제외 경로 outputs/bigquery-v2/originals에 저장하고 해시 대조했습니다.
CSV 합계 587,327,373 bytes이며 실제 BigQuery 저장/과금량과는 다릅니다.
개별 실행 로그와 full-audit.json은 outputs/bigquery-v2에 있습니다.

## 실제 클라우드 검증과 미완료 범위

실제 BigQuery 인증·seoul_history 데이터셋 조회·asia-northeast3 리전 확인까지 수행했습니다.
이번 전체 해시 이름의 새 스냅샷은 아직 적재하지 않았으므로 테이블 존재 검사에서 NOT_LOADED로 중단합니다.
따라서 실제 적재 행 수, SQL dry run 예상 바이트, 실제 COUNT 집계, 뷰 SQL 실행은 미검증입니다.
로컬 모의 Load Job 테스트 성공은 실제 업로드 성공을 뜻하지 않습니다.

Google Cloud 업로드/새 뷰 생성/실쿼리/Production 배포/main 병합은 실행하지 않았습니다.
기존 historical_records, places, record_place_links, historical_records_test, ingestion_runs를 변경하는 코드가 없습니다.
공개 MCP/홈페이지/수업용 프리뷰 소스와 데이터, BIGQUERY_PLACE_SEARCH_ENABLED=false 설정을 변경하지 않았습니다.
관리자 Preview API는 추가하지 않았습니다.

## 예산·권리·검토 상태 및 남은 작업

- 쿼리 기본 상한 100 MB, 설정 허용 상한 1 GB. dry run 후 실제 maximum_bytes_billed 적용, 집계 반환 최대 6행.
- 실제 과금·스토리지 사용량은 아직 측정하지 않았습니다. Sandbox 자동 만료와 보존 정책은 업로드 승인 전 확인이 필요합니다.
- 장소 22,306건 모두 도로명/지번/위도/경도 공란. 원본 EXACT_SITE 2건도 공개 직접일치로 사용하지 않습니다.
- 사진 표시: UNKNOWN 70,786 / ALLOWED_REPORTED 3,791 / NEEDS_REVIEW 251 / NOT_AUTHORIZED_REPORTED 8.
- 영상 임베드: UNKNOWN 4,612건 전부. 이미지·영상 다운로드/임베드/복제는 하지 않았습니다.
- 사람 원문·권리·위치·관계 검토가 남아 있습니다. 독립 승인 레지스트리 저장소·관리 화면·실제 공개 exporter는 제안 단계이며 공개 연결은 차단 상태입니다.
- 별도 명시적 업로드 승인 후 6개 테이블 적재 → 실제 Sandbox 검증 → 별도 뷰 생성 승인 → 검토자 심사 순서로 진행합니다.
- Draft PR 유지. main 병합·Production 배포 금지.
