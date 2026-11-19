# 공개 서울 도슨트 MCP 배포

## 주소 및 분리

- ChatGPT 연결 주소: `https://seoul-history-mcp.vercel.app/mcp`
- 상태 확인: `https://seoul-history-mcp.vercel.app/health`
- 홈페이지 Production과 MCP 전용 Vercel 프로젝트 `seoul-history-mcp`를 분리합니다.
- Vercel Build Output API에는 MCP 함수, 소개 페이지, 상태 경로만 포함됩니다. 관리자 API와 Classroom Demo 경로는 404입니다.

## 공개 자료 기준

- 공개 패키지는 사진·문헌 조사자료를 다시 검사해 검토가 끝난 상태만 포함합니다. 검토 대기, 후보, 충돌, 가져오기 경고가 있는 자료는 제외합니다.
- 현재 검토 완료 사진은 0건이고, 검토 완료 영상도 없어 공개 MCP 사진·영상 결과가 비어 있습니다. 원문이 확인되지 않은 이미지를 대신 넣지 않습니다.
- 당인리 자료 등 BigQuery 검색은 공개 빌드에서 BigQuery 연결 코드를 제외하고, Vercel Production 설정도 `BIGQUERY_PLACE_SEARCH_ENABLED=false`로 둡니다.
- 주소 검색은 기존 홈페이지의 공개 `/api/address` 조회를 사용합니다. 주소 API 키는 홈페이지 Vercel에만 남고 MCP 프로젝트에 복사하지 않습니다. MCP는 별도 `MCP_ADDRESS_SIGNING_SECRET`으로 주소 후보 token을 서명·확인합니다.

## 다시 빌드하고 배포하기

Node.js 22.x와 pnpm을 사용합니다.

```powershell
pnpm install --frozen-lockfile
pnpm run build:mcp-public:vercel
vercel deploy --prebuilt --prod --scope shclfclf16 --project seoul-history-mcp --yes
```

Vercel MCP 프로젝트에는 Production용 `MCP_ADDRESS_SIGNING_SECRET`(Secret), `MCP_ALLOWED_ORIGINS`(현재 `https://chatgpt.com,https://chat.openai.com`), `BIGQUERY_PLACE_SEARCH_ENABLED=false`가 설정되어 있습니다. 서명 비밀값을 GitHub나 문서에 복사하지 마세요.

## 보안 점검

- MCP 서버는 읽기 전용이고 관리자 토큰을 사용하지 않습니다.
- MCP 입력은 32 KiB, 주소 검색 응답은 64 KiB로 제한하고, 주소 검색 대상은 코드에 고정된 HTTPS 홈페이지 경로입니다.
- 호출 횟수 제한은 현재 인스턴스마다 분당 120회입니다. 인스턴스가 여러 개로 늘어날 때 적용되는 별도 전역 방화벽/요금 제한은 구성하지 않았으므로 공개 사용량이 늘면 Vercel Firewall의 전역 제한을 추가해야 합니다.
- CORS는 ChatGPT 웹 도메인 두 개만 허용하며, Origin은 사용자 인증 수단이 아닙니다.

## ChatGPT에 연결

ChatGPT 웹에서 **플러그인 → + → 사용자 지정 MCP 서버 추가**를 열고 이름을 입력합니다. 연결 URL에 위 `/mcp` 주소를 넣고 인증 방식은 **인증 없음**을 선택합니다. 경고를 확인하고 저장한 뒤 도구 목록에서 `search_place`, `get_place_history`, `prepare_place_answer`, `validate_place_answer`가 보이는지 확인합니다.

연결 뒤 `마장로42길 16`을 검색하고, 선택된 주소가 서울 성동구 마장동 세림아파트인지 확인합니다. 이어서 역사 조회와 근거 준비를 실행하고 답변 검증을 호출합니다. 주소의 건물·부지 역사 자료는 현재 직접 일치로 검증되지 않았으므로 동네 배경 기록과 구분해야 합니다.

ChatGPT의 맞춤 MCP 사용 가능 여부는 계정 요금제와 워크스페이스 관리자 설정에 따라 달라질 수 있습니다.
