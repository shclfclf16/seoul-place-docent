# 서울 역사 도슨트 수업용 시연 (Preview 전용)

`/classroom-demo`는 검토 대기 자료를 수업 관계자에게 보여주기 위한 별도 화면입니다. 기본 홈페이지와 공개 MCP는 기존 승인 자료 필터를 유지합니다. 자료 조회 API는 Preview 보호만 믿지 않고 앱 서버에서 별도 수업용 인증을 확인합니다.

## Vercel Preview 설정

Vercel 프로젝트의 **Preview 환경에만** 다음 환경변수를 설정하고 Preview를 재배포합니다. Production 환경에는 복사하지 않습니다.

| 변수 | 값 |
| --- | --- |
| `CLASSROOM_DEMO_ENABLED` | `true` |
| `CLASSROOM_DEMO_TOKEN` | 32자 이상 임의의 비밀 문자열 |
| `CLASSROOM_DEMO_IMAGE_EMBED_ENABLED` | `false` 또는 미설정 |
| `CLASSROOM_DEMO_IMAGE_RIGHTS_APPROVED` | `false` 또는 미설정 |
| `BIGQUERY_PLACE_SEARCH_ENABLED` | `false` 유지 |

Preview에는 기존 BigQuery 프로젝트·데이터셋·리전·읽기 권한과 OIDC 인증 설정이 필요합니다. `VERCEL_ENV=preview`인지 서버가 확인하므로 Production에서는 수업용 API가 비활성화됩니다. `BIGQUERY_ENABLED`는 기존 BigQuery 관리자 조회가 사용하는 값입니다.

수업용 토큰은 운영자 `ARCHIVE_ADMIN_TOKEN`과 별도로 만듭니다. 이 토큰은 강의 관계자에게만 전달하고, 저장소나 제출 자료에 넣지 않습니다. 로그인 후 서버는 원래 토큰이 아닌 만료 4시간짜리 `HttpOnly`, `Secure`, `SameSite=Strict` 쿠키를 발급합니다. API는 토큰과 쿠키를 로그에 기록하지 않습니다.

## 이미지 표시

첫 사진 후보 `DANGIN-C03`은 서울역사박물관의 「주명덕의 1964년 당인리 사진」 메타데이터를 사용합니다. 박물관 JPG는 사진 두 장이 같이 들어 있는 이미지이며 오른쪽이 당인리발전소 관련 사진이라는 조사 내용을 캡션에 표시합니다. 독립 원본 이미지나 확정된 촬영 지점으로 표시하지 않습니다.

저작권과 이용 범위가 확인되기 전에는 원문 게시물과 JPG 링크만 표시하고, 화면 내 이미지 임베드 및 R2 복제는 하지 않습니다. 권리 검토가 끝나고 수업용 표시를 별도로 승인한 경우에만 **Preview 환경에서만** 다음 두 설정을 모두 `true`로 바꿉니다.

```text
CLASSROOM_DEMO_IMAGE_EMBED_ENABLED=true
CLASSROOM_DEMO_IMAGE_RIGHTS_APPROVED=true
```

코드는 지정된 박물관 JPG만 표시합니다. BigQuery 데이터가 전달한 URL을 이미지 주소로 사용하지 않습니다.

## 확인 절차

1. Preview URL의 `/classroom-demo`를 열고 수업 토큰으로 로그인합니다.
2. 자료 목록에 `DANGIN-C03`, 자료 검토 상태 `NEEDS_REVIEW`, 위치 범위 `동네 배경자료`, 연결 상태 `NEEDS_REVIEW`가 나타나는지 확인합니다.
3. 이미지 임베드가 꺼져 있으면 미리보기 없이 박물관 원문 링크가 보이는지 확인합니다.
4. 로그아웃한 다음 `/api/classroom-demo/records`에 직접 접근해 HTTP 403을 확인합니다.
5. 일반 홈페이지에서 마장로42길 16을 검색해 당인리 검토 자료가 나오지 않는지 확인합니다.
6. 일반 MCP의 `get_place_history` 및 설명 준비 도구에서도 검토 대기 자료가 나오지 않는지 확인합니다.

BigQuery 장애 시 수업용 자료 API는 안전한 오류 코드를 반환합니다. 홈페이지의 기존 주소 검색과 지역 이야기는 이 시연 API와 별도 경로를 사용하므로 계속 사용할 수 있어야 합니다.
