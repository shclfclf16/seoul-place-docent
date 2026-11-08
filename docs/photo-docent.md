# 사진에서 시작하는 서울 도슨트

2026-11-08 기준. 구현 대상은 shclfclf16/seoul-place-docent의 main이며 작업 브랜치는 codex/photo-docent입니다.

## 사용 경로

1. 스마트폰 카메라에서 위치 저장을 켜고 찍은 JPEG 원본을 모바일 웹에서 선택합니다.
2. 브라우저가 최대 20MB JPEG의 EXIF GPS를 읽습니다. 원본 이미지와 파일명은 전송하지 않습니다.
3. 좌표만 POST /api/map-address에 보내 카카오 좌표 변환과 기존 공식 주소 검색을 실행합니다.
4. 촬영 위치의 도로명·지번·법정동·행정동을 표시합니다. 후보가 하나여도 사용자가 주소를 확인하며, 복수 후보는 사용자가 선택합니다.
5. 정확한 건물 주소를 확인할 수 없으면 '이 동네 기록 보기'로 법정동 자료를 열 수 있습니다. 촬영 위치와 사진 속 피사체의 위치는 서로 다를 수 있습니다.
6. 기존 문헌·사진·영상 패널로 자료를 조회합니다. 주소 후보를 선택한 경우 '내 AI에 전달할 역사·사진·영상'에서 질문과 근거 JSON을 복사합니다.
7. 사용 중인 ChatGPT·Claude·Gemini에 붙여넣습니다. MCP가 연결돼 있으면 search_place → prepare_place_answer로 갱신하고 validate_place_answer로 기존 문헌·사진 장면의 근거 ID 등을 검사합니다.

위치정보가 없거나 사진이 손상되면 주소 입력·지도 선택·현재 위치 버튼을 안내합니다. 현재 위치는 버튼을 눌러 브라우저 권한을 허용한 경우만 사용합니다. 현재 위치의 오차 범위를 표시하고 동일한 주소 확인을 거칩니다. 지도 선택과 주소 검색의 기존 동작은 유지합니다.

## 지원 범위

| 항목 | 상태 |
| --- | --- |
| JPEG GPS, little/big endian TIFF | 구현 완료, 합성 EXIF로 검증 |
| Android·iPhone 원본 JPEG | JPEG 형식 지원, 실기기 미검증 |
| HEIC/HEIF | 미지원, JPEG 변환 또는 주소 입력 안내 |
| GPS→서울 주소 | 기존 카카오·주소 검색 재사용, 모의 응답으로 통합 검증 |
| 실제 카카오 좌표 변환 | 카카오 REST API 키 미발급으로 미검증 |
| 복수·단일 주소 후보 확인 | 구현 완료 |
| 동네 사진·영상 조회 | 기존 자료 재사용 |
| 건물·부지 직접 일치, 거리 기반 주변 시설 판정 | 미구현, 후보와 동네·자치구 배경으로 안내 |
| 사용자 AI용 근거 준비·복사 | 구현 완료 |
| AI 계정에서 최종 해설 완료 | 실계정 미검증 |
| Vercel 운영 반영 | 배포 전 |

서버가 사진을 해석해 주소를 추측하는 경로는 없습니다. 파일명·MIME 형식과 실제 JPEG 시작·EXIF 구조를 검사합니다. HEIC를 JPEG로 이름만 바꿔도 GPS 추출 성공으로 처리하지 않습니다.

## 재사용한 구조와 추가한 코드

- lib/photo-gps.ts의 readPhotoGps(buffer) 시그니처를 유지하면서 손상·범위 검사와 JPEG 마커 처리를 보완했습니다.
- lib/map-address.ts의 WGS84 좌표, 서울 지역 코드 검증, 지번 일치 후보 필터를 재사용합니다.
- app/components/DocentHome.tsx와 DocentStory.tsx에 사진·현재 위치의 명시적 주소 확인과 대체 입력을 연결했습니다.
- lib/place-media.ts가 기존 getFullDocentStory의 사진과 video-catalog의 지역 후보를 최대 6개씩 준비합니다. 사진 미리보기는 기존 이용조건 검사 함수를 사용합니다.
- app/api/docent/packet/route.ts는 기존 서명 주소 token을 검증하고 preparePlaceAnswer와 동일한 근거 형식에 media를 추가합니다.
- app/components/PhotoDocentPacket.tsx는 준비 진행·오류·재시도·질문 및 근거 복사를 제공합니다.
- lib/bounded-json.ts는 좌표와 자료 패킷 POST의 스트림 크기를 제한합니다.
- 기존 MCP 도구 목록과 입력은 유지하며 get_place_history와 prepare_place_answer의 응답에 media를 추가했습니다. 호환 도구 generate_place_answer에도 동일하게 적용합니다.

