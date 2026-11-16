# 서울 주소별 BigQuery 역사자료 검색

이 기능은 주소 검색으로 확인한 **자치구와 법정동**에 연결된 검토 완료 자료를 추가로 읽습니다. 주소·동네의 기존 자료는 BigQuery 장애가 있어도 계속 표시됩니다. MCP 서버는 답변 모델을 호출하지 않고 검색 결과와 출처를 AI 클라이언트에 전달합니다.

## 현재 자료 상태와 공개 기준

현재 연구 카탈로그의 일곱 건은 당인리발전소·당인리선 관련 후보입니다. 제목·URL이 있다는 이유만으로 사실이나 사진으로 승인되지 않습니다. 현재 CSV에서는 자료의 검토 상태, 이용조건, 장소 검토, 관계 검토, 중복 검토가 공개 조건을 충족하지 않습니다. 따라서 테이블로 옮겨도 **공개 검색은 0건이어야 정상**입니다. 기존 `historical_records_test` 테이블과 일곱 건은 변경하지 않습니다.

공개 조회에는 아래 조건을 모두 충족한 행만 사용합니다.

- 자료와 연결 행의 `review_status` 및 `link_review_status`가 `content_checked`
- 장소의 `location_review_status`가 `verified`
- 자료 이용조건이 `KOGL0`, `KOGL1`, `public_domain` 중 하나
- 중복 검토 상태가 `unique`, `verified_unique`, `not_duplicate`, `confirmed_unique` 중 하나
- 장소 관계가 `EXACT_SITE`, `NEARBY`, `DISTRICT_CONTEXT` 중 하나
- 원문 URL이 HTTPS

이 필터를 통과해도 `EXACT_SITE`는 자료와 카탈로그 장소의 관계를 나타냅니다. 사용자가 입력한 건물·필지와 같다는 뜻은 아닙니다. 화면과 MCP 응답은 관계 범위를 따로 표시하고, 주소가 같다는 이유만으로 건물을 동일시하지 않습니다. 사진과 영상 파일을 새로 내려받거나 대체 이미지로 만들지 않습니다.

## 테이블 구조

`bigquery/schema.sql`은 다음 새 테이블을 `CREATE TABLE IF NOT EXISTS`로 준비합니다. 기존 네 열짜리 `historical_records_test`는 사용하거나 수정하지 않습니다.

- `historical_records`: 자료·기관·원문·시기·권리·검토·중복 메타데이터와 출처 원본 payload
- `places`: 장소명·주소·자치구·법정동·법정동 코드·WGS84 좌표(있을 때만)·역사 지명·위치 검토 상태
- `record_place_links`: 자료와 장소의 관계 유형·연결 근거·관계 검토 상태
- `ingestion_runs`, `ingestion_run_sources`: 가져오기 작업 이력과 파일별 진행 상태

BigQuery는 외래키를 강제로 검사하지 않습니다. 적재 스크립트가 자료 ID/장소 ID 참조, 중복 ID와 URL, 열 값, 상태를 먼저 검사합니다. 사용자가 입력한 검색어는 SQL에 이어 붙이지 않고 BigQuery 매개변수로 전달합니다. 조회 전 dry run으로 읽을 바이트를 확인하며 `BIGQUERY_MAX_BYTES_BILLED`, `BIGQUERY_MAX_ROWS`, 시간 제한을 적용합니다.

## 처음 한 번: Cloud Console에서 새 테이블 만들기

1. Google Cloud Console에서 프로젝트 `seoul-place-docent-514906`을 선택합니다.
2. `seoul_history` 데이터셋이 `asia-northeast3` 리전에 있는지 확인합니다.
3. 프로젝트 루트에서 아래 명령으로 BigQuery Python 라이브러리를 설치합니다.

   ```powershell
   py -m pip install -r requirements-bigquery.txt
   ```

4. BigQuery 쓰기 권한이 있는 담당자가 자신의 Google 계정으로 `gcloud auth application-default login`을 실행합니다. 서비스 계정 키 파일은 만들거나 GitHub에 올리지 않습니다.
5. 환경변수를 설정합니다.

   ```powershell
   $env:BIGQUERY_PROJECT_ID='seoul-place-docent-514906'
   $env:BIGQUERY_DATASET_ID='seoul_history'
   $env:BIGQUERY_LOCATION='asia-northeast3'
   $env:BIGQUERY_MAX_BYTES_BILLED='104857600'
   ```

6. 먼저 읽기 전용 검증을 실행합니다. 이 명령은 CSV 검증 보고만 내며 BigQuery에 테이블이나 행을 쓰지 않습니다.

   ```powershell
   pnpm bigquery:validate
   ```

7. 보고서에서 오류와 후보 자료 상태를 검토합니다. DDL 및 메타데이터 적재는 별도 승인 후 담당자가 다음 명령을 실행해야 합니다.

   ```powershell
   pnpm bigquery:validate --apply --confirm APPLY
   ```

적재 스크립트는 신규 검토 카탈로그 테이블만 생성하고 MERGE합니다. `historical_records_test`는 수정하지 않습니다. 관리자 권한이나 쓰기 역할이 필요한 실제 적재는 이 작업 중 실행하지 않았습니다. 공개 승인 판단은 별도 연구 검토입니다.

