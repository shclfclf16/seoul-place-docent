# 사진에서 시작하는 서울 도슨트: 실행 계획과 검증

기준: 2026-11-08, Asia/Seoul. KPI는 목표이며 실측과 분리한다.

## 최종 성공 조건

스마트폰 기본 카메라에서 위치정보를 켜고 촬영 → GPS가 보존된 원본 JPEG/HEIC를 AI에 파일 첨부 → MCP가 원본 EXIF의 좌표·촬영 시각을 읽음 → 한국어 도로명·지번 주소 후보 반환 → 사용자 확인 → 주소 token으로 역사 근거·사진·영상 조회 → 호출한 AI가 시각자료와 출처를 포함한 도슨트 작성.

사진의 촬영 위치와 피사체 건물의 위치는 다를 수 있다. 후보 주소 확인은 성공 흐름에 포함한다. GPS 제거·첨부 미전달은 자동 위치 인식 성공으로 계산하지 않는다. 현재 위치는 촬영 당시 위치와 별개다.

## 단계별 실행

| 단계 | 작업 | 완료 조건 | 이번 실행 |
| --- | --- | --- | --- |
| 1. 현황 확인 | 최신 GitHub·Sites·Vercel·연결 MCP 입력 비교 | 실제 운영과 소스 차이 확인 | GitHub main b353464, 공개 MCP f603c75, Sites v58 확인. 기존 MCP는 좌표 숫자만 수신 |
| 2. 원본 수신 | ChatGPT 파일 입력 메타데이터, JPEG/HEIC EXIF, 20MiB·15초 제한 | 파일 바이트→GPS, 누락·손상·서울 외 구분 | extract_photo_location 추가. fileParams, 임시 URL 다운로드, 비저장 처리, 카메라 시각·시간대 미확인 표시 |
| 3. 주소 연결 | 기존 카카오 역지오코딩·JUSO 서명 token 재사용 | 위경도 순서·서울 법정동·후보 확인 | 기존 resolve_photo_location 입력 유지, 원본 도구에서 같은 주소 변환 경로 사용 |
| 4. 해설·시각자료 | 역사 문단 근거, 대표 사진, 관련 영상, 출처·시기·범위 | 사진 직접 표시 지침, 영상 링크·검증 구간 구분 | visuals.photos 추가, 기존 videos와 출처 유지. 서버 모델 호출 0회 |
| 5. 검사·배포 | 단위/패키지 통합 검사, 타입 검사, GitHub PR, 운영 반영 | 실제 /mcp 도구 목록·GPS 주소 변환·근거·검증 확인 | 결과는 PR 및 배포 기록에 업데이트 |
| 6. 실기기 검증 | iPhone JPEG/HEIC, Android JPEG, GPS 제거본·손상·서울 외, ChatGPT 원본 첨부 | 아래 표본과 최종 응답 화면·도구 trace 확보 | 실기기 원본과 계정별 파일 전달 미검증. 합성 사진 검사를 실기기 성공으로 표시하지 않음 |
| 7. KPI 판정 | JSONL 평가표 채점·실패 구간 분류 | 목표와 실측, 분모, 미측정 항목 함께 보고 | scripts/evaluate-photo-kpi.mjs 제공. 실측이 없으면 null |

## 지원 경로

- 우선 경로: ChatGPT 원본 파일 첨부 → extract_photo_location → 주소 확인 → prepare_place_answer → 최종 해설 → validate_place_answer.
- 기존 좌표 경로: 실제 GPS를 받은 경우 resolve_photo_location. 이미지 외관에서 좌표를 만들지 않는다.
- 대체 경로: 홈페이지에서 원본 사진을 선택해 기기 안에서 GPS 추출 → 주소 확인 → AI 안내의 질문 복사. 이는 직접 첨부 성공률과 분리한다.
- Claude/Gemini: 좌표·주소 기반 MCP는 기존 계약 유지. OpenAI fileParams는 호스트 확장이라 다른 AI의 원본 파일 전달을 보장하지 않는다. 실제 계정 검증 전 지원 완료로 표시하지 않는다.

