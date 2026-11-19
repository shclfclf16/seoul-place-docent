import test from 'node:test';
import assert from 'node:assert/strict';
import {readClassroomRecords} from '../lib/bigquery/classroom-records.ts';
import {
  classroomDemoEnabled, classroomPhotoEmbedEnabled, classroomTokenMatches,
  createClassroomSession, getClassroomCookie, isClassroomSessionValid,
} from '../lib/classroom-demo-auth.ts';
import {POST as startSession} from '../app/api/classroom-demo/session/route.ts';
import {GET as getRecords} from '../app/api/classroom-demo/records/route.ts';

const settings = {
  VERCEL_ENV: 'preview', CLASSROOM_DEMO_ENABLED: 'true', BIGQUERY_PLACE_SEARCH_ENABLED: 'false',
  BIGQUERY_PROJECT_ID: 'seoul-place-docent-514906', BIGQUERY_DATASET_ID: 'seoul_history',
  BIGQUERY_LOCATION: 'asia-northeast3', BIGQUERY_MAX_BYTES_BILLED: '1000',
};
const token = 'class-demo-test-token-0123456789abcdef0123456789abcdef';
const fieldNames = [
  'record_id','record_title','record_type','source_institution','source_url','created_year','subject_start_year',
  'subject_end_year','rights_status','review_status','duplicate_status','historical_place_name','place_id','place_name',
  'district','legal_dong','location_review_status','relation_type','relation_evidence','link_review_status',
];
const recordRows = [
  ['DANGIN-C03','주명덕의 1964년 당인리 사진','PHOTO','서울역사박물관','https://museum.seoul.go.kr/source',1964,null,null,'원본 이용조건 미확인','NEEDS_REVIEW','UNVERIFIED_AGAINST_OPERATIONAL_DB','당인리', 'SEOUL-MAPO-DANGIN-AREA-UNVERIFIED','당인동 일대','마포구','당인동','UNVERIFIED','DISTRICT_CONTEXT','발전소와 주변 농경지 모습; 부지 내부 촬영 미확인','NEEDS_REVIEW'],
].map(values => ({f: values.map(v => ({v}))}));

test('classroom metadata query is Preview-gated, read-only, and independent of public place-search flag', async () => {
  const requests = [];
  const result = await readClassroomRecords(settings, {
    getToken: async () => 'mock-google-token',
    fetch: async (url, options) => {
      requests.push({url, body: options.body ? JSON.parse(options.body) : undefined});
      if (requests.length === 1) return Response.json({location: 'asia-northeast3'});
      if (requests.length === 2) return Response.json({totalBytesProcessed: '99'});
      return Response.json({jobComplete: true, schema: {fields: fieldNames.map(name => ({name}))}, rows: recordRows});
    },
  });
  assert.equal(result.status, 'ok');
  assert.equal(result.records[0].recordId, 'DANGIN-C03');
  assert.equal(result.records[0].reviewStatus, 'NEEDS_REVIEW');
  assert.equal(result.records[0].relationType, 'DISTRICT_CONTEXT');
  assert.equal(result.imageEmbedEnabled, false);
  assert.equal(requests[1].body.dryRun, true);
  assert.match(requests[2].body.query, /historical_records/);
  assert.match(requests[2].body.query, /record_place_links/);
  assert.match(requests[2].body.query, /places/);
  assert.match(requests[2].body.query, /STARTS_WITH\(r\.record_id, 'DANGIN-'\)/);
  assert.doesNotMatch(requests[2].body.query, /historical_records_test|INSERT|UPDATE|DELETE|MERGE|latitude|longitude|current_address/i);
  assert.equal(requests[2].body.maximumBytesBilled, '1000');
});

test('classroom image embed needs Preview, feature switch, and explicit rights approval', () => {
  assert.equal(classroomDemoEnabled(settings), true);
  assert.equal(classroomDemoEnabled({...settings, VERCEL_ENV: 'production'}), false);
  assert.equal(classroomPhotoEmbedEnabled({...settings, CLASSROOM_DEMO_IMAGE_EMBED_ENABLED: 'true'}), false);
  assert.equal(classroomPhotoEmbedEnabled({...settings, CLASSROOM_DEMO_IMAGE_EMBED_ENABLED: 'true', CLASSROOM_DEMO_IMAGE_RIGHTS_APPROVED: 'true'}), true);
});

