import type {GoogleAuth, ExternalAccountClient} from 'google-auth-library';
import {readHistoricalRecords} from './records';

const scopes = ['https://www.googleapis.com/auth/cloud-platform'];
let adc: GoogleAuth | undefined;
let federated: ReturnType<typeof ExternalAccountClient.fromJSON>;

async function accessToken(): Promise<string> {
  if (process.env.BIGQUERY_AUTH_MODE !== 'vercel-oidc') {
    const {GoogleAuth} = await import('google-auth-library');
    adc ??= new GoogleAuth({scopes});
    return (await adc.getAccessToken()) ?? '';
  }
  const project = process.env.BIGQUERY_WIF_PROJECT_NUMBER ?? '';
  const pool = process.env.BIGQUERY_WIF_POOL_ID ?? '';
  const provider = process.env.BIGQUERY_WIF_PROVIDER_ID ?? '';
  const account = process.env.BIGQUERY_SERVICE_ACCOUNT_EMAIL ?? '';
  if (!/^\d+$/.test(project) || !/^[a-z0-9-]+$/.test(pool) || !/^[a-z0-9-]+$/.test(provider) ||
      !/^[a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com$/.test(account)) throw new Error('Invalid federation configuration');
  const audience = `https://iam.googleapis.com/projects/${project}/locations/global/workloadIdentityPools/${pool}/providers/${provider}`;
  const {ExternalAccountClient} = await import('google-auth-library');
  const {getVercelOidcToken} = await import('@vercel/oidc');
  federated ??= ExternalAccountClient.fromJSON({
    type: 'external_account', audience, scopes,
    subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
    token_url: 'https://sts.googleapis.com/v1/token',
    service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${account}:generateAccessToken`,
    subject_token_supplier: {getSubjectToken: () => getVercelOidcToken({audience})},
  });
  return (await federated?.getAccessToken())?.token ?? '';
}

/** Node server only. Future evidence consumers can use the same result contract. */
export function getBigQueryHistoricalRecords() {
  return readHistoricalRecords(process.env, {getToken: accessToken});
}
