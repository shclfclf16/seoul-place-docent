# BigQuery v2 비공개 Preview 관리자 조회

## 경로와 보호

`GET /api/admin/bigquery-v2/records`는 `VERCEL_ENV=preview`와 `BIGQUERY_V2_PREVIEW_ENABLED=true`일 때만 활성화됩니다.
Production/개발/Cloudflare에서는 닫혀 있습니다. Preview에서도 기존 `ARCHIVE_ADMIN_TOKEN`과 `x-archive-admin`이 필요하고 교차 Origin 요청은 거부합니다.
Vercel 프로젝트의 기존 인증 보호(`all_except_custom_domains`)를 유지합니다. 공개 URL에 토큰을 넣지 마세요.
모든 성공/거부/오류 응답은 브라우저와 CDN 모두 no-store, noindex, no-referrer입니다.

필터: institution(부분일치), recordType(일치), district(일치), legalDong(일치), placeName(부분일치), title(부분일치).
각 텍스트 최대 120자. page 기본 1, pageSize 기본 25/최대 50, offset 최대 10,000입니다.
조건·LIMIT·OFFSET은 모두 명명 SQL 파라미터이며 테이블 이름은 서버의 고정 ZIP 해시에서 생성합니다.
`nextPage`는 다음 페이지가 있을 때만 반환합니다. 공개 페이지의 주소 검색과 연결하지 않습니다.

## 기존 검색과 스키마 차이

| 항목 | 기존 승인 검색 | v2 후보 서비스 |
|---|---|---|
| 소스 | historical_records/record_place_links/places | v2_records/v2_links/v2_places 전체 SHA256 뷰 |
| 기록 | content_checked·권리 승인·중복 확인 필터 | 원본 검토상태 그대로, 모든 행 미검토 표시 |
| 유형별 필드 | evidence_excerpt 등 공통 승인 스키마 | 유형별 미디어 검토/이용권한 NULL 가능, 명시적 열만 조회 |
| 연도 | 정제 숫자 | 후보 뷰의 SAFE_CAST INT64/NULL |
| 위치 | 검증된 좌표·주소로 직접/인접 판정 | 원본 주소·좌표 공란; 직접연결 항상 false |
| 관계 | 검토된 EXACT_SITE/NEARBY/DISTRICT_CONTEXT | UNCERTAIN 포함; 원본 관계와 표시 범위를 별도 반환 |
| 공개 | 승인된 자료에 한정 | 승인값 자동 변경 없음, 공개 승인 항상 false |

v2_relation_audit는 진단 개요용입니다. 이 API는 개별 링크 행 번호와 중복 수를 유지하기 위해 links와 places를 직접 LEFT JOIN합니다.
DISTINCT로 중복 연결을 제거하지 않습니다. `duplicateLinkCount`, `linkRowNumber`, `emptyPlaceId`, `auditState`를 반환합니다.
관계 없는 자료도 NO_LINK로 유지합니다. 원본 EXACT_SITE는 UNVERIFIED_EXACT_SITE, NEARBY는 UNVERIFIED_NEARBY로 표시합니다.
검증된 주소/건축물관리번호/별도 승인 저장소를 연결하지 않았으므로 어떠한 후보도 건물 직접 역사로 반환하지 않습니다.

## 미디어·원문 링크

표시·썸네일·임베드·저장·수정 권한을 각각 독립된 상태로 반환합니다. 원본 ALLOWED/ALLOWED_REPORTED도 공개 승인으로 해석하지 않습니다.
별도 승인 레지스트리가 없는 이 Preview는 모두 allowed=false입니다.
media_url/thumbnail_url/embed_url/segments_json/원본 조사 JSON을 SELECT하거나 응답에 포함하지 않습니다.
사진·영상 다운로드, 표시, 썸네일 생성, 복제, 임베드는 수행하지 않습니다.
원문 링크는 인증정보 없는 HTTPS URL만 반환하며 누락/부적합 URL은 null입니다. 원문 링크도 자동 fetch/prefetch하지 않습니다.

## 비용·시간·장애 격리

`BIGQUERY_V2_MAX_BYTES_BILLED` 기본 100,000,000바이트, 설정 상한 1,000,000,000바이트입니다.
각 요청은 dry run 후 한도 안에서만 실제 SELECT를 실행하며 maximumBytesBilled도 적용합니다.
실제 결과는 pageSize+1행까지만 읽고 클라이언트에는 pageSize행까지만 반환합니다.
BigQuery 대기 8초·jobTimeoutMs 8초·전체 응답 제한 12초입니다. BigQuery 자체 취소는 플랫폼의 best-effort이므로 바이트 상한도 함께 적용합니다.
추가 결과 토큰/미완료 작업/인증 오류/상한 초과는 503으로 닫고 내부 오류·비밀값을 노출하지 않습니다.
자동 재시도나 공개 데이터 fallback을 수행하지 않습니다. 응답 budget에는 예상·실처리·과금 대상 바이트와 Job ID가 있습니다.

기존 BIGQUERY_PLACE_SEARCH_ENABLED=false 유지. 공개 MCP/홈페이지 검색 및 기존 승인 테이블 변경 없음.
Vercel Preview 보호·권한·no-store를 해제하지 않습니다. 실서버 장애도 새 관리자 API의 503으로 제한됩니다.

공식 API 계약: https://docs.cloud.google.com/bigquery/docs/reference/rest/v2/jobs/query

## 검증 명령

로컬 테스트는 Node 22 사용. 실제 읽기는 별도 명시적 인자가 필요합니다.

```powershell
npm test
npm run typecheck
npm run build:vercel
node --experimental-transform-types --import ./tests/ts-resolver.mjs scripts/bigquery/v2/preview_smoke.mjs --confirm-read seoul-place-docent-514906.seoul_history --out outputs/bigquery-v2/preview-live.json
```

smoke는 로컬 Preview API 핸들러를 실제 BigQuery에 연결하며 원본을 변경하지 않습니다. 1회 누적 과금 대상 상한 1GB입니다.
각 자료 유형/기관·제목/장소명/행정동 조건/페이지/마장로42길 16/관리자 미인증/Production 차단을 확인합니다.
실행 결과와 hosted Preview 검증 여부는 별도 검증 보고서에 기록합니다.
