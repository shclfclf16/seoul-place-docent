import test from 'node:test';
import assert from 'node:assert/strict';
import {readCandidateRecords,parseCandidateSearch} from '../lib/bigquery/candidate-records.ts';

test('candidate deadline rejects stalled auth and never queries after expiry',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  let release;
  const pending=readCandidateRecords({VERCEL_ENV:'preview',BIGQUERY_V2_PREVIEW_ENABLED:'true',BIGQUERY_PROJECT_ID:'seoul-place-docent-514906',BIGQUERY_DATASET_ID:'seoul_history'},parseCandidateSearch(new URLSearchParams()),{
    getToken:()=>new Promise(resolve=>{release=resolve;}),fetch:()=>assert.fail('must not query after timeout'),
  });
  t.mock.timers.tick(12000);
  assert.deepEqual(await pending,{status:'unavailable',code:'BIGQUERY_TIMEOUT'});
  release('late-token');await Promise.resolve();await Promise.resolve();
});
