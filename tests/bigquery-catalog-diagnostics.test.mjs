import test from 'node:test';
import assert from 'node:assert/strict';
import {readBigQueryCatalogDiagnostics} from '../lib/bigquery/catalog-diagnostics.ts';
import {GET} from '../app/api/admin/bigquery-catalog/route.ts';

const settings = {
  BIGQUERY_ENABLED: 'true', BIGQUERY_PLACE_SEARCH_ENABLED: 'false',
  BIGQUERY_PROJECT_ID: 'seoul-place-docent-514906', BIGQUERY_DATASET_ID: 'seoul_history',
  BIGQUERY_LOCATION: 'asia-northeast3', BIGQUERY_MAX_BYTES_BILLED: '1000',
};

test('admin catalog diagnostic reads only counts and compares 7, 3, 7', async () => {
  const requests = [];
  const result = await readBigQueryCatalogDiagnostics(settings, {
    getToken: async () => 'test-token',
    fetch: async (url, options) => {
      requests.push({url, body: options.body ? JSON.parse(options.body) : undefined});
      if (requests.length === 1) return Response.json({location: 'asia-northeast3'});
      if (requests.length === 2) return Response.json({totalBytesProcessed: '99'});
      return Response.json({jobComplete: true, rows: [{f: [{v: '7'}, {v: '3'}, {v: '7'}]}]});
    },
  });
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.tables.map(({table, rowCount, expectedCount, matchesExpected}) =>
    ({table, rowCount, expectedCount, matchesExpected})), [
    {table: 'historical_records', rowCount: 7, expectedCount: 7, matchesExpected: true},
    {table: 'places', rowCount: 3, expectedCount: 3, matchesExpected: true},
    {table: 'record_place_links', rowCount: 7, expectedCount: 7, matchesExpected: true},
  ]);
  assert.equal(result.allMatchExpected, true);
  assert.equal(requests[1].body.dryRun, true);
  assert.match(requests[2].body.query, /historical_records/);
  assert.match(requests[2].body.query, /places/);
  assert.match(requests[2].body.query, /record_place_links/);
  assert.doesNotMatch(requests[2].body.query, /historical_records_test|INSERT|UPDATE|DELETE|MERGE/i);
  assert.equal(requests[2].body.maximumBytesBilled, '1000');
});

test('diagnostic reports count mismatch without treating candidate rows as approved', async () => {
  let calls = 0;
  const result = await readBigQueryCatalogDiagnostics(settings, {
    getToken: async () => 'test-token',
    fetch: async () => {
      calls++;
      if (calls === 1) return Response.json({location: 'asia-northeast3'});
      if (calls === 2) return Response.json({totalBytesProcessed: '99'});
      return Response.json({jobComplete: true, rows: [{f: [{v: '0'}, {v: '0'}, {v: '0'}]}]});
    },
  });
  assert.equal(result.status, 'ok');
  assert.equal(result.allMatchExpected, false);
  assert.deepEqual(result.tables.map(table => table.matchesExpected), [false, false, false]);
});

test('diagnostic is disabled unless BigQuery credentials are enabled and never uses public flag', async () => {
  const deps = {getToken: async () => assert.fail('must not authenticate')};
  assert.deepEqual(await readBigQueryCatalogDiagnostics({...settings, BIGQUERY_ENABLED: 'false'}, deps), {status: 'disabled'});
  assert.equal((await readBigQueryCatalogDiagnostics(settings, deps)).status, 'unavailable');
});

test('diagnostic fails closed on authentication, budget, and upstream errors', async () => {
  const authFailure = await readBigQueryCatalogDiagnostics(settings, {
    getToken: async () => {throw new Error('secret token detail');},
  });
  assert.deepEqual(authFailure, {status: 'unavailable', code: 'BIGQUERY_AUTH_FAILED'});

  let calls = 0;
  const budgetFailure = await readBigQueryCatalogDiagnostics(settings, {
    getToken: async () => 'test-token',
    fetch: async () => {
      calls++;
      return Response.json(calls === 1 ? {location: 'asia-northeast3'} : {totalBytesProcessed: '1001'});
    },
  });
  assert.deepEqual(budgetFailure, {status: 'unavailable', code: 'BIGQUERY_BUDGET_EXCEEDED'});
  assert.equal(calls, 2);
});

test('admin route rejects unauthenticated requests before querying BigQuery', async () => {
  const saved = process.env.ARCHIVE_ADMIN_TOKEN;
  const enabled = process.env.BIGQUERY_ENABLED;
  delete process.env.ARCHIVE_ADMIN_TOKEN;
  process.env.BIGQUERY_ENABLED = 'true';
  try {
    const response = await GET(new Request('https://example.test/api/admin/bigquery-catalog'));
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(await response.json(), {error: '관리자 인증이 필요합니다.'});
  } finally {
    if (saved === undefined) delete process.env.ARCHIVE_ADMIN_TOKEN;
    else process.env.ARCHIVE_ADMIN_TOKEN = saved;
    if (enabled === undefined) delete process.env.BIGQUERY_ENABLED;
    else process.env.BIGQUERY_ENABLED = enabled;
  }
});

test('admin route accepts existing archive admin token but does not expose content', async () => {
  const saved = process.env.ARCHIVE_ADMIN_TOKEN;
  const enabled = process.env.BIGQUERY_ENABLED;
  process.env.ARCHIVE_ADMIN_TOKEN = 'test-admin-token';
  process.env.BIGQUERY_ENABLED = 'false';
  try {
    const response = await GET(new Request('https://example.test/api/admin/bigquery-catalog', {
      headers: {'x-archive-admin': 'test-admin-token'},
    }));
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(await response.json(), {status: 'disabled'});
  } finally {
    if (saved === undefined) delete process.env.ARCHIVE_ADMIN_TOKEN;
    else process.env.ARCHIVE_ADMIN_TOKEN = saved;
    if (enabled === undefined) delete process.env.BIGQUERY_ENABLED;
    else process.env.BIGQUERY_ENABLED = enabled;
  }
});
