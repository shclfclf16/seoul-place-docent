import test from 'node:test';
import assert from 'node:assert/strict';
import {exchangeVercelCredentials} from '../lib/bigquery/server.ts';
import {readHistoricalRecords} from '../lib/bigquery/records.ts';

const settings = {
  BIGQUERY_ENABLED: 'true', BIGQUERY_PROJECT_ID: 'test-project',
  BIGQUERY_DATASET_ID: 'catalog', BIGQUERY_TABLE_ID: 'records',
  BIGQUERY_WIF_PROJECT_NUMBER: '1234567890', BIGQUERY_WIF_POOL_ID: 'vercel',
  BIGQUERY_WIF_PROVIDER_ID: 'preview', BIGQUERY_SERVICE_ACCOUNT_EMAIL: 'reader@test-project.iam.gserviceaccount.com',
};
const resource = '//iam.googleapis.com/projects/1234567890/locations/global/workloadIdentityPools/vercel/providers/preview';

for (const mode of ['google-default', 'vercel-default']) {
  test(`uses the provider resource for STS and the configured JWT audience mode (${mode})`, async () => {
    const signal = new AbortController().signal;
    let requests = 0;
    const result = await exchangeVercelCredentials({...settings, BIGQUERY_VERCEL_OIDC_AUDIENCE_MODE: mode}, async options => {
      assert.deepEqual(options, mode === 'google-default' ? {audience: `https:${resource}`} : undefined);
      return 'mock-vercel-jwt';
    }, async (url, request) => {
      ++requests;
      assert.equal(request.signal, signal);
      if (requests === 1) {
        assert.equal(url, 'https://sts.googleapis.com/v1/token');
        assert.equal(request.body.get('audience'), resource);
        assert.equal(request.body.get('subject_token'), 'mock-vercel-jwt');
        assert.equal(request.headers, undefined);
        return Response.json({access_token: 'mock-federated-token'});
      }
      assert.equal(url, 'https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/reader@test-project.iam.gserviceaccount.com:generateAccessToken');
      assert.equal(request.headers.Authorization, 'Bearer mock-federated-token');
      assert.deepEqual(JSON.parse(request.body), {scope: ['https://www.googleapis.com/auth/cloud-platform']});
      return Response.json({accessToken: 'mock-service-account-token', expireTime: new Date(Date.now() + 3600000).toISOString()});
    }, signal);
    assert.equal(requests, 2);
    assert.equal(result.token, 'mock-service-account-token');
  });
}

for (const [stage, code] of Object.entries({
  config: 'BIGQUERY_WIF_CONFIG_INVALID',
  oidc: 'BIGQUERY_VERCEL_OIDC_FAILED',
  sts: 'BIGQUERY_STS_EXCHANGE_FAILED',
  iam: 'BIGQUERY_SERVICE_ACCOUNT_TOKEN_FAILED',
})) {
  test(`returns only the safe ${stage} failure code and avoids a BigQuery call`, async () => {
    let calls = 0;
    const input = {...settings, ...(stage === 'config' ? {BIGQUERY_WIF_PROJECT_NUMBER: 'not-a-number'} : {})};
    const result = await readHistoricalRecords(input, {
      getToken: signal => exchangeVercelCredentials(input, async () => {
        if (stage === 'oidc') throw new Error('sensitive upstream error');
        return 'mock-jwt';
      }, async () => {
        ++calls;
        if (stage === 'sts' || calls === 2) return new Response('sensitive upstream error', {status: 403});
        return Response.json({access_token: 'mock-federated-token'});
      }, signal).then(result => result.token),
      fetch: async () => assert.fail('must not query BigQuery'),
    });
    assert.deepEqual(result, {status: 'unavailable', code});
    assert.equal(calls, {config: 0, oidc: 0, sts: 1, iam: 2}[stage]);
  });
}
