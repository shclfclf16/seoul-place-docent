import test from 'node:test';
import assert from 'node:assert/strict';
import {readVerifiedPlaceRecords,placeRecordsAsScenes,classifyPlaceRecord} from '../lib/bigquery/place-records.ts';

const settings={BIGQUERY_PLACE_SEARCH_ENABLED:'true',BIGQUERY_PROJECT_ID:'seoul-place-docent-514906',BIGQUERY_DATASET_ID:'seoul_history',BIGQUERY_LOCATION:'asia-northeast3',BIGQUERY_MAX_BYTES_BILLED:'1000',BIGQUERY_MAX_ROWS:'25'};
const address={roadAddr:'서울특별시 마포구 월드컵로 1',jibunAddr:'서울특별시 마포구 당인동 1',siNm:'서울특별시',sggNm:'마포구',emdNm:'당인동',admCd:'1144012300',bdMgtSn:'1144012300100010000',bdNm:'서울화력발전소'};
const row={record_id:'MAPO-01',record_title:'서울화력발전소 기록',record_type:'DOCUMENT',source_institution:'서울기록원',source_url:'https://example.org/source',created_year:'1970',subject_start_year:'1930',subject_end_year:'1980',evidence_excerpt:'발전소 운영에 관한 기록',rights_status:'KOGL1',review_status:'content_checked',historical_place_name:'당인리발전소',relation_type:'EXACT_SITE',relation_evidence:'현장 주소 대조 완료',district:'마포구',legal_dong:'당인동',place_id:'POWER-1',place_name:'서울화력발전소',current_address:'서울특별시 마포구 월드컵로 1',road_address:'서울특별시 마포구 월드컵로 1',jibun_address:'서울특별시 마포구 당인동 1',building_name:'서울화력발전소',building_management_number:'1144012300100010000',latitude:'37.55',longitude:'126.91',coordinate_system:'EPSG:4326'};
const rows=[row].map(item=>({f:Object.values(item).map(v=>({v}))}));
function deps(dataRows=rows){const calls=[];return {calls,value:{getToken:async()=> 'mock-token',fetch:async(url,options)=>{calls.push({url,body:options.body?JSON.parse(options.body):undefined});if(calls.length===1)return Response.json({location:'asia-northeast3'});if(calls.length===2)return Response.json({totalBytesProcessed:'90'});return Response.json({schema:{fields:Object.keys(row).map(name=>({name}))},jobComplete:true,rows:dataRows});}}};}

test('returns only approved fixed-column matches with a parameterized, cost-bounded dry run',async()=>{
 const mock=deps();const result=await readVerifiedPlaceRecords(settings,{address,point:{x:126.91,y:37.55}},mock.value);
 assert.equal(result.status,'ok');if(result.status!=='ok')return;assert.equal(result.records.length,1);assert.equal(result.records[0].record_id,'MAPO-01');
 const dry=mock.calls[1].body,query=mock.calls[2].body;
 assert.equal(dry.dryRun,true);assert.equal(query.maximumBytesBilled,'1000');assert.equal(query.queryParameters[0].parameterValue.value,'마포구');assert.equal(query.queryParameters[1].parameterValue.value,'당인동');
 assert.match(query.query,/review_status/);assert.match(query.query,/link_review_status/);assert.match(query.query,/rights_status/);assert.match(query.query,/location_review_status/);assert.match(query.query,/duplicate_status/);assert.doesNotMatch(query.query,/마포구|당인동/);
});

test('disabled, invalid, budget overflow, and missing tables remain safe',async()=>{
 assert.deepEqual(await readVerifiedPlaceRecords({}, {address},{getToken:async()=>assert.fail('no auth while disabled')}),{status:'disabled'});
 assert.equal((await readVerifiedPlaceRecords(settings,{address:{...address,admCd:'bad'}},{getToken:async()=>assert.fail('no auth')})).code,'BIGQUERY_CONFIG_INVALID');
 const over=await readVerifiedPlaceRecords({...settings,BIGQUERY_MAX_BYTES_BILLED:'10'},{address},{getToken:async()=> 'mock',fetch:async(_url,options)=>options.body?Response.json({totalBytesProcessed:'11'}):Response.json({location:'asia-northeast3'})});
 assert.equal(over.code,'BIGQUERY_BUDGET_EXCEEDED');
 const denied=await readVerifiedPlaceRecords(settings,{address},{getToken:async()=> 'mock',fetch:async()=>new Response('table missing', {status:404})});
 assert.equal(denied.status,'unavailable');assert.equal(denied.code,'BIGQUERY_REQUEST_FAILED');
});

test('public filter excludes unusable source URLs and scene relation labels avoid asserting building identity',async()=>{
 const bad={...row,source_url:'http://example.org'};const mock=deps([{f:Object.values(bad).map(v=>({v}))}]);
 const result=await readVerifiedPlaceRecords(settings,{address,point:{x:126.91,y:37.55}},mock.value);assert.equal(result.status,'ok');if(result.status!=='ok')return;assert.equal(result.records.length,0);
 const scenes=placeRecordsAsScenes([row]);assert.equal(scenes[0].id,'bq:MAPO-01');assert.match(scenes[0].evidence[0].note,/건축물관리번호 또는 도로명·지번주소/);assert.equal(scenes[0].scope,'place');assert.deepEqual(scenes[0].photos,[]);
 assert.equal(classifyPlaceRecord({...row,road_address:'다른 주소',jibun_address:'다른 지번',current_address:'다른 주소',building_management_number:'다른 번호'},address),null,'same dong alone cannot make an exact-site match');
 const majangAddress={...address,roadAddr:'서울특별시 성동구 마장로 1',jibunAddr:'서울특별시 성동구 마장동 1',sggNm:'성동구',emdNm:'마장동',admCd:'1120010600',bdMgtSn:'1120010600100010000',bdNm:'세림아파트'};
 assert.equal(classifyPlaceRecord(row,majangAddress),null,'Danginri records must never be returned for Majang-dong');
 assert.equal(classifyPlaceRecord({...row,relation_type:'NEARBY',latitude:37.551,longitude:126.91},address,{x:126.91,y:37.55})?.relation_type,'NEARBY');
 assert.equal(classifyPlaceRecord({...row,relation_type:'NEARBY'},address),null,'nearby requires verified coordinates');
 assert.equal(classifyPlaceRecord({...row,relation_type:'DISTRICT_CONTEXT',building_management_number:'',current_address:'',road_address:'',jibun_address:''},address)?.relation_type,'DISTRICT_CONTEXT');
});
