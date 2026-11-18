# BigQuery v2 검토 관리자 저장소 설치

## 저장 구조

검토는 기존 Preview D1 바인딩을 사용하고 `bq_v2_review_state`와 `bq_v2_review_events`에 보관합니다.
기존 archive/public 테이블, BigQuery rawv2, 후보 뷰에는 쓰지 않습니다.
테이블은 원본 ZIP SHA256, 자료 행 해시, 장소 행 해시, 연결 행 해시 및 연결 CSV 행 번호에 묶입니다.
현재 Vercel 프로젝트에는 Preview D1 바인딩 환경변수가 없어 검토 조회·저장 기능이 503으로 닫혀 있습니다.
기존 `.env.vercel.example`의 D1 변수 예시는 있지만 Preview 값은 설정돼 있지 않습니다.
저장소 테이블은 추가나 사용 요금이 발생하는 외부 리소스가 아니며 기존 D1 데이터베이스 안에 만들게 되지만,
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
```

마이그레이션은 두 전용 검토 테이블과 인덱스만 만듭니다. API는 테이블을 자동 생성하지 않습니다.
준비되기 전에는 페이지에서 저장소 설정/마이그레이션 오류를 보여주고 기록을 저장하지 않습니다.

## 관리자 경로와 처리

Preview 전용 UI: `/admin/bigquery-v2/review`
기존 관리자 토큰으로 로그인하면 2시간 HMAC 세션을 발급합니다. 토큰은 JSON 본문으로만 전송되고 브라우저 저장소에 기록하지 않습니다.
세션 쿠키는 HttpOnly/Secure/SameSite=Strict, CSRF 쿠키와 원본 검사도 적용합니다.
다섯 검토 항목과 여섯 이용권한은 상태/근거/의견/검토자/시각을 행별로 남깁니다.
승인은 다섯 항목 VERIFIED, metadata 권한 ALLOWED와 증빙, 존재하는 HTTPS 원문, 180일 이내 만료를 요구합니다.
UNCERTAIN·미연결 관계는 승인할 수 없습니다. EXACT_SITE는 주소·건축물관리번호·좌표 중 검증 위치와 HTTPS 근거가 필요합니다.
모든 저장은 후보를 BigQuery에서 다시 읽어 원본 해시가 여전히 맞는지 검사합니다.
만료·해시 교체·철회 시 승인 상태는 효력을 잃습니다. 공개 MCP·홈페이지로 내보내는 코드는 없습니다.

Photos/video bytes, thumbnail, media/embed URL을 저장하거나 불러오지 않습니다.
로그인 실패 상한은 기존 D1 audit 테이블에 IP digest 기준 12회/15분입니다. IP 원문은 보관하지 않습니다.
모든 API는 Preview/세션을 재검증하고 no-store/noindex를 설정합니다.

## 지금 검증할 수 있는 범위

로컬 SQLite에 마이그레이션을 설치하는 테스트와 서명 세션·CSRF·만료·비Preview 차단 테스트를 실행합니다.
실제 Preview D1의 비밀값과 D1 ID는 제공되지 않아 원격 migration·영구 audit roundtrip·로그인 운영 검증은 미실행입니다.
Preview에서 변수 설정/migration이 끝나기 전에는 실제 관리자 저장을 할 수 없습니다.
기존 공개 권한·`BIGQUERY_PLACE_SEARCH_ENABLED=false` 설정은 유지됩니다.
