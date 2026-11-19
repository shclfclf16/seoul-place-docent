import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {candidatePreviewEnabled,parseCandidateSearch,candidateQuery,candidateMetadata,readCandidateRecords,V2_SNAPSHOT} from '../lib/bigquery/candidate-records.ts';
import {candidateHandler} from '../lib/bigquery/candidate-api.ts';
import {GET} from '../app/api/admin/bigquery-v2/records/route.ts';
import {readVerifiedPlaceRecords} from '../lib/bigquery/place-records.ts';

const settings={VERCEL_ENV:'preview',BIGQUERY_V2_PREVIEW_ENABLED:'true',BIGQUERY_PLACE_SEARCH_ENABLED:'false',ARCHIVE_ADMIN_TOKEN:'private-test-admin',BIGQUERY_PROJECT_ID:'seoul-place-docent-514906',BIGQUERY_DATASET_ID:'seoul_history',BIGQUERY_LOCATION:'asia-northeast3',BIGQUERY_V2_MAX_BYTES_BILLED:'1000'};
const input=(query='')=>parseCandidateSearch(new URLSearchParams(query));
const row={record_id:'r1',record_title:'후보 자료',record_type:'PHOTO',created_year:'1960',source_institution:'서울역사박물관',source_url:'https://example.org/original',review_status:'NEEDS_REVIEW',rights_status:'UNKNOWN',place_id:'p1',place_name:'당인리',district:'마포구',legal_dong:'당인동',relation_type:'EXACT_SITE',link_row_number:'2',duplicate_link_count:'2',audit_state:'UNVERIFIED_EXACT_SITE',display_permission:'ALLOWED_REPORTED',thumbnail_permission:'UNKNOWN',embed_permission:'UNKNOWN',storage_permission:'UNKNOWN',modification_permission:'UNKNOWN'};
function mockDeps(rows=[row],estimate='99'){
  const calls=[];
  return {calls,getToken:async()=> 'token',fetch:async(url,options)=>{
    const body=options.body?JSON.parse(options.body):null; calls.push({url,body,options});
    if(!body)return Response.json({location:'asia-northeast3'});
    if(body.dryRun)return Response.json({totalBytesProcessed:estimate});
    const fields=Object.keys(row);
    return Response.json({jobComplete:true,totalBytesProcessed:estimate,totalBytesBilled:'100',jobReference:{jobId:'job'},schema:{fields:fields.map(name=>({name}))},rows:rows.map(r=>({f:fields.map(key=>({v:r[key]??null}))}))});
  }};
}

test('candidate feature is Preview-only and separate from public switch',async()=>{
  for(const env of ['production','development',undefined]){
    assert.equal(candidatePreviewEnabled({...settings,VERCEL_ENV:env}),false);
    assert.deepEqual(await readCandidateRecords({...settings,VERCEL_ENV:env},input(),{getToken:()=>assert.fail()}),{status:'disabled'});
  }
  assert.equal(candidatePreviewEnabled(settings),true);
  assert.deepEqual(await readVerifiedPlaceRecords(settings,{}, {getToken:()=>assert.fail()}),{status:'disabled'});
});

test('all six filters and pagination are named parameters, never SQL interpolation',()=>{
  const hostile="x' OR TRUE -- %_";
  const query=candidateQuery(settings,input(new URLSearchParams({institution:hostile,recordType:'PHOTO',district:'성동구',legalDong:'마장동',placeName:hostile,title:hostile,page:'2',pageSize:'10'}).toString()));
  assert.equal(query.query.includes(hostile),false);
  assert.deepEqual(query.queryParameters.filter(p=>p.parameterValue.value===hostile).map(p=>p.name),['institution','placeName','title']);
  assert.equal(query.queryParameters.find(p=>p.name==='offset').parameterValue.value,'10');
  for(const k of ['records','links','places'])assert.ok(query.query.includes(`v2_${k}_${V2_SNAPSHOT}`));
  assert.doesNotMatch(query.query,/historical_records|rawv2_|SELECT DISTINCT|INSERT|UPDATE|DELETE|MERGE/);
});

