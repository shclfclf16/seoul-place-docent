# BigQuery v2 검토 관리자 저장소 설치

## 저장 구조

검토는 기존 Preview D1 바인딩을 사용하고 `bq_v2_review_state`와 `bq_v2_review_events`에 보관합니다.
기존 archive/public 테이블, BigQuery rawv2, 후보 뷰에는 쓰지 않습니다.
테이블은 원본 ZIP SHA256, 자료 행 해시, 장소 행 해시, 연결 행 해시 및 연결 CSV 행 번호에 묶입니다.
현재 Vercel 프로젝트에는 Preview D1 바인딩 환경변수가 없어 검토 조회·저장 기능이 503으로 닫혀 있습니다.
기존 `.env.vercel.example`의 D1 변수 예시는 있지만 Preview 값은 설정돼 있지 않습니다.
검토 테이블은 담당자가 지정한 기존 D1 데이터베이스 안에 만들며, D1 사용량과 요금은 해당 계정 정책을 따릅니다.
이번 작업은 원격 마이그레이션을 적용하지 않았습니다.

## Preview 설정 담당자 실행 단계

사용자가 기존 영구 D1을 선택해 Preview 환경에 다음 서버 전용 변수를 등록해야 합니다:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_D1_DATABASE_ID` (기존 데이터베이스 UUID)
- `CLOUDFLARE_D1_API_TOKEN` (그 DB에 제한된 최소 권한)
- `ARCHIVE_REVIEW_SESSION_SECRET` (암호학적으로 무작위인 32바이트 이상)
- 기존 `ARCHIVE_ADMIN_TOKEN`, Preview Vercel SSO, `BIGQUERY_V2_PREVIEW_ENABLED=true`

프로젝트 ID·대시보드·D1 ID를 임의로 만들지 마세요. Production 또는 Production branch에 이 변수들을 복사하지 마세요.
먼저 D1 ID와 대상이 Preview인지 담당자가 확인한 다음 별도 승인 절차로 migration을 실행합니다:

```powershell
npx wrangler d1 execute <기존 D1 데이터베이스 이름> --remote --file drizzle/0005_bigquery_v2_reviews.sql
npx wrangler d1 execute <기존 D1 데이터베이스 이름> --remote --file drizzle/0006_bigquery_v2_review_sessions.sql
```

마이그레이션은 검토 상태·감사 이벤트·요청 제한·서버 세션 전용 테이블과 인덱스를 만듭니다. API는 테이블을 자동 생성하지 않습니다.
준비되기 전에는 페이지에서 저장소 설정/마이그레이션 오류를 보여주고 기록을 저장하지 않습니다.

## 관리자 경로와 처리

Preview 전용 UI: `/admin/bigquery-v2/review`
기존 관리자 토큰과 담당자 ID로 로그인하면 2시간 HMAC 세션을 발급하고, 세션 digest를 D1에 보관합니다. 담당자 ID는 관리자 본인 입력이며 외부 신원 검증을 대신하지 않습니다. 서버는 매 요청마다 세션 레지스트리·만료·자격 digest를 다시 확인하고, 로그아웃 시 레지스트리에서 폐기합니다. 토큰은 JSON 본문으로만 전송되고 브라우저 저장소에 기록하지 않습니다.
세션 쿠키는 HttpOnly/Secure/SameSite=Strict, CSRF 쿠키와 원본 검사도 적용합니다.
다섯 검토 항목과 여섯 이용권한은 상태/근거/의견/검토자/시각을 행별로 남깁니다.
승인은 다섯 항목 VERIFIED, metadata 권한 ALLOWED와 증빙, 존재하는 HTTPS 원문, 180일 이내 만료를 요구합니다.
UNCERTAIN·미연결 관계는 승인할 수 없습니다. EXACT_SITE는 기존 Python의 보수적 조건을 유지해 실제 주소와 유효한 위도·경도, HTTPS 위치 증빙이 모두 필요합니다. 건축물관리번호만으로 완화하지 않습니다.
모든 저장은 후보를 BigQuery에서 다시 읽어 원본 해시가 여전히 맞는지 검사합니다.
만료·해시 교체·철회 시 승인 상태는 효력을 잃습니다. 공개 MCP·홈페이지로 내보내는 코드는 없습니다.

Photos/video bytes, thumbnail, media/embed URL을 저장하거나 불러오지 않습니다.
로그인 실패 상한은 기존 D1 audit 테이블에 IP digest 기준 12회/15분입니다. IP 원문은 보관하지 않습니다.
검토 API 요청 제한은 담당자별 12회/분이고, 모든 API는 Preview/세션을 재검증하고 no-store/noindex를 설정합니다.
검토 상태 필터는 BigQuery 검색 페이지 안에서 적용합니다. 빈 페이지라도 다음 페이지가 있으면 이어서 검색할 수 있습니다. 원본 전체를 내려받아 대기열을 만들지 않습니다.
`reviewEligible`은 Python interchange 형식과 같은 자격 판정 함수이며 공개 exporter와 연결되어 있지 않습니다. 사진/지도/도면의 display·thumbnail은 이미지 검증, embed는 VIDEO와 재생 검증을 추가로 요구합니다.

## 지금 검증할 수 있는 범위

로컬 SQLite에 실제 migration을 설치하고 API 저장·재조회·감사 로그·동시 수정·감사 실패 rollback·원본 해시 변경·권리·세션·CSRF·만료·비Preview 차단을 테스트합니다. Python과 TypeScript에 같은 14개 승인 사례를 넣어 결과 일치성을 확인합니다.
실제 Preview D1의 비밀값과 D1 ID는 제공되지 않아 원격 migration·영구 audit roundtrip·로그인 운영 검증은 미실행입니다.
Preview에서 변수 설정/migration이 끝나기 전에는 실제 관리자 저장을 할 수 없습니다.
기존 공개 권한·`BIGQUERY_PLACE_SEARCH_ENABLED=false` 설정은 유지됩니다.

## 2026-11-19 로컬 실제 BigQuery 확인

새 해시/위치 필드를 포함한 후보 API를 실제 BigQuery에 읽기 전용으로 연결했습니다.
DOCUMENT 2행, 원문 HTTPS 링크 2개, HTTP 200이며 모두 미검토·미디어 권한 차단 상태였습니다.
필수 dry run 예상 93,181,013 bytes, 실제 처리 93,181,013 bytes, 과금 대상 93,323,264 bytes로 요청 상한 100,000,000 bytes 이내입니다.
Job ID: `job_wUKpSLtoIQKf0V9fd7pIWLf8Ycn4`. 통화 비용은 Billing Export에서 조회하지 않아 미측정입니다.
로그는 Git 제외 `outputs/bigquery-v2/review-live-check.json`에 보관합니다.
Hosted 관리자 UI/D1 실저장과 브라우저 시각 검증은 실행하지 않았습니다. 실제 후보 승인, BigQuery 쓰기, 원격 migration은 없습니다.

기존 D1 HTTP 런타임의 batch 요청 형식은 [Cloudflare query API](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/)와 대조했습니다.
공개 승격은 별도 exporter, 권한별 재검증, 만료·원본 해시·철회 재검사 및 별도 배포 승인이 필요합니다.

## 로컬 검증 결과

- Node 전체 회귀 383개 통과(기존 369개 + 검토 관련 14개).
- 검토 전용 14개: 영구 SQLite 파일 재연결, 변경 감사, 동시 쓰기/rollback, 빈 연결, 해시 변경, 권리/승인, 세션 폐기, 요청 제한 포함.
- Python 전체 36개 및 영상 import 4개 통과. RAW_V2_ZIP으로 실제 ZIP 전수 검사를 포함했습니다.
- 타입 검사와 Vercel 빌드는 로컬에서 실행합니다. 원격 D1 적용/Hosted 로그인·저장은 별도 검증 대상입니다.