사진 항목에는 시기·원문·허용된 미리보기·제공기관·이용조건·관련 범위·조사 상태를 포함합니다. 영상에는 제목·기관·채널·역사적 시기·자료 날짜 유형·길이·원문·지역 관계·출처 참조를 포함합니다. 영상 상세 자료를 읽지 못하면 provenanceStatus=unavailable로 표시합니다. 시간은 verifiedTime과 validTime이 모두 참이며 수치 범위가 유효한 구간만 반환합니다. 빈 segments는 '재생구간 미검증 또는 미확보'입니다.

validate_place_answer는 기존 문헌·사진 장면의 ID·숫자·문장 길이 등을 검사합니다. 별도 영상 근거의 사실 검증과 건물 동일성 검증까지 확장한 것으로 해석하면 안 됩니다.

## 개인정보와 AI 비용

EXIF는 브라우저에서 읽습니다. 사진 좌표는 주소 변환 요청 본문으로 보내며 주소 변환 URL에 넣지 않습니다. 사진 원본 저장·업로드 API를 추가하지 않았습니다. 좌표와 복사한 주소는 민감한 위치정보일 수 있어 외부 AI로 복사하기 전에 확인하도록 안내합니다.

신규 자료 준비와 MCP 호출은 모델 API를 사용하지 않습니다. 기존 운영자 AI 생성 버튼과 주소 검색의 기존 자동 생성 경로는 유지합니다. 사진·현재 위치에서 새로 시작한 조회는 운영자 AI 자동 생성을 실행하지 않으며, 기존 버튼을 수동으로 사용할 수 있습니다. 클라이언트 조회 취소·이전 요청 무시로 중복 처리와 다른 주소 결과의 뒤섞임을 방지합니다.

기존 공개 MCP·관리자 권한과 D1/R2 설정을 유지합니다. 신규 자료 패킷은 D1 연결 없이 정적 공개자료를 읽습니다. D1 조회를 요청하는 기존 도구는 기존 미연결 오류를 유지합니다. 신규 API와 MCP는 인스턴스 내 요청 제한을 공유하며 배포 환경의 전역 호출량 제한은 별도 운영 설정이 필요합니다.

## AI에 사진을 직접 첨부할 때