test('invalid filters, duplicate keys, address injection and unbounded pagination are rejected',()=>{
  for(const value of ['page=0','page=-1','page=NaN','pageSize=51','page=1000&pageSize=50','placeName=a&placeName=b','address=서울특별시','title=%00'])assert.throws(()=>input(value));
  assert.throws(()=>candidateQuery({...settings,BIGQUERY_DATASET_ID:'a` UNION SELECT'},input()));
});

test('read service applies dry run, hard byte cap, row bound and server/client timeout',async()=>{
  const deps=mockDeps();const result=await readCandidateRecords(settings,input('recordType=PHOTO'),deps);
  assert.equal(result.status,'ok');assert.equal(result.records[0].candidateLabel,'미검토 후보 자료');
  assert.equal(deps.calls[1].body.dryRun,true);
  assert.equal(deps.calls[2].body.maximumBytesBilled,'1000');
  assert.equal(deps.calls[2].body.jobTimeoutMs,'8000');assert.equal(deps.calls[2].body.timeoutMs,8000);
  assert.equal(deps.calls[2].body.maxResults,26);assert.equal(deps.calls[2].options.cache,'no-store');
  assert.equal(result.budget.billedBytes,'100');
});

test('over-budget query never executes, and provider errors reveal no secrets',async()=>{
  const deps=mockDeps([row],'1001');
  assert.deepEqual(await readCandidateRecords(settings,input(),deps),{status:'unavailable',code:'BIGQUERY_BUDGET_EXCEEDED'});
  assert.equal(deps.calls.length,2);
  assert.deepEqual(await readCandidateRecords(settings,input(),{getToken:async()=>{throw Error('SECRET')}}),{status:'unavailable',code:'BIGQUERY_AUTH_FAILED'});
});

test('pending or truncated BigQuery jobs fail closed',async()=>{
  for(const response of [{jobComplete:false},{jobComplete:true,pageToken:'next'}]){
    const deps=mockDeps();let count=0;const fetcher=deps.fetch;
    deps.fetch=async(...args)=>++count===3?Response.json(response):fetcher(...args);
    assert.equal((await readCandidateRecords(settings,input(),deps)).status,'unavailable');
  }
});

test('duplicates remain separate, pagination has a stable link-row key',async()=>{
  const deps=mockDeps([row,{...row,link_row_number:'3'}]);
  const result=await readCandidateRecords(settings,input('pageSize=1'),deps);
  assert.equal(result.nextPage,2);assert.equal(result.records.length,1);
  assert.equal(result.records[0].diagnostics.duplicateLinkCount,2);
  assert.match(deps.calls[2].body.query,/ORDER BY r.record_id, COALESCE\(l._input_row_number,0\)/);
  assert.match(deps.calls[2].body.query,/LEFT JOIN/);
  const all=await readCandidateRecords(settings,input(),mockDeps([row,{...row,link_row_number:'3'}]));
  assert.equal(all.records.length,2);
});

test('empty place IDs and UNCERTAIN stay diagnostic, not silently removed',()=>{
  const candidate=candidateMetadata({...row,place_id:'',relation_type:'UNCERTAIN',audit_state:'EMPTY_PLACE_ID'});
  assert.equal(candidate.placeId,'');assert.equal(candidate.diagnostics.emptyPlaceId,true);
  assert.equal(candidate.relationScope,'UNCERTAIN');
  assert.equal(candidateMetadata({...row,relation_type:'DISTRICT_CONTEXT'}).relationScope,'DISTRICT_CONTEXT');
});

test('Majang-ro 42-gil 16 never receives another candidate as direct building history',()=>{
  const query=candidateQuery(settings,input('district=성동구&placeName='+encodeURIComponent('서울특별시 성동구 마장로42길 16')));
  assert.ok(query.queryParameters.some(p=>p.parameterValue.value==='서울특별시 성동구 마장로42길 16'));
  const candidate=candidateMetadata({...row,place_name:'당인리',relation_type:'EXACT_SITE',approved_for_public_use:true,approved_location:true,approved_relation:true});
  assert.equal(candidate.directConnection,false);assert.equal(candidate.relationScope,'UNVERIFIED_EXACT_SITE');
  assert.equal(candidate.approvedForPublicUse,false);
});