test('classroom query fails closed on token, read errors, and invalid BigQuery results', async () => {
  assert.deepEqual(await readClassroomRecords({...settings, VERCEL_ENV: 'production'}, {
    getToken: async () => assert.fail('must not authenticate outside Preview'),
  }), {status: 'disabled'});
  const auth = await readClassroomRecords(settings, {getToken: async () => {throw new Error('secret');}});
  assert.deepEqual(auth, {status: 'unavailable', code: 'BIGQUERY_AUTH_FAILED'});
  let calls = 0;
  const budget = await readClassroomRecords(settings, {
    getToken: async () => 'mock',
    fetch: async () => { calls++; return Response.json(calls === 1 ? {location: 'asia-northeast3'} : {totalBytesProcessed: '1001'}); },
  });
  assert.deepEqual(budget, {status: 'unavailable', code: 'BIGQUERY_BUDGET_EXCEEDED'});
  assert.equal(calls, 2);
});

test('classroom bearer key is constant-time checked and sessions are signed, short-lived, and tamper-resistant', () => {
  assert.equal(classroomTokenMatches(token, token), true);
  assert.equal(classroomTokenMatches('wrong-class-demo-token-0123456789abcdef0123456789', token), false);
  const now = Date.UTC(2026, 10, 18);
  const session = createClassroomSession(token, now);
  assert.equal(isClassroomSessionValid(session, token, now), true);
  assert.equal(isClassroomSessionValid(session, token, now + 4 * 60 * 60 * 1000 + 1000), false);
  assert.equal(isClassroomSessionValid(`${session}x`, token, now), false);
  assert.equal(getClassroomCookie(new Request('https://example.test/api/classroom-demo/records', {headers: {cookie: `other=x; seoul_classroom_demo=${session}`}})), session);
});

test('classroom API denies data without its own session even when Preview and BigQuery are enabled', async () => {
  const saved = Object.fromEntries(['VERCEL_ENV','CLASSROOM_DEMO_ENABLED','CLASSROOM_DEMO_TOKEN','BIGQUERY_ENABLED'].map(key => [key, process.env[key]]));
  Object.assign(process.env, {VERCEL_ENV: 'preview', CLASSROOM_DEMO_ENABLED: 'true', CLASSROOM_DEMO_TOKEN: token, BIGQUERY_ENABLED: 'true'});
  try {
    const response = await getRecords(new Request('https://example.test/api/classroom-demo/records'));
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(await response.json(), {error: '수업용 인증이 필요합니다.'});
  } finally {
    for (const [key, value] of Object.entries(saved)) value === undefined ? delete process.env[key] : process.env[key] = value;
  }
});

test('classroom login issues only an HttpOnly session cookie and rejects invalid keys', async () => {
  const saved = Object.fromEntries(['VERCEL_ENV','CLASSROOM_DEMO_ENABLED','CLASSROOM_DEMO_TOKEN'].map(key => [key, process.env[key]]));
  Object.assign(process.env, {VERCEL_ENV: 'preview', CLASSROOM_DEMO_ENABLED: 'true', CLASSROOM_DEMO_TOKEN: token});
  try {
    const rejected = await startSession(new Request('https://example.test/api/classroom-demo/session', {
      method: 'POST', headers: {'content-type': 'application/json', origin: 'https://example.test'},
      body: JSON.stringify({token: 'wrong-class-demo-token-0123456789abcdef0123456789'}),
    }));
    assert.equal(rejected.status, 403);
    assert.equal(rejected.headers.get('set-cookie'), null);

    const accepted = await startSession(new Request('https://example.test/api/classroom-demo/session', {
      method: 'POST', headers: {'content-type': 'application/json', origin: 'https://example.test'},
      body: JSON.stringify({token}),
    }));
    assert.equal(accepted.status, 200);
    assert.equal((await accepted.json()).authenticated, true);
    const cookie = accepted.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly/); assert.match(cookie, /Secure/); assert.match(cookie, /SameSite=Strict/);
    assert.doesNotMatch(cookie, new RegExp(token));
  } finally {
    for (const [key, value] of Object.entries(saved)) value === undefined ? delete process.env[key] : process.env[key] = value;
  }
});
