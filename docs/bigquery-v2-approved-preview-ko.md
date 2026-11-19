# 승인자료 선별 Preview — MCP 정식 연결 전 1단계

## 구현 범위

`GET /api/admin/bigquery-v2/approved-records`는 비공개 Preview 관리자 세션을 요구합니다.
기존 `/admin/bigquery-v2/review`에서 로그인한 뒤 같은 호스트에서 호출합니다.
공개 `/mcp`, 공개 MCP 별도 배포 진입점과 홈페이지는 수정하지 않았습니다.
새 환경변수나 마이그레이션은 필요하지 않습니다. 기존 0005/0006과 Preview D1/세션/BigQuery 변수를 사용합니다.
`BIGQUERY_PLACE_SEARCH_ENABLED=false`를 유지합니다.

## 선별 과정

1. D1에서 현재 APPROVED 연결 행만 ID cursor로 최대 20개 읽습니다.
2. 승인 이벤트의 revision·APPROVE 작업·담당자·시각·검토/권리/위치 snapshot이 저장 상태와 같은지 확인합니다.
3. 잘못된 ZIP/행 해시, 빈 장소와 만료된 승인을 제외합니다.
4. 승인 대상 record_id + 연결 CSV 행 번호를 명명 파라미터로 전달해 BigQuery 원본 후보를 한 번 조회합니다. 모든 조회 전에 dry run을 수행합니다.
5. BigQuery 반환 결과를 자료·장소·연결 해시와 ZIP SHA256, 장소 ID, 연결 CSV 행 번호까지 대조합니다. 같은 대상의 원본이 여러 행이면 모호한 것으로 제외합니다.
6. D1 상태를 다시 읽어 BigQuery 조회 중 철회·수정된 승인을 제외합니다. 캐시 없이 매 요청에서 재검사하며 이후 요청도 다시 검사합니다.
7. 기존 Python과 동등한 `reviewEligible`로 다섯 VERIFIED+HTTPS 근거, 권한별 ALLOWED+HTTPS 근거, 만료, 장소와 관계를 재판정합니다.

UNCERTAIN·미연결 관계는 제외합니다. EXACT_SITE는 검증된 주소·좌표·HTTPS 근거가 모두 필요합니다.
DISTRICT_CONTEXT와 NEARBY는 각각 지역/주변 배경 범위를 명시합니다.
질의 주소와의 독립적인 대조 기능은 이번 API에 없으므로 EXACT_SITE라도 `directConnection=false`로 반환합니다.
공개 승격 기능이 없으므로 `approvedForPublicUse=false`, `exported=false`를 반환합니다.

같은 record/place 중복 연결도 연결 CSV 행 번호별로 검증하고 반환합니다. 임의로 삭제하거나 한 행의 승인을 다른 중복 행에 전파하지 않습니다.

## 반환과 비용

제목·유형·연도·기관·HTTPS 원문 URL·자료/장소 ID·관계·공간 범위·검토/권리/위치 증빙을 반환합니다.
`eligibility.actions`는 각 이용권한의 재검증 결과입니다. display/thumbnail은 사진·지도·도면 이미지 확인, embed는 VIDEO와 재생 확인이 추가로 필요합니다.
어떤 action으로 호출해도 이 API는 메타데이터만 반환하며 미디어 원본·썸네일·임베드 URL은 조회하거나 반환하지 않습니다.
승인 레지스트리에는 대상 미디어 바이트가 저장되지 않습니다.

- `limit`: 1~20, 기본 10. `after`: 직전 응답 `nextCursor`.
- `action`: metadata(기본), display, thumbnail, embed, storage, modification.
- `selectedCount`는 현재 페이지에서 자격을 통과한 연결 행 수입니다. `registryCounts`는 D1 상태별 연결/고유 자료 수이며 공개 자격 통과 총계와 다릅니다.
- `nextCursor`가 null이 될 때까지 순회해야 전체 승인 연결의 검증 결과를 알 수 있습니다.
- 한 요청의 BigQuery dry run/실조회는 최대 각 한 번이며, 처리 상한은 기존 설정과 100,000,000 bytes 중 작은 값입니다. 기존 12초 deadline과 job timeout을 사용합니다.
- 담당자별 요청 제한은 3회/분입니다. 요청 제한 카운터만 쓰고 검토 상태·감사·원본은 변경하지 않습니다.
- 승인 대상이 0이면 HTTP 200 빈 목록, `bigQuerySkipped=true`, `budget=null`입니다. 데이터셋이나 BigQuery를 읽지 않습니다.
- 모든 API 응답은 no-store/noindex입니다. Production에서는 404, 미인증/폐기된 세션은 403, 저장소/원본 장애는 503입니다.

