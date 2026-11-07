# 내 AI 연결과 MCP 호출 확인

작업 기준: `shclfclf16/seoul-place-docent`의 main `d216679`. 브랜치: `codex/user-ai-integration`.
기존 `codex/verify-client-ai`/PR #1은 홈페이지 AI를 차단하는 별도 작업입니다. **이번 요구는 AI 기능 유지이므로 그 PR을 함께 병합하지 마세요.** 이번 브랜치는 main에서 새로 시작했습니다. 운영 배포·main 병합 없음.

## 사용 방법

1. 홈페이지의 **자료실·안내 → 내 AI 연결 안내** 또는 `/ai-guide`를 엽니다. 주소를 선택하면 결과 안에도 같은 패널이 나타나며 질문에 해당 주소가 반영됩니다.
2. ChatGPT, Claude, Gemini 중 하나를 선택합니다. 안내는 연결 방법이며 자동 연결·자동 생성 버튼이 아닙니다.
3. MCP URL을 복사해 해당 AI의 연결 설정에 등록하고 서버에서 요구하는 인증을 마칩니다. `127.0.0.1`은 내 컴퓨터 전용입니다. 클라우드 AI에는 접근 가능한 HTTPS 주소가 필요합니다.
4. **역사 질문 복사** 후 해당 AI의 대화에 붙여 넣습니다. 주소는 복사한 질문 안에만 있고 AI 서비스 링크에는 넣지 않습니다. 서명 token·비밀키·GPS는 패널로 전달하지 않습니다.
5. AI의 실제 도구 실행 내역에서 `search_place` → 주소 선택 → `prepare_place_answer` → 가능하면 `validate_place_answer` 순서를 확인합니다. 도구 결과의 `mcpReceipt.requestId`를 보관합니다.
6. 최종 답변의 자료 ID·출처 링크를 도구 응답과 대조합니다. 요청 ID만으로 AI가 내용을 실제 사용했다고 증명할 수 없습니다.

## 서비스별 조건 (2026-11-07 공식 문서 확인)

| 서비스 | 연결 안내 | 실제 계정 시험 |
|---|---|---|
| ChatGPT | 웹 Plugins → + → Add custom MCP server. 계정/워크스페이스의 권한 확인, 인증 설정 후 설치·대화에서 선택 | 미검증 |
| Claude | Customize → Connectors → + Add → Add custom connector. Free 포함 지원, Free는 맞춤 연결 1개. Anthropic 클라우드에서 서버에 접근 | 미검증 |
| Gemini | 웹 Settings → Connected Apps → Custom apps. 맞춤 앱 문서상 미국·18세 이상·개인 계정·영어·활동 저장 조건 | 미검증. 한국 일반 계정 지원 보장 불가 |

Google의 Spark 변경 안내와 일반 맞춤 앱 안내에는 적용 범위 차이가 있습니다. 계정 화면에서 실제 제공 여부를 확인하며 구독 구매나 지역 변경을 전제로 하지 않습니다.