## 웹사이트와 MCP 설정

Vercel의 **Preview** 프로젝트 환경변수에 기존 BigQuery OIDC 설정(자세한 발급·WIF 항목은 [BigQuery 연결 안내](bigquery-integration.md))과 다음 값을 추가합니다. 값을 Production에 복사하지 말고 Preview에서 먼저 확인하세요.

```text
BIGQUERY_PLACE_SEARCH_ENABLED=false
BIGQUERY_PROJECT_ID=seoul-place-docent-514906
BIGQUERY_DATASET_ID=seoul_history
BIGQUERY_LOCATION=asia-northeast3
BIGQUERY_MAX_BYTES_BILLED=104857600
BIGQUERY_MAX_ROWS=25
```

테이블 생성 후, 검토 완료한 자료가 실제로 새 테이블에 있고 Preview OIDC 주체에 BigQuery 작업 실행 및 데이터셋 읽기 권한이 있을 때만 `BIGQUERY_PLACE_SEARCH_ENABLED=true`로 바꿉니다. `historical_records_test`만 있을 때 기능을 켜면 새 테이블이 없어 조회가 실패하지만 웹사이트와 MCP는 기존 D1/JSON 결과로 계속 작동합니다.

`/api/docent`는 기존 동네 이야기와 사진을 우선 구성한 뒤 승인된 BigQuery 자료가 있을 때만 추가합니다. `search_place` → 선택한 주소의 token → `get_place_history` 또는 `prepare_place_answer` 흐름에서도 같은 근거 필터를 사용합니다. `validate_place_answer`는 같은 token·질문의 근거 묶음에 BigQuery 장면이 포함되면 그 ID를 검사합니다. 관리자 API와 `ARCHIVE_ADMIN_TOKEN`은 MCP에 전달하지 않습니다.

현재 공개 MCP 빌드는 Node.js 기반 Vercel Build Output이라 기존 Vercel OIDC 인증을 재사용할 수 있습니다. Cloudflare Workers용 BigQuery 클라이언트는 별도로 제공되지 않으며 `server.cloudflare.ts`는 BigQuery 검색을 비활성으로 처리합니다. Preview 홈페이지 성공만으로 Cloudflare/별도 MCP의 BigQuery 성공으로 간주하지 마세요. 배포 환경별 `/health`와 실제 MCP 도구 호출을 따로 확인해야 합니다.

## 테스트

로컬에서 다음을 실행합니다.

```powershell
pnpm test
pnpm test:bigquery-python
pnpm typecheck
pnpm build:vercel
pnpm build:mcp-public:vercel
```

모의 테스트는 비용 한도, 매개변수 바인딩, 검토·저작권·중복 필터, URL 검사, 인증·테이블 오류의 fallback을 확인합니다. 모의 테스트는 실제 Google 인증이나 BigQuery 권한을 증명하지 않습니다.

Preview 검증 주소는 현재 사용자가 선택한 실제 주소로 실행합니다.

- 마장로42길 16: 마장동 기존 기록을 유지하고 당인리 자료가 나타나지 않아야 합니다.
- 마포구 당인동: 후보 7건은 별도 검토 상태로 확인하고, 공개 응답은 승인된 자료가 없으면 0건이어야 합니다.
- 다른 서울 동네: BigQuery 0건 또는 일시 오류에도 기존 동네 이야기가 보여야 합니다.
- 서울 밖: 기존 주소 API가 거부해야 하고 자료를 조회하지 않아야 합니다.

Google Cloud 인증이 없는 로컬에서는 실제 BigQuery 호출을 검증할 수 없습니다. Preview의 실제 호출 결과, BigQuery job/비용, MCP 호출 응답은 Mock 결과와 따로 기록하세요.

## 새 자료를 넣을 때

먼저 `research-data/records.csv`에 자료 메타데이터, `places.csv`에 확인된 장소, `record_place_links.csv`에 관계 및 근거를 추가합니다. 불확실하면 place ID를 비우거나 `UNCERTAIN` 관계를 쓰고 검토 상태를 유지합니다. URL, 장소 ID, 저작권, 촬영 위치, 중복 여부를 사람이 확인한 뒤 Pull Request로 검토합니다. CSV 행 추가 또는 BigQuery 적재만으로 자료가 공개되지는 않습니다. 검토 상태와 이용조건이 승인 필터를 충족해야만 일반 홈페이지/MCP 검색에 포함됩니다.

## 장애 시

- `BIGQUERY_PLACE_SEARCH_ENABLED`가 `false`면 BigQuery를 호출하지 않습니다.
- OIDC/권한/네트워크/테이블 오류는 안전한 상태 코드로만 처리하며 관리자 비밀이나 토큰을 응답에 넣지 않습니다.
- BigQuery가 꺼져 있거나 오류가 나도 주소 검색과 기존 역사 화면은 계속 사용됩니다.
- 실제 결과가 없으면 관련 자료가 미확보라고 안내하며 다른 장소 자료를 끌어오지 않습니다.
