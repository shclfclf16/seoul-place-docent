import test from 'node:test';
import assert from 'node:assert/strict';
import {readVerifiedPlaceRecords,placeRecordsAsScenes} from '../lib/bigquery/place-records.ts';

const settings={BIGQUERY_PLACE_SEARCH_ENABLED:'true',BIGQUERY_PROJECT_ID:'seoul-place-docent-514906',BIGQUERY_DATASET_ID:'seoul_history',BIGQUERY_LOCATION:'asia-northeast3',BIGQUERY_MAX_BYTES_BILLED:'1000',BIGQUERY_MAX_ROWS:'25'};
const row={record_id:'MAPO-01',record_title:'서울화력발전소 기록',record_type:'DOCUMENT',source_institution:'서울기록원',source_url:'https://example.org/source',created_year:'1970',subject_start_year:'1930',subject_end_year:'1980',evidence_excerpt:'발전소 운영에 관한 기록',rights_status:'KOGL1',review_status:'content_checked',historical_place_name:'당인리발전소',relation_type:'EXACT_SITE',relation_evidence:'현장 주소 대조 완료',district:'마포구',legal_dong:'당인동'};
const rows=[row].map(item=>({f:Object.values(item).map(v=>({v}))}));
function deps(dataRows=rows){const calls=[];return {calls,value:{getToken:async()=> 'mock-token',fetch:async(url,options)=>{calls.push({url,body:options.body?JSON.parse(options.body):undefined});if(calls.length===1)return Response.json({location:'asia-northeast3'});if(calls.length===2)return Response.json({totalBytesProcessed:'90'});return Response.json({schema:{fields:Object.keys(row).map(name=>({name}))},jobComplete:true,rows:dataRows});}}};}

test('returns only approved fixed-column matches with a parameterized, cost-bounded dry run',async()=>{
 const mock=deps();const result=await readVerifiedPlaceRecords(settings,{district:'마포구',dong:'당인동'},mock.value);
 assert.equal(result.status,'ok');if(result.status!=='ok')return;assert.equal(result.records.length,1);assert.equal(result.records[0].record_id,'MAPO-01');
 const dry=mock.calls[1].body,query=mock.calls[2].body;
 assert.equal(dry.dryRun,true);assert.equal(query.maximumBytesBilled,'1000');assert.equal(query.queryParameters[0].parameterValue.value,'마포구');assert.equal(query.queryParameters[1].parameterValue.value,'당인동');
 assert.match(query.query,/review_status/);assert.match(query.query,/link_review_status/);assert.match(query.query,/rights_status/);assert.match(query.query,/location_review_status/);assert.match(query.query,/duplicate_status/);assert.doesNotMatch(query.query,/마포구|당인동/);
});

test('disabled, invalid, budget overflow, and missing tables remain safe',async()=>{
 assert.deepEqual(await readVerifiedPlaceRecords({}, {district:'마포구',dong:'당인동'},{getToken:async()=>assert.fail('no auth while disabled')}),{status:'disabled'});
 assert.equal((await readVerifiedPlaceRecords(settings,{district:'x',dong:'당인동'},{getToken:async()=>assert.fail('no auth')})).code,'BIGQUERY_CONFIG_INVALID');
 const over=await readVerifiedPlaceRecords({...settings,BIGQUERY_MAX_BYTES_BILLED:'10'},{district:'마포구',dong:'당인동'},{getToken:async()=> 'mock',fetch:async(_url,options)=>options.body?Response.json({totalBytesProcessed:'11'}):Response.json({location:'asia-northeast3'})});
 assert.equal(over.code,'BIGQUERY_BUDGET_EXCEEDED');
 const denied=await readVerifiedPlaceRecords(settings,{district:'마포구',dong:'당인동'},{getToken:async()=> 'mock',fetch:async()=>new Response('table missing', {status:404})});
 assert.equal(denied.status,'unavailable');assert.equal(denied.code,'BIGQUERY_REQUEST_FAILED');
});

test('public filter excludes unusable source URLs and scene relation labels avoid asserting building identity',async()=>{
 const bad={...row,source_url:'http://example.org'};const mock=deps([{f:Object.values(bad).map(v=>({v}))}]);
 const result=await readVerifiedPlaceRecords(settings,{district:'마포구',dong:'당인동'},mock.value);assert.equal(result.status,'ok');if(result.status!=='ok')return;assert.equal(result.records.length,0);
 const scenes=placeRecordsAsScenes([row]);assert.equal(scenes[0].id,'bq:MAPO-01');assert.match(scenes[0].evidence[0].note,/개별 건물의 동일성은 별도 근거/);assert.deepEqual(scenes[0].photos,[]);
});