## Preview 테스트

Vercel SSO 보호를 통과하고 기존 검토 관리자 화면에서 로그인합니다. 같은 호스트의 브라우저 개발자 도구에서 읽기만 실행합니다:

```js
const response = await fetch('/api/admin/bigquery-v2/approved-records?limit=10&action=metadata', {cache:'no-store'});
const result = await response.json();
console.log({status:response.status, selected:result.selectedCount, registry:result.registryCounts, next:result.nextCursor});
```

응답에 IN_REVIEW 테스트 자료가 포함되지 않는지 확인합니다. 검증을 위해 실제 자료를 APPROVED로 바꾸지 마세요.
승인 0건은 정상 결과입니다. 사진/영상 표시용 DOM이나 임베드를 만들지 않습니다.

로컬 기존 Preview 자격을 서버 환경변수로 안전하게 설정했다면 다음 읽기 전용 smoke를 실행할 수 있습니다. env 파일과 출력은 Git에서 제외된 로컬 경로를 사용합니다.

```powershell
node --experimental-transform-types --import ./tests/ts-resolver.mjs scripts/bigquery/v2/approved_smoke.mjs --confirm-read seoul-place-docent-514906.seoul_history --env-file <기존 Preview 서버 env 파일> --out outputs/bigquery-v2/approved-live-check.json
```

이 smoke는 실제 승인 데이터를 생성하지 않고 현재 레지스트리와 원본을 읽습니다. 최대 20개 연결 한 페이지만 검사하고 nextCursor/complete를 보고합니다. 관리자 HTTP 세션 테스트와 별도인 로컬 서버 서비스 확인입니다.

## 현재 실검증 제한

2026-11-19 이 작업 환경에서 읽기 smoke는 `PREVIEW_D1_CREDENTIALS_MISSING`으로 중단됐습니다.
사용자가 보고한 D1 migration/IN_REVIEW 실저장 성공을 취소하거나 변경하지 않았습니다.
로컬에 기존 Preview D1 읽기 자격이 없어 실제 APPROVED 수·자격 통과 수·Hosted API 응답은 **미검증**입니다. 0건으로 추정하지 않습니다.
이 단계의 실제 BigQuery 쿼리는 실행하지 않았으며 과금 금액은 조회하지 않았습니다.
가상 APPROVED·IN_REVIEW·REVOKED·EXPIRED 자료는 메모리 SQLite에만 생성하며 실제 D1, BigQuery 또는 공개 DB에 저장하지 않습니다.

## MCP 정식 연결 전 남은 작업

Preview에서 실제 읽기 자격으로 0건/실제 승인 건수와 원본 재검증 결과를 확인하고, 사람의 실제 검토·권리 확인을 계속해야 합니다.
공개 exporter/반환 스키마, 질의 주소와 검증 장소의 주소·건축물관리번호 대조, 중복 자료 묶음과 연결별 근거 유지, 매 요청 철회·만료·해시 검사와 권한별 미디어 제공 정책은 별도 개발·승인 대상입니다.
공개 승격과 Production 배포는 이번 코드에 연결되어 있지 않습니다.

## 로컬 검증 결과

- Node 전체 회귀 395/395 통과(이 단계 신규 12개 포함).
- Python 40/40 통과: 실제 원본 ZIP 전수 검사 포함 36개 + 영상 import 4개.
- 타입 검사와 로컬 Vercel 빌드 통과. 신규 경로가 빌드 라우트 목록에 포함됩니다.
- 가상 검증: IN_REVIEW만 있는 저장소는 0건이며 BigQuery 호출 0회. 유효한 APPROVED 1행은 1건. 철회·만료·해시/감사 불일치·UNCERTAIN은 0건.
- 예산 초과 dry run 시 유료 실쿼리 호출 0회, 권한 없는 요청/Production/세션 폐기는 각각 차단합니다.
- 실제 D1 승인 수와 Hosted 선별 결과는 위 자격 부재로 미검증이며 로컬 가상 결과와 구분합니다.