출처: [ChatGPT](https://developers.openai.com/api/docs/guides/custom-mcp-server), [Claude](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp), [Gemini 맞춤 앱](https://support.google.com/gemini/answer/17209137?co=GENIE.Platform%3DDesktop&hl=en-PR), [Gemini Spark 변경 안내](https://support.google.com/gemini/answer/17171264?hl=en-4).

## 관리자 통계

`/admin/mcp`를 열어 관리자 키를 입력하고 **통계 조회**를 누릅니다. 키는 환경변수 `ARCHIVE_ADMIN_TOKEN`과 같아야 합니다. 브라우저 저장소·주소창에 저장하지 않으며, **화면 잠그기**로 입력값과 조회 결과를 지울 수 있습니다. 인증 전에는 통계를 내려받지 않습니다.

- 오늘(한국 시간)/전체/성공/실패/자료 반환/근거 검사 수, 도구별 건수, 평균/P95 시간, 최근 오류 유형을 표시합니다.
- **요청 ID 확인**으로 기록 한 건을 찾습니다. 이 조회도 관리자 인증이 필요합니다.
- `mcp_request_log`는 처음 기록할 때 D1에 추가되는 테이블입니다. 기존 `mcp_client_docent_log`의 검색·검증 통계는 그대로 재사용하며 변경하지 않습니다. 기존 자료를 삭제하거나 수정하지 않습니다.
- 저장 필드: 요청 UUID, 시각, 등록된 도구명, 성공 여부, 반환 자료 수, 도구 처리 ms, 제한된 오류 코드, 기계적 검증 상태, 클라이언트 `unverified`.
- 질문·전체 주소·GPS·사진·키·사용자 ID·대화/답변 원문은 이 로그에 저장하지 않습니다. User-Agent나 임의 클라이언트 이름을 검증된 AI 종류로 취급하지 않습니다.
- 저장이 안 되면 응답의 `persisted:false`로 표시합니다. D1이 없으면 관리자 API는 503이며 가짜 통계를 표시하지 않습니다. 저장 성공한 도구 실행만 집계하므로 HTTP 거절/잘못된 도구명/DB 실패 건수는 총계에 포함되지 않습니다.
- 반환 자료 수는 주소 도구의 후보, 근거 도구의 기록, 검증 도구의 출처 개수입니다. 지연 시간은 도구 실행 시간이며 로그 저장·AI 생성 시간은 제외합니다.
- 성공은 도구 처리 성공입니다. 자료 없음이나 검증 거절도 정상 처리일 수 있습니다. AI 답변 완료·실제 자료 사용·사용자 토큰 소비는 별도 확인입니다.
- 새 로그에는 자동 삭제 정책을 넣지 않았습니다. 운영자가 보관 기간과 규모에 따른 집계/정리 정책을 정해야 합니다. P95는 저장된 전체 기록을 대상으로 계산합니다.

## 로컬 실행 (Windows PowerShell)

Node.js 22.19 이상(프로젝트 지정 22.x), 프로젝트 지정 pnpm을 설치하고 저장소 폴더에서 실행합니다.

```powershell
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm run build:vercel
pnpm exec next start --hostname 127.0.0.1 --port 5180
```

브라우저에서 `http://127.0.0.1:5180/ai-guide`, `http://127.0.0.1:5180/admin/mcp`를 엽니다. 별도 PowerShell에서 다음 명령은 실제 HTTP 초기화·도구 목록·GPS 없음 안내를 확인합니다.

```powershell
node scripts/smoke-user-ai-mcp.mjs
```

서버 중지는 실행한 PowerShell에서 Ctrl+C입니다. 이 명령들은 공개 배포를 하지 않습니다.

## 환경변수와 배포 경계

- 기존 주소/지도 키는 유지합니다. 주소 조회 `JUSO_API_KEY`, GPS 역주소 `KAKAO_REST_API_KEY` 등이 필요합니다. 키 없는 환경에서는 해당 기능이 준비 중/오류로 표시됩니다.
- Vercel의 D1 연결은 기존 `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_D1_DATABASE_ID`, `CLOUDFLARE_D1_API_TOKEN`을 사용합니다. Sites/Cloudflare에서는 `DB` 바인딩을 사용합니다. R2는 기존 설정을 유지합니다. 발급·설정은 [기존 배포 문서](vercel-deployment.md)를 따릅니다.
- 관리자 인증은 기존 `requireArchiveAdmin`을 재사용합니다. Vercel은 `oai-authenticated-user-*` 헤더로 관리자 권한을 주지 않습니다. Sites는 신뢰된 배포 게이트웨이의 소유자 인증을 사용합니다.
- `MCP_ALLOWED_HOSTS`는 쉼표로 구분한 호스트(포트 포함), `MCP_ALLOWED_ORIGINS`는 정확한 origin 목록입니다. 기본 origin은 같은 출처만 허용하며 Origin 없는 서버 간 요청은 허용합니다. 잘못된 Origin은 GET/POST 모두 403입니다. 교차 출처 브라우저용 CORS 허용은 기본 제공하지 않습니다.
- MCP 자체는 기존 Sites 게이트웨이 인증에 의존합니다. Vercel에서는 그 인증이 자동 생기지 않습니다. **실제 Vercel 공개 연결 전에 별도 검증된 MCP 인증 게이트웨이/OAuth와 플랫폼 호출 제한을 구성해야 합니다.** 이번 변경은 임의 토큰 인증이나 자체 OAuth 발급기를 만들지 않았습니다.
- 앱의 분당 120회 제한은 인스턴스 전체에 대한 임시 보호입니다. 사용자별/분산 전역 한도가 아니므로 운영에서는 Cloudflare/Vercel 측 보호가 추가로 필요합니다. 사용자 IP를 로그에 저장하지 않습니다.
- 기존 운영 Sites `/mcp`는 앞선 검사에서 401과 OpenAI OAuth 메타데이터를 반환했습니다. 현재 도구 계정에서 사이트 프로젝트를 찾을 수 없어 원격 인증 연결은 미완료입니다. 이 새 코드가 운영에 반영되었다고 표시하지 않습니다.

## 비용과 프로토콜

MCP 흐름은 `app/mcp/route.ts → 주소 검증/자료 조회 → preparePlaceAnswer/validateAnswer`이며 모델 호출이 없습니다. 질문 분류와 최종 설명은 호출한 이용자 AI가 합니다. 사용자 구독이 외부 홈페이지 API 키로 바뀌는 구조가 아닙니다.

기존 홈페이지의 `AISummaryPanel → /api/ai-summary`, `DocentStory → /api/docent/narration`, 번역 함수·캐시·OpenAI 연동은 **main 그대로 유지**합니다. 이 경로는 운영자 모델 비용이 발생할 수 있습니다. MCP가 모델을 호출하지 않아도 호스팅·D1·R2·주소 API 비용은 별도입니다.

Streamable HTTP는 기존 JSON 응답/무상태 방식을 유지합니다. 초기화 버전 협상, 알림 202, JSON-RPC 오류, 본문 32KiB 제한, Content-Type/Accept/프로토콜 헤더 검사를 합니다. SSE 스트림·세션 ID는 사용하지 않고 GET/DELETE는 405입니다. [MCP 전송 명세](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)를 참고했습니다. 기존 신규/레거시 버전 호환 선언은 유지했으며 모든 버전별 인증 적합성을 실증한 것은 아닙니다.

## 검증 결과와 남은 작업

| 변경 파일 | 목적 |
|---|---|
| `app/components/UserAiPanel.tsx`, `user-ai.css`, `lib/user-ai-guide.ts` | AI 선택·주소 질문·연결 안내·복사 |
| `app/components/DocentHome.tsx`, `app/ai-guide/page.tsx` | 기존 홈페이지에 패널 및 안내 진입점 연결 |
| `lib/mcp-audit.ts` | 개인정보 없는 실행 영수증 저장·집계 |
| `lib/mcp-http.ts`, `app/mcp/route.ts`, `lib/mcp-protocol.ts` | 전송 검사·호출 기록 연결·MCP 메타데이터 |
| `app/api/mcp-admin/route.ts`, `app/admin/mcp/page.tsx` | 인증된 통계·요청 ID 조회 |
| `tests/mcp-integration.test.mjs`, `tests/ts-resolver.mjs` | 실제 라우트/SQLite/보안/모델 호출 차단 검사 |
| `scripts/smoke-user-ai-mcp.mjs` | 로컬 HTTP 클라이언트 재현 |
| `.gitignore` | 실제 비밀값 파일과 Python 캐시 업로드 방지 |
| `docs/USER_AI_SETUP_KO.md`, `docs/verification/user-ai-*` | 설치·검증·제약과 실행 로그 |

- 새 통합 테스트 8개 통과: 실제 POST 라우트 초기화·8도구·기존 근거 반환, 모든 fetch 차단 상태 모델/외부 요청 0회, 잘못된 좌표·GPS 없음, SQLite 실제 SQL 저장/통계/P95/개인정보 제외, 저장 실패, 관리자 위조 헤더 거절, HTTP 보안, 주소 질문 구성.
- 전체 테스트: 수정 전 main 270개 중 257 통과/13 실패, 변경 후 278개 중 265 통과/13 실패. **실패 이름 13개가 동일**합니다. 기존 자료 원본 해시/크기·집계 건수·사진 허용조건 기대값과 관련된 문제입니다. 실제 자료와 검토 기준을 확인하지 않고 기대값을 바꾸지 않았습니다. 전체 테스트 성공은 아닙니다.
- Vercel Next.js webpack 빌드 성공(43/43 페이지, `/ai-guide`, `/admin/mcp`, `/api/mcp-admin`, `/mcp`). 빌드의 타입 검사도 통과했습니다.
- 브라우저: AI 선택 전환·질문 복사·인증 없는 관리자 통계 접근 거절 확인. 홈페이지 주소 선택 이후 패널은 코드/질문 단위 검사이며 실제 키로 화면 전체를 다시 호출하지 않았습니다. 기존 AI 기능 보존은 main과 파일 비교 및 기존 테스트로 확인했습니다.
- 로컬 HTTP 클라이언트도 2025-11-25 초기화, 8개 도구 목록, needs_location 결과와 요청 ID를 확인했습니다. 로컬 DB 미연결로 persisted:false였습니다.
- 생산 D1 실제 저장·Cloudflare/Sites 빌드·외부 AI 계정·실제 스마트폰 GPS·운영 비용 청구 내역은 이번 변경에서 미검증입니다. 로컬 SQLite와 테스트용 서명 주소를 실제 D1·실주소 API 성공으로 해석하지 마세요.

검토자는 기존 AI 기능을 차단하는 PR #1과 이번 변경을 구분해야 합니다. 새 브랜치의 변경 파일을 검토하고 기존 13개 실패를 분류한 뒤, 배포 승인을 거쳐 접근 가능한 원격 MCP에서 AI별 실제 도구 실행과 최종 인용을 검증하세요.

## 로컬 관리자 통계 추가 설정

D1 계정이 없는 로컬 시험에서는 `.env.local`에 `ARCHIVE_ADMIN_TOKEN`과 `MCP_LOCAL_AUDIT_FILE=.wrangler/local-mcp-audit.sqlite`를 설정할 수 있습니다. 이 SQLite 파일은 MCP 호출 통계만 저장하며 역사자료 DB로 사용하지 않습니다. 키 파일과 DB 파일은 Git에서 제외됩니다. 서버 재시작 이후의 실제 호출부터 기록하며 과거 미저장 호출은 복구하지 않습니다. 이 통계는 해당 컴퓨터 전용으로 운영 서버 집계와 다릅니다. D1이 연결되어 있으면 D1이 우선합니다.
