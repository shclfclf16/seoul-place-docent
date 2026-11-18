import type {GoogleAuth} from 'google-auth-library';
import type {Address} from '@/lib/providers';
import {coordinates} from '@/lib/providers';
import {env} from '@/lib/runtime-env';
import {BigQueryAuthError, readHistoricalRecords} from './records';
import {readBigQueryCatalogDiagnostics} from './catalog-diagnostics';
import {readClassroomRecords} from './classroom-records';
import {readVerifiedPlaceRecords, placeRecordsAsScenes} from './place-records';

const scopes = ['https://www.googleapis.com/auth/cloud-platform'];
let adc: GoogleAuth | undefined;
let serviceAccountToken: {token: string; expiresAt: number} | undefined;

async function accessToken(signal: AbortSignal): Promise<string> {
  if (process.env.BIGQUERY_AUTH_MODE !== 'vercel-oidc') {
    const {GoogleAuth} = await import('google-auth-library');
    adc ??= new GoogleAuth({scopes});
    return (await adc.getAccessToken()) ?? '';
  }
  if (serviceAccountToken && serviceAccountToken.expiresAt - Date.now() > 60_000) return serviceAccountToken.token;
  serviceAccountToken = await exchangeVercelCredentials(process.env, async options => {
    const {getVercelOidcToken} = await import('@vercel/oidc');
    return getVercelOidcToken(options);
  }, fetch, signal);
  return serviceAccountToken.token;
}

export async function exchangeVercelCredentials(
  settings: Record<string, string | undefined>,
  getOidcToken: (options?: {audience: string}) => Promise<string>,
  fetcher: typeof fetch,
  signal: AbortSignal,
) {
  const project = settings.BIGQUERY_WIF_PROJECT_NUMBER ?? '';
  const pool = settings.BIGQUERY_WIF_POOL_ID ?? '';
  const provider = settings.BIGQUERY_WIF_PROVIDER_ID ?? '';
  const account = settings.BIGQUERY_SERVICE_ACCOUNT_EMAIL ?? '';
  const mode = settings.BIGQUERY_VERCEL_OIDC_AUDIENCE_MODE || 'google-default';
  if (!/^\d+$/.test(project) || !/^[a-z0-9-]+$/.test(pool) || !/^[a-z0-9-]+$/.test(provider) ||
      !/^[a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com$/.test(account) ||
      !['google-default', 'vercel-default'].includes(mode)) throw new BigQueryAuthError('BIGQUERY_WIF_CONFIG_INVALID');
  const audience = `//iam.googleapis.com/projects/${project}/locations/global/workloadIdentityPools/${pool}/providers/${provider}`;

  let subjectToken: string;
  try {
    // The JWT audience is configured independently of the STS resource name.
    subjectToken = mode === 'vercel-default' ? await getOidcToken() : await getOidcToken({audience: `https:${audience}`});
    if (!subjectToken) throw new Error();
  } catch {
    throw new BigQueryAuthError('BIGQUERY_VERCEL_OIDC_FAILED');
  }

  let federatedToken: string;
  try {
    signal.throwIfAborted();
    const response = await fetcher('https://sts.googleapis.com/v1/token', {
      method: 'POST', cache: 'no-store', redirect: 'error', signal,
      body: new URLSearchParams({
        audience,
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
        subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
        subject_token: subjectToken,
        scope: scopes.join(' '),
      }),
    });
    if (!response.ok) throw new Error();
    const data = await response.json() as {access_token?: string};
    if (typeof data.access_token !== 'string' || !data.access_token) throw new Error();
    federatedToken = data.access_token;
  } catch {
    throw new BigQueryAuthError('BIGQUERY_STS_EXCHANGE_FAILED');
  }

  try {
    signal.throwIfAborted();
    const url = `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${account}:generateAccessToken`;
    const response = await fetcher(url, {
      method: 'POST', cache: 'no-store', redirect: 'error', signal,
      headers: {Authorization: `Bearer ${federatedToken}`, 'Content-Type': 'application/json'},
      body: JSON.stringify({scope: scopes}),
    });
    if (!response.ok) throw new Error();
    const data = await response.json() as {accessToken?: string; expireTime?: string};
    const expiresAt = Date.parse(data.expireTime ?? '');
    if (typeof data.accessToken !== 'string' || !data.accessToken || !(expiresAt > Date.now())) throw new Error();
    return {token: data.accessToken, expiresAt};
  } catch {
    throw new BigQueryAuthError('BIGQUERY_SERVICE_ACCOUNT_TOKEN_FAILED');
  }
}

/** Node server only. Future evidence consumers can use the same result contract. */
export function getBigQueryHistoricalRecords() {
  return readHistoricalRecords(process.env, {getToken: accessToken});
}

/** Admin-only route uses this read-only count diagnostic; it does not enable public place search. */
export function getBigQueryCatalogDiagnostics() {
  return readBigQueryCatalogDiagnostics(process.env, {getToken: accessToken});
}

/** Preview-only, authenticated classroom metadata query; never used by public search or MCP. */
export function getClassroomDemoRecords() {
  return readClassroomRecords(process.env, {getToken: accessToken});
}

/** Public evidence search: rows are filtered by review and reuse status before leaving BigQuery. */
export async function getBigQueryPlaceHistory(address:Address) {
  if(process.env.BIGQUERY_PLACE_SEARCH_ENABLED!=='true')return {status:'disabled' as const,records:[],scenes:[]};
  let point:{x:number;y:number}|undefined;
  try{const found=await coordinates(address,env);if(found.status==='verified'&&typeof found.x==='number'&&typeof found.y==='number')point={x:found.x,y:found.y};}catch{/* Exact address matching still works without a verified nearby coordinate. */}
  const result=await readVerifiedPlaceRecords(process.env,{address,point},{getToken:accessToken});
  return {status:result.status,records:result.status==='ok'?result.records:[],scenes:result.status==='ok'?placeRecordsAsScenes(result.records):[],...(result.status==='ok'?{location:result.location}:{})};
}
