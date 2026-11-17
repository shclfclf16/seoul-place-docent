import test from 'node:test';
import assert from 'node:assert/strict';
import {getDocentStory} from '../lib/docent-data.ts';
import {addBigQueryEvidence} from '../lib/bigquery/docent.ts';

test('website docent story remains intact while BigQuery place search is disabled',async()=>{
 const original=process.env.BIGQUERY_PLACE_SEARCH_ENABLED;delete process.env.BIGQUERY_PLACE_SEARCH_ENABLED;
 try{
  const before=getDocentStory('성동구','성수동1가');const after=await addBigQueryEvidence(before);
  assert.equal(after.bigQueryStatus,'address_unverified');assert.deepEqual(after.story.scenes.map(row=>row.id),before.scenes.map(row=>row.id));assert.equal(after.story.total,before.total);
 }finally{if(original===undefined)delete process.env.BIGQUERY_PLACE_SEARCH_ENABLED;else process.env.BIGQUERY_PLACE_SEARCH_ENABLED=original;}
});