test('media rights are independent and raw URLs/segments are never serialized',()=>{
  const result=candidateMetadata({...row,media_url:'https://secret/image',thumbnail_url:'https://secret/thumb',embed_url:'https://secret/embed',segments_json:'private',display_permission:'ALLOWED',storage_permission:'ALLOWED',embed_permission:'ALLOWED',approved_for_public_use:true});
  for(const action of ['display','thumbnail','embed','storage','modification'])assert.equal(result.mediaPermissions[action].allowed,false);
  assert.doesNotMatch(JSON.stringify(result),/secret\/|segments_json|media_url|thumbnail_url|embed_url/);
  assert.equal(candidateMetadata({...row,source_url:'javascript:alert(1)'}).sourceUrl,null);
  assert.equal(candidateMetadata({...row,source_url:'https://user:pass@example.org'}).sourceUrl,null);
});

test('admin API rejects public, unauthenticated and cross-origin requests before queries',async()=>{
  let calls=0;const read=async()=>{calls++;return {status:'disabled'}};
  for(const env of ['production','development']){
    const response=await candidateHandler({...settings,VERCEL_ENV:env},read)(new Request('https://example.test/api/admin/bigquery-v2/records',{headers:{'x-archive-admin':settings.ARCHIVE_ADMIN_TOKEN}}));
    assert.equal(response.status,404);assert.equal(response.headers.get('Cache-Control'),'no-store');
  }
  for(const headers of [{},{'oai-authenticated-user-email':'owner','oai-authenticated-user-id':'owner'},{'x-archive-admin':settings.ARCHIVE_ADMIN_TOKEN,origin:'https://evil.test'}]){
    const response=await candidateHandler(settings,read)(new Request('https://example.test/api/admin/bigquery-v2/records',{headers}));assert.equal(response.status,403);
  }
  assert.equal(calls,0);
});

test('authenticated Preview API returns metadata/no-store and isolates upstream failure',async()=>{
  const request=new Request('https://example.test/api/admin/bigquery-v2/records?recordType=PHOTO',{headers:{'x-archive-admin':settings.ARCHIVE_ADMIN_TOKEN}});
  const response=await candidateHandler(settings,i=>readCandidateRecords(settings,i,mockDeps()))(request);
  assert.equal(response.status,200);assert.equal((await response.json()).records[0].candidateLabel,'미검토 후보 자료');
  assert.equal(response.headers.get('Vercel-CDN-Cache-Control'),'no-store');
  const failed=await candidateHandler(settings,async()=>{throw Error('secret')})(request);
  assert.equal(failed.status,503);assert.doesNotMatch(await failed.text(),/secret/);
});

test('real exported route stays closed in production even with admin key',async()=>{
  const saved={...process.env};
  Object.assign(process.env,settings,{VERCEL_ENV:'production'});
  try{assert.equal((await GET(new Request('https://example.test/api/admin/bigquery-v2/records',{headers:{'x-archive-admin':settings.ARCHIVE_ADMIN_TOKEN}}))).status,404);}
  finally{for(const key of Object.keys(settings))saved[key]===undefined?delete process.env[key]:process.env[key]=saved[key];}
});

test('public runtime and public search remain disconnected from candidate service',()=>{
  assert.doesNotMatch(readFileSync(new URL('../lib/bigquery/place-records.ts',import.meta.url),'utf8'),/readCandidateRecords|v2_records/);
  assert.match(readFileSync(new URL('../lib/bigquery/server.cloudflare.ts',import.meta.url),'utf8'),/getBigQueryCandidateRecords[\s\S]*status:"disabled"/);
  assert.match(readFileSync(new URL('../.env.vercel.example',import.meta.url),'utf8'),/BIGQUERY_PLACE_SEARCH_ENABLED=false/);
});