공식 파일 입력 계약: https://developers.openai.com/plugins/reference#file-apis (확인 2026-11-08). file에는 download_url·file_id가 필수이며 mime_type·file_name은 선택 속성이다. 호스트가 파일을 전달하지 못하면 needs_file로 안내한다. MIME·파일명 대신 실제 파일 바이트로 형식을 판정한다. 원본·첨부 URL·정확한 좌표·질문 원문은 기본 로그에 저장하지 않는다.

## 1차 합격 목표

| 지표 | 분모 | 목표 |
| --- | --- | --- |
| 원본 전달률 | GPS 보존 원본 직접 첨부 시도 | 95% 이상 |
| GPS 추출률 | GPS가 있고 지원 형식인 원본 직접 첨부 시도 | 95% 이상 (전달 실패 포함) |
| 주소 정확도 | GPS가 있고 지원 형식인 원본 직접 첨부 시도 | 95% 이상 (검증한 촬영 지점·주소 후보 기준) |
| End-to-end 성공률 | GPS가 있고 지원 형식인 원본 직접 첨부 시도 | 90% 이상 |
| 시각자료 표시율 | 관련 표시 가능 자료가 있는 정상 주소 사례 | 95% 이상 |
| 출처 표시율 | 최종 해설 작성 사례 | 100% |
| 잘못된 건물·부지 단정 | 전체 평가 | 0건 |
| 예외 처리 적정률 | GPS 없음·손상·서울 외·첨부 미전달 사례 | 95% 이상 |
| 처리시간 p95 | E2E 완료 사례. 후보 선택 대기 제외 | 30초 이하 (대기 포함 값도 별도 기록) |

먼저 iPhone/Android 각 10개, 예외 10개로 파일럿 30건을 수행한다. 이는 정식 100개 이상의 서로 다른 장소·기기 평가를 대신하지 않는다. 동일 원본 반복 업로드는 독립 표본으로 계산하지 않는다. 주소 정확도는 카메라 좌표와 대상 건물 동일성을 혼합하지 않는다. 사진/영상의 주소 관련성과 건물 동일성도 따로 채점한다.

## 평가 실행

평가 JSONL은 기기 실증 후 작성한다. 사진 파일, 실제 좌표, 개인 주소, 첨부 URL, token은 넣지 않는다. evidence는 비식별 실행 ID로 둔다. 아래는 형식 예시이며 측정 결과가 아니다.

```json
{"id":"iphone-jpeg-01","eligible":true,"delivered":true,"gpsCorrect":true,"addressCorrect":true,"answerComplete":true,"visualExpected":true,"visualShown":true,"sourcesComplete":true,"falseBuildingClaim":false,"fallbackExpected":false,"fallbackCorrect":null,"latencyMs":12500,"evidence":"review-run-01"}
```

```sh
node scripts/evaluate-photo-kpi.mjs /absolute/path/to/observations.jsonl
```

완료 여부는 두 사람이 자료 원문과 최종 해설을 대조해 판정한다. 서버가 근거를 반환했거나 validate_place_answer의 기계 검사를 통과했다는 이유만으로 answerComplete·sourcesComplete를 참으로 표시하지 않는다. 기기별·클라이언트별 파일 전달과 사진 표시를 실제 화면에서 따로 확인한다.

## 실기기 체크리스트

1. 기본 카메라 위치 권한·위치 태그 켜기, 실제 서울 지점에서 촬영. 갤러리 상세정보에서 위치 존재 확인.
2. 메신저 재전송본·스크린샷 대신 원본을 파일로 첨부. 공유 옵션의 위치정보 포함 상태 확인.
3. MCP 호출 상세에서 extract_photo_location의 file 전달 여부와 결과·요청 ID 확인.
4. 실제 촬영 지점과 도로명·지번 후보 비교·선택. 좌표가 피사체 건물과 다를 가능성 확인.
5. prepare_place_answer의 사진·영상과 AI 최종 출력 비교. 사진 표시, 영상 원문 링크, 시기와 이용조건·범위 확인.
6. GPS 제거본은 no_gps, 첨부 누락은 needs_file, 서울 외는 outside_seoul로 처리되는지 확인. 현재 위치를 사진 GPS로 표시하면 실패.
7. 최종 응답을 평가표에 기록하고 분모·실패 사유·미측정값을 함께 공개.
