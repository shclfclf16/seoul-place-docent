import test from 'node:test';
import assert from 'node:assert/strict';
import {readHistoricalRecords} from '../lib/bigquery/records.ts';
import {GET} from '../app/api/admin/bigquery-records/route.ts';

const settings = {
  BIGQUERY_ENABLED: 'true', BIGQUERY_PROJECT_ID: 'seoul-place-docent-514906',
  BIGQUERY_DATASET_ID: 'seoul_history', BIGQUERY_TABLE_ID: 'historical_records_test',
  BIGQUERY_MAX_ROWS: '7', BIGQUERY_MAX_BYTES_BILLED: '100',
};
const mockRows = Array.from({length: 7}, (_, i) => ({f: [i + 1, `서울 자료 ${i + 1}`, 'photo', null].map(v => ({v}))}));

test('reads seven mock records using dataset location, a dry run and a bounded fixed SELECT', async () => {
  const requests = [];
  const result = await readHistoricalRecords(settings, {getToken: async () => 'mock-token', fetch: async (url, options) => {
    requests.push({url, body: options.body ? JSON.parse(options.body) : undefined});
    assert.equal(options.headers.Authorization, 'Bearer mock-token');
    if (requests.length === 1) return Response.json({location: 'asia-northeast3'});
    if (requests.length === 2) return Response.json({totalBytesProcessed: '99'});
    return Response.json({jobComplete: true, rows: mockRows});
  }});
  assert.match(requests[0].url, /\/datasets\/seoul_history\?fields=location$/);
  assert.equal(requests[1].body.dryRun, true);
  const query = requests[2].body;
  assert.equal(query.location, 'asia-northeast3');
  assert.equal(query.maximumBytesBilled, '100');
  assert.equal(query.maxResults, 7);
  assert.equal(query.queryParameters[0].parameterValue.value, '7');
  assert.equal(query.query, 'SELECT record_id, record_title, record_type, source_url FROM `seoul-place-docent-514906.seoul_history.historical_records_test` ORDER BY record_id LIMIT @maxRows');
  assert.equal(result.records.length, 7);
  assert.deepEqual(result.records[0], {record_id: '1', record_title: '서울 자료 1', record_type: 'photo', source_url: null});
});

test('does not authenticate disabled or invalid configurations', async () => {
  const deps = {getToken: async () => assert.fail('unexpected token request')};
  assert.deepEqual(await readHistoricalRecords({}, deps), {status: 'disabled'});
  assert.equal((await readHistoricalRecords({...settings, BIGQUERY_TABLE_ID: 'x` OR TRUE'}, deps)).code, 'BIGQUERY_CONFIG_INVALID');
});

test('stops before a billed query when the estimate exceeds the cap or location mismatches', async () => {
  for (const [extra, expected, count] of [[{}, 'BIGQUERY_BUDGET_EXCEEDED', 2], [{BIGQUERY_LOCATION: 'US'}, 'BIGQUERY_LOCATION_MISMATCH', 1]]) {
    let calls = 0;
    const result = await readHistoricalRecords({...settings, ...extra}, {getToken: async () => 'mock', fetch: async () => {
      calls += 1;
      return Response.json(calls === 1 ? {location: 'asia-northeast3'} : {totalBytesProcessed: '101'});
    }});
    assert.equal(result.code, expected);
    assert.equal(calls, count);
  }
});

test('credential and upstream errors return safe status codes', async () => {
  assert.equal((await readHistoricalRecords(settings, {getToken: async () => {throw Error('private');}})).code, 'BIGQUERY_AUTH_FAILED');
  assert.equal((await readHistoricalRecords(settings, {getToken: async () => 'mock', fetch: async () => new Response('private', {status: 403})})).code, 'BIGQUERY_ACCESS_DENIED');
});

test('admin endpoint rejects unauthenticated requests', async () => {
  const response = await GET(new Request('https://example.test/api/admin/bigquery-records'));
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});
