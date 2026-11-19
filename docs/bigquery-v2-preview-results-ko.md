# BigQuery v2 후보 Preview 검증 — 2026-11-19

저장소 브랜치 `codex/bigquery-place-search`, PR #6 Draft. 구현 커밋 `c5a8d38`.
Vercel Preview 배포는 READY이고 SSO 보호가 활성화돼 있습니다. 익명 요청은 Vercel SSO로 302 리디렉션됩니다.
`BIGQUERY_PLACE_SEARCH_ENABLED=false`를 그대로 유지하고, Preview 배포에서만 `BIGQUERY_V2_PREVIEW_ENABLED=true`로 설정했습니다.

## 실조회 결과

새 Preview 관리자 API 핸들러를 로컬에서 실제 BigQuery v2 후보 뷰에 연결했고, 별도로 보호된 Vercel Preview의 익명 차단을 확인했습니다.
로컬 handler 실조회는 BigQuery ADC 자격으로 실행했으며 각 API 요청마다 dry run과 100,000,000 bytes billed 상한을 사용했습니다.

| 검색 | 결과 | 제한 |
|---|---|---|
| DOCUMENT / NEWS / PHOTO / MAP / DRAWING / VIDEO | 각 2건, HTTP 200 | 각 2건만 응답 |
| 원문 URL | 뉴스 결과 원문 URL 공란 유지 | URL 없으면 생성/추정하지 않음 |
| 기관 + 제목 | 2건, HTTP 200 | 실제 반환 metadata로 조합 |
| 장소명 | 2건, HTTP 200 | `당인` 검색 |
| 자치구 + 법정동 | 2건, HTTP 200 | `성동구`·`마장동` 조건 |
| 2페이지 | 2건, HTTP 200 | pageSize 2, nextPage 3 |
| 서울시 성동구 마장로42길 16 | 0건, HTTP 200 | 그 주소의 건물 직접 연결 없음 |
| 관리자 토큰 없이, Vercel 보호 통과 | 403 | API 관리자 권한 차단 |
| 익명 Vercel 요청 | 302 SSO | 배포 보호 유지 |
| 앱의 Production 설정 | 404 | Preview 기능 차단 |

후보 응답 전부 `미검토 후보 자료`, `directConnection=false`, `approvedForPublicUse=false`입니다.
표시·썸네일·임베드·저장·수정 권한은 모든 결과에서 허용되지 않습니다.
미디어 URL과 영상 segments는 API에서 조회하거나 반환하지 않았습니다.
빈 장소 연결·중복 연결 진단은 유지합니다. 검색 조건은 SQL 명명 파라미터로 전달합니다.

## 실제 처리 바이트

로컬 API 실조회 10회: `totalBytesProcessed=526,502,740`, `totalBytesBilled=629,145,600`.
페이지네이션 조회 1회 추가: 요청당 과금 한도에서 정상 처리.
모든 요청은 100MB 상한을 준수했습니다. 합계 과금 대상 바이트는 1GB 미만입니다.
쿼리 job ID와 전체 응답 증거는 사용자 로컬의 Git 제외 `outputs/bigquery-v2/preview-live.json`, `preview-pagination.json`에 보관합니다.
실제 통화별 비용은 Billing Export에서 조회하지 않아 **미측정**입니다.

## Hosted 관리자 토큰 검증 대기

Vercel CLI의 보호 우회 기능으로 Preview 앱까지 요청할 수 있고, 별도 Vercel SSO 보호는 유지했습니다.
하지만 Preview 환경의 `ARCHIVE_ADMIN_TOKEN`은 Vercel의 sensitive 변수이며 `vercel env pull`이 값을 `[SENSITIVE]`로 대체했습니다.
로컬 `.env.local` 토큰은 Preview 토큰과 일치하지 않아 Preview API가 403을 반환했습니다.
보호를 낮추거나 토큰을 바꿔 hosted 관리자 조회를 강행하지 않았습니다.
따라서 보호된 배포의 실제 BigQuery 관리자 조회는 미검증이고, 같은 코드 경로의 로컬 Preview handler + 실제 BigQuery 실조회는 통과했습니다.
Vercel SSO를 통과할 수 있는 소유자의 기존 Preview 관리자 토큰으로 후속 hosted 실조회가 필요합니다.
토큰을 대화·로그·저장소에 복사하지 않습니다.

## 테스트와 변경

Node 전체 회귀 369개 통과(기존 354 + 신규 15), Python 40개 통과.
타입 검사와 로컬 Vercel 빌드 통과.
수정 파일: `lib/bigquery/candidate-records.ts`, `lib/bigquery/candidate-api.ts`, `lib/bigquery/server.ts`, `lib/bigquery/server.cloudflare.ts`, `app/api/admin/bigquery-v2/records/route.ts`, 테스트 2개, Preview 환경 예시와 가이드.

Draft PR #6 유지. 공개 홈페이지/MCP 연결, 원본 재업로드, BigQuery 테이블 변경, 후보 뷰 재생성, Production 배포 및 main 병합은 하지 않았습니다.
주소·건축물관리번호·권리·원문·사진/영상은 계속 사람의 검토 대상입니다.