ChatGPT의 이미지 입력 FAQ는 이미지 모델이 원래 파일명과 메타데이터를 처리하지 않는다고 설명합니다. Claude 공식 Vision 문서도 이미지 메타데이터를 받거나 파싱하지 않는다고 설명합니다. 이미지가 보이는 것만으로 GPS가 MCP에 전달된다고 가정하지 않습니다. [ChatGPT 이미지 입력 안내](https://help.openai.com/en/articles/8400551-chatgpt-image-inputs-faq), [Claude Vision](https://platform.claude.com/docs/en/build-with-claude/vision)

Gemini의 이미지·Files API와 함수 호출/MCP 연동은 파일 입력과 도구 호출 기능을 제공합니다. 확인한 문서에서는 일반 채팅에 첨부한 사진의 EXIF를 이 서버의 도구 인자로 자동 전달한다는 보장을 확인하지 못했습니다. 이 프로젝트는 브라우저 EXIF 추출 경로를 지원하며, resolve_photo_location에는 실제 확보한 좌표만 전달합니다. [Gemini 이미지 입력](https://ai.google.dev/gemini-api/docs/image-understanding), [Gemini 함수 호출](https://ai.google.dev/gemini-api/docs/function-calling)

원본 파일에 접근할 수 있는 별도 실행 환경이라면 먼저 실제 EXIF를 파싱한 뒤 좌표를 도구에 전달할 수 있습니다. 이 프로젝트는 ChatGPT·Claude·Gemini 계정에 직접 사진을 첨부해 GPS를 확보하는 실계정 흐름을 검증하지 않았습니다.

## 환경변수와 배포 확인

기존 .env.vercel.example의 서버 변수를 재사용합니다.

- JUSO_API_KEY는 공식 주소 검색과 후보 token 검증에 필요합니다.
- KAKAO_REST_API_KEY는 사진·현재 위치의 좌표→주소 변환에 필요합니다. 현재 사용자 환경은 미발급 상태입니다.
- KAKAO_JAVASCRIPT_KEY는 지도·로드뷰 표시용이며 카카오에 로컬·운영 도메인을 등록합니다.
- OPENAI_API_KEY와 OPENAI_MODEL은 기존 운영자 AI 기능용입니다. 새 자료 준비 API에는 필요하지 않습니다.
- D1/R2와 관리자 키는 기존 설정을 유지합니다. 새 DB나 새로운 유료 서비스를 추가하지 않습니다.

Vercel 프로젝트 Settings → Environment Variables에서 필요한 Preview/Production 범위에 입력하고 해당 배포를 다시 빌드합니다. 서버 키에 NEXT_PUBLIC_ 접두사를 붙이지 않습니다. Cloudflare/Sites는 기존 바인딩·비밀값을 사용합니다. .env.local과 .dev.vars는 Git에 올리지 않습니다.

로컬 실행과 확인 명령은 다음과 같습니다.

~~~powershell
corepack pnpm dev:vercel -- --hostname 127.0.0.1 --port 3230
corepack pnpm test
corepack pnpm typecheck
corepack pnpm build:vercel
~~~

Vercel 프로젝트 브라우저 확인은 컴퓨터 사용 도구가 현재 URL을 식별하지 못해 중단됐습니다. 코드 수정이나 로컬 빌드 통과는 운영 배포 완료를 뜻하지 않습니다.

## 검증 파일과 실기기 확인

- tests/photo-gps.test.mjs와 tests/fixtures/photo-gps.mjs는 합성 JPEG EXIF, 바이트 순서, 손상·잘림·범위·형식·크기 검사를 수행합니다. 스마트폰 원본 촬영 검증이 아닙니다.
- tests/photo-docent.test.mjs는 요청 크기·token 오류, 실제 카탈로그 패킷, 외부 호출 0회를 검사합니다.
- work/photo-flow-smoke.cjs는 390px Edge에서 합성 JPEG와 모의 좌표 변환 응답을 사용해 복수 후보 선택·실제 로컬 근거 패킷·업로드 없음·운영자 AI 자동 호출 없음·대체 입력을 확인하는 개발용 스크립트입니다.
- 기존 main과 비교해 기존 자료실·사진 테스트 실패를 구분합니다.

배포 후에는 GPS가 저장된 실제 iPhone·Android JPEG 원본, HEIC 거절 안내, 위치 없는 사진, 카카오 실응답·오차·후보 주소, 현재 위치 권한 허용·거절, 지도·로드뷰, 사진 이용조건, 영상 원문 및 구간, AI 계정의 MCP 호출·최종 해설, D1 실제 연결과 미연결을 확인해야 합니다.


LF 원문을 보존한 main 비교 환경의 검증 결과는 전체 295개 중 284개 통과, 기존 main과 동일한 실패 11개입니다. 추가한 6개 테스트는 통과했습니다. TypeScript 검사와 Vercel용 빌드를 통과했고, 실제 공식 주소 검색으로 마장로 262의 후보 1건을 받아 로컬 MCP에서 역사 14개·사진 6개·영상 6개를 확인했습니다. 운영자 AI 호출은 0회였으며 D1 미연결은 오류 안내로 처리했습니다.
Windows의 CRLF 작업폴더에서는 282개 통과·13개 실패이며, 추가 2개는 기존 원문 파일의 바이트 지문 검사와 줄바꿈 변환의 차이입니다. 기존 실패를 이번 기능의 성공으로 처리하지 않았습니다.
