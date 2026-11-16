# 서울 도슨트 BigQuery 읽기 전용 연결

Next.js의 Node.js 서버에 관리자용 `GET /api/admin/bigquery-records`를 추가했습니다. 이 경로는 `historical_records_test`의 `record_id`, `record_title`, `record_type`, `source_url`만 반환합니다. 기존 아카이브 관리자 키(`ARCHIVE_ADMIN_TOKEN`)를 `x-archive-admin` 헤더로 전달합니다.

BigQuery는 별도 조회 경로입니다. Vercel의 기존 D1·R2 HTTP 어댑터, Cloudflare/Sites의 네이티브 D1·R2 바인딩, 홈페이지와 MCP 자료 생성 코드는 그대로 사용합니다. Cloudflare 빌드는 기존 Sites 런타임 변환 플러그인을 통해 BigQuery 비활성 모듈을 선택합니다. 별도로 패키징되는 공개 MCP에는 관리자 경로가 포함되지 않습니다. 향후 근거 검색에서는 서버 함수의 `ok` 결과만 받아 출처·검토 상태를 추가 검증한 뒤 사용할 수 있습니다. 이번 네 열에는 검토 상태가 들어 있지 않습니다.

## 1. Google Cloud Console

1. [Google Cloud Console](https://console.cloud.google.com/) 상단의 프로젝트 선택에서 `seoul-place-docent-514906`을 고릅니다. **API 및 서비스 → 라이브러리**에서 **BigQuery API**가 활성화되어 있는지 확인합니다.
2. **BigQuery → 탐색기**에서 `seoul_history` 데이터셋을 열고 세부정보의 **데이터 위치**를 확인합니다. 이어서 `historical_records_test`의 스키마에 네 열이 있는지, 미리보기에서 7건이 보이는지 확인합니다. 서버도 매번 데이터셋의 실제 위치를 조회합니다. `BIGQUERY_LOCATION`을 따로 지정하면 실제 위치와 일치할 때만 진행합니다. [데이터셋 조회 API](https://docs.cloud.google.com/bigquery/docs/reference/rest/v2/datasets/get)
3. 사용할 Google 로그인 계정에 프로젝트 수준 **BigQuery Job User**(`roles/bigquery.jobUser`)와 `seoul_history` 데이터셋 수준 **BigQuery Data Viewer**(`roles/bigquery.dataViewer`)를 부여합니다. 프로젝트 IAM 화면과 데이터셋의 **공유 → 권한 관리**에서 각각 설정합니다. Vercel에는 아래에서 만드는 전용 서비스 계정에 같은 권한을 부여합니다. [BigQuery 쿼리 권한](https://docs.cloud.google.com/bigquery/docs/reference/rest/v2/jobs/query)

## 2. 로컬에서 Google 계정으로 확인

Google Cloud CLI를 설치한 뒤 PowerShell에서 아래 명령으로 ADC(Application Default Credentials)를 설정합니다. 브라우저가 열리면 위 권한을 가진 Google 계정을 선택합니다. [Google 로컬 ADC 안내](https://docs.cloud.google.com/docs/authentication/set-up-adc-local-dev-environment)

```powershell
gcloud auth application-default login
gcloud auth application-default set-quota-project seoul-place-docent-514906
```

할당량 프로젝트 설정에서 권한 오류가 나면 해당 사용자에게 `serviceusage.services.use` 권한이 있는지 프로젝트 관리자에게 확인합니다. 저장소 루트의 `.env.local`에 다음을 입력합니다. 기존 관리자 키가 있다면 그대로 사용하고, 없다면 새로 정한 긴 비밀 문자열을 `ARCHIVE_ADMIN_TOKEN`에 넣습니다.

```dotenv
BIGQUERY_ENABLED=true
BIGQUERY_AUTH_MODE=adc
BIGQUERY_PROJECT_ID=seoul-place-docent-514906
BIGQUERY_DATASET_ID=seoul_history
BIGQUERY_TABLE_ID=historical_records_test
BIGQUERY_MAX_ROWS=25
BIGQUERY_MAX_BYTES_BILLED=104857600
```

`pnpm install --frozen-lockfile` 후 `pnpm run dev:vercel`을 실행합니다. 다른 PowerShell 창에서 아래 명령을 실행하고 관리자 키를 입력합니다. 포트가 다르면 개발 서버가 표시한 주소로 바꿉니다.

```powershell
$adminKey = Read-Host '관리자 키' -MaskInput
try {
  $result = Invoke-RestMethod 'http://127.0.0.1:3000/api/admin/bigquery-records' -Headers @{'x-archive-admin' = $adminKey}
  $result.location
  $result.records | Format-Table
  $result.records.Count
} finally { Remove-Variable adminKey }
```

`403`은 사이트 관리자 키를 먼저 확인합니다. `503` 응답의 `BIGQUERY_AUTH_FAILED`는 로컬 ADC 로그인, `BIGQUERY_ACCESS_DENIED`는 BigQuery IAM 역할, `BIGQUERY_LOCATION_MISMATCH`는 리전, `BIGQUERY_BUDGET_EXCEEDED`는 예상 처리 바이트를 확인합니다. 서버는 기본 25행, 설정 가능한 최대 100행까지 반환합니다. 예상 처리량을 dry-run으로 검사하고 실행 요청에도 `maximumBytesBilled`를 보냅니다. `LIMIT`은 결과 행 수를 제한하며 비용 상한은 별도로 적용됩니다. [쿼리 비용 상한](https://docs.cloud.google.com/bigquery/docs/troubleshoot-queries)

## 3. Vercel에서 개인키 없이 연결

1. Vercel에서 **홈페이지를 배포하는 Next.js 프로젝트**를 선택합니다. 프로젝트 **Settings → Security → Secure backend access with OIDC federation**에서 Team 발급자 설정을 확인합니다. Vercel 팀 슬러그와 프로젝트 이름을 메모합니다.
2. Google Cloud의 **IAM 및 관리자 → 서비스 계정**에서 조회 전용 계정을 만들고 1단계의 두 BigQuery 역할을 부여합니다. **API 및 서비스**에서 IAM Service Account Credentials API도 활성화합니다.
3. **IAM 및 관리자 → Workload Identity Federation**에서 풀과 OIDC 공급자를 만듭니다. 발급자는 `https://oidc.vercel.com/<팀 슬러그>`, Audience는 **Default audience**, 속성 매핑은 `google.subject = assertion.sub`로 설정합니다. 공급자 속성 조건은 `assertion.sub == 'owner:<팀 슬러그>:project:<프로젝트 이름>:environment:preview'`처럼 시험할 배포 환경에 한정합니다.
4. 서비스 계정의 **권한 → 액세스 권한 부여**에서 `principal://iam.googleapis.com/projects/<프로젝트 번호>/locations/global/workloadIdentityPools/<풀 ID>/subject/owner:<팀 슬러그>:project:<프로젝트 이름>:environment:preview`에 **Workload Identity User**(`roles/iam.workloadIdentityUser`)를 부여합니다. 실제 값으로 채우고 Preview에서 먼저 확인합니다. [Vercel의 Google Cloud OIDC 설정](https://vercel.com/docs/oidc/gcp)
5. Vercel 프로젝트 **Settings → Environment Variables**의 Preview에 로컬과 같은 `BIGQUERY_*` 조회값을 넣되 `BIGQUERY_AUTH_MODE=vercel-oidc`로 바꿉니다. `BIGQUERY_WIF_PROJECT_NUMBER`(숫자), `BIGQUERY_WIF_POOL_ID`, `BIGQUERY_WIF_PROVIDER_ID`, `BIGQUERY_SERVICE_ACCOUNT_EMAIL`, `ARCHIVE_ADMIN_TOKEN`도 설정합니다.
6. 이 브랜치를 Preview로 배포한 다음 위 PowerShell 예제의 주소를 해당 Preview의 HTTPS 주소로 바꿔 확인합니다. `status: ok`, 실제 `location`, `records.Count`를 확인합니다. 운영 활성화가 필요하면 운영 환경에 해당하는 주체와 환경변수를 별도로 설정합니다.

Google 공급자에 **Default audience**를 선택했다면 `BIGQUERY_VERCEL_OIDC_AUDIENCE_MODE`를 생략하거나 `google-default`로 설정합니다. Vercel에 요청하는 JWT의 `aud`는 `https://iam.googleapis.com/projects/.../providers/...`입니다. 기존 공급자가 **Allowed audiences**에 `https://vercel.com/<팀 슬러그>`를 명시했다면 `vercel-default`로 설정해 Vercel 기본 토큰을 사용합니다. 두 방식 모두 Google STS 요청의 `audience`는 `//iam.googleapis.com/projects/.../providers/...`입니다. Google의 공급자 조건과 서비스 계정의 권한 주체에서 Preview의 팀 슬러그, 실제 Vercel 프로젝트 이름, `environment:preview`가 모두 일치해야 합니다. [Google STS 요청 형식](https://docs.cloud.google.com/iam/docs/reference/sts/rest/v1/TopLevel/token) · [Vercel의 audience 설정](https://vercel.com/docs/oidc/gcp)

### Preview에서 503이 나올 때

| 코드 | 확인할 설정 |
|---|---|
| `BIGQUERY_WIF_CONFIG_INVALID` | Preview 환경변수의 프로젝트 번호, 풀·공급자 ID, 서비스 계정 이메일, audience 모드 |
| `BIGQUERY_VERCEL_OIDC_FAILED` | 해당 Preview 배포의 OIDC 발급 설정. Default audience 방식에서는 Team 발급자와 커스텀 audience 발급도 확인 |
| `BIGQUERY_STS_EXCHANGE_FAILED` | Google 공급자의 발급자·audience·속성 매핑과 `assertion.sub` 조건 |
| `BIGQUERY_SERVICE_ACCOUNT_TOKEN_FAILED` | 서비스 계정 이메일과 해당 Preview 주체의 `roles/iam.workloadIdentityUser` 권한 |
| `BIGQUERY_ACCESS_DENIED` | 서비스 계정의 BigQuery Job User 및 대상 데이터셋 Data Viewer 역할 |

관리자 응답에는 단계별 코드만 포함됩니다. 토큰이나 인증 제공자의 원본 오류를 공유할 필요가 없습니다. [서비스 계정 토큰 발급 권한](https://docs.cloud.google.com/iam/docs/reference/credentials/rest/v1/projects.serviceAccounts/generateAccessToken)

## 검증 범위

`pnpm test`의 BigQuery 모의 테스트는 7행 반환, 조회 열·행 상한, 리전 감지, 비용 상한 거절, 인증 실패, 관리자 접근 제한을 확인합니다. 실제 데이터셋 위치, ADC/OIDC 인증, Google 쿼리와 7건 조회는 실제 Google 권한 설정 후 확인해야 합니다. 관리자 경로는 기본적으로 `BIGQUERY_ENABLED`가 `true`일 때만 Google 서버에 접속합니다.
