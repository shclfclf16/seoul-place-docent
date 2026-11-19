import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdtempSync,unlinkSync,rmdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {reviewHandlers} from '../lib/bigquery/review-api.ts';
import {reviewEligible} from '../lib/bigquery/review-policy.ts';
import {makeReviewSession,cookieHeaders,registerReviewSession,storedSessionValid,readReviewSession} from '../lib/bigquery/review-auth.ts';
import {candidateMetadata,V2_SNAPSHOT,parseCandidateSearch,candidateQuery} from '../lib/bigquery/candidate-records.ts';
const settings={VERCEL_ENV:'preview',BIGQUERY_V2_PREVIEW_ENABLED:'true',ARCHIVE_ADMIN_TOKEN:'a'.repeat(40),ARCHIVE_REVIEW_SESSION_SECRET:'s'.repeat(40)};
function database(filename=':memory:'){
 const sql=new DatabaseSync(filename);
 for(const file of ['0005_bigquery_v2_reviews.sql','0006_bigquery_v2_review_sessions.sql'])sql.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
 return {sql,prepare(q){return {params:[],bind(...p){this.params=p;return this;},async first(){return sql.prepare(q).get(...this.params)??null;},async all(){return {results:sql.prepare(q).all(...this.params)};},async run(){const r=sql.prepare(q).run(...this.params);return {meta:{changes:Number(r.changes)}};}};},async batch(items){sql.exec('BEGIN');try{const out=[];for(const x of items)out.push(await x.run());sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}}};
}
async function fixture(filename=':memory:'){
 const db=database(filename),csrf='c'.repeat(43),session=makeReviewSession(settings.ARCHIVE_REVIEW_SESSION_SECRET,csrf,Date.now(),'reviewer-1');
 await registerReviewSession(db,session,'reviewer-1',settings.ARCHIVE_ADMIN_TOKEN);
 const cookie=cookieHeaders(session,csrf).map(x=>x.split(';')[0]).join('; ');
 let candidate=candidateMetadata({record_id:'r',record_title:'후보',record_type:'PHOTO',batch_sha256:V2_SNAPSHOT,row_sha256:'a'.repeat(64),place_id:'p',place_batch_sha256:V2_SNAPSHOT,place_row_sha256:'b'.repeat(64),link_batch_sha256:V2_SNAPSHOT,link_row_sha256:'c'.repeat(64),link_row_number:'2',relation_type:'DISTRICT_CONTEXT',source_url:'https://source.example/item',review_status:'PENDING',duplicate_link_count:'2'});
 const reads=[];const api=reviewHandlers(settings,db,async input=>{reads.push(input);return {status:'ok',records:[structuredClone(candidate)],page:input.page,pageSize:input.pageSize,nextPage:null,budget:{},notice:'미검토 후보 자료'};});
 const request=(method='GET',body,query='reviewState=ALL')=>new Request('https://preview.example/api/admin/bigquery-v2/reviews?'+query,{method,headers:{cookie,origin:'https://preview.example','x-csrf-token':csrf,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 const body=()=>({recordId:'r',linkRowNumber:2,expectedRevision:0,expectedIntegrity:structuredClone(candidate.integrity),state:'PENDING',holdReason:'원문 재검토',verifiedLocation:{address:'',latitude:'',longitude:'',buildingManagementNumber:'',evidenceUrl:''},checks:Object.fromEntries(['human_review','original_source','rights','place','relation'].map(k=>[k,{status:'PENDING',comment:'',evidenceUrl:''}])),permissions:Object.fromEntries(['metadata','display','thumbnail','embed','storage','modification'].map(k=>[k,{status:'UNKNOWN',comment:'',evidenceUrl:''}]))});
 const verified=()=>{const v=body();v.state='APPROVED';v.expiresAt=new Date(Date.now()+86400000).toISOString();for(const k of Object.keys(v.checks))v.checks[k]={status:'VERIFIED',comment:'사람이 원문 대조',evidenceUrl:'https://evidence.example/'+k};v.permissions.metadata={status:'ALLOWED',evidenceUrl:'https://rights.example/license',comment:'메타데이터만'};return v;};
 return {db,api,request,body,verified,reads,get candidate(){return candidate;},set candidate(v){candidate=v;}};
}
test('review API persists holds, independent review authors and audit history without media or public promotion',async()=>{
 const f=await fixture();const saved=await f.api.POST(f.request('POST',f.body()));assert.equal(saved.status,200);
 const list=await (await f.api.GET(f.request())).json();assert.equal(list.records[0].review.state,'PENDING');assert.equal(list.records[0].sourceReview.record,'PENDING');assert.equal(list.records[0].reviewHistory.length,1);assert.equal(list.records[0].diagnostics.duplicateLinkCount,2);assert.equal(list.records[0].mediaPermissions.display.allowed,false);
 const approve=f.verified();approve.expectedRevision=1;assert.equal((await f.api.POST(f.request('POST',approve))).status,200);
 assert.equal((await (await f.api.GET(f.request())).json()).records[0].review.state,'APPROVED');
 const revoke={...f.body(),expectedRevision:2,state:'REVOKED'};assert.equal((await f.api.POST(f.request('POST',revoke))).status,200);
 assert.equal((await f.api.POST(f.request('POST',{...approve,expectedRevision:3}))).status,409);
 assert.equal((await f.api.POST(f.request('POST',{...f.body(),expectedRevision:3,state:'IN_REVIEW',action:'REOPEN'}))).status,200);
 const history=(await (await f.api.GET(f.request())).json()).records[0].reviewHistory;assert.deepEqual(history.map(x=>x.action),['REOPEN','REVOKE','APPROVE','HOLD']);
 assert.equal(f.db.sql.prepare('SELECT count(*) n FROM bq_v2_review_state').get().n,1);f.db.sql.close();
});
test('blank place links remain reviewable but ineligible, and changed hashes invalidate the old review',async()=>{
 const f=await fixture();f.candidate={...f.candidate,placeId:'',relationType:'UNCERTAIN',integrity:{...f.candidate.integrity,placeRowSha256:'',placeBatchSha256:''}};
 assert.equal((await f.api.POST(f.request('POST',f.body()))).status,200);
 assert.equal((await f.api.POST(f.request('POST',{...f.verified(),expectedRevision:1}))).status,400);
 const old=f.body();f.candidate.integrity.recordRowSha256='d'.repeat(64);assert.equal((await f.api.POST(f.request('POST',old))).status,409);
 const rows=await (await f.api.GET(f.request())).json();assert.equal(rows.records[0].review,null);f.db.sql.close();
});
test('expiry, incomplete reviews, image rights and video playback fail closed',async()=>{
 const f=await fixture();const incomplete={...f.body(),state:'APPROVED',expiresAt:new Date(Date.now()+86400000).toISOString()};assert.equal((await f.api.POST(f.request('POST',incomplete))).status,400);
 const image=f.verified();image.permissions.display={status:'ALLOWED',evidenceUrl:'https://rights.example/display'};assert.equal((await f.api.POST(f.request('POST',image))).status,400);
 const missing=f.verified();f.candidate.sourceUrl=null;assert.equal((await f.api.POST(f.request('POST',missing))).status,400);f.candidate.sourceUrl='https://source.example/item';
 assert.equal((await f.api.POST(f.request('POST',f.verified()))).status,200);f.db.sql.prepare('UPDATE bq_v2_review_state SET expires_at=?').run('2000-01-01T00:00:00Z');assert.equal((await (await f.api.GET(f.request())).json()).records[0].review.state,'EXPIRED');f.db.sql.close();
});
test('concurrent revisions commit one state and audit, and audit failure rolls the state back',async()=>{
 const f=await fixture();const responses=await Promise.all([f.api.POST(f.request('POST',f.body())),f.api.POST(f.request('POST',f.body()))]);assert.equal(responses.filter(x=>x.status===200).length,1);assert.equal(f.db.sql.prepare('SELECT count(*) n FROM bq_v2_review_events').get().n,1);
 f.db.sql.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON bq_v2_review_events BEGIN SELECT RAISE(ABORT,'test audit failure'); END;");assert.equal((await f.api.POST(f.request('POST',{...f.body(),expectedRevision:1,state:'REJECTED'}))).status,503);assert.equal(f.db.sql.prepare('SELECT revision FROM bq_v2_review_state').get().revision,1);f.db.sql.close();
});
test('sessions require server registry, support revocation and credential rotation; API enforces CSRF and Production block',async()=>{
 const f=await fixture();assert.equal((await f.api.GET(new Request('https://preview.example/api/admin/bigquery-v2/reviews'))).status,403);
 const forged=f.request('POST',f.body());forged.headers.delete('x-csrf-token');assert.equal((await f.api.POST(forged)).status,403);
 const session=readReviewSession(f.request(),settings);assert.equal(await storedSessionValid(f.db,session,'rotated-token'),false);
 f.db.sql.prepare('DELETE FROM bq_v2_review_sessions').run();assert.equal((await f.api.GET(f.request())).status,403);
 const prod=reviewHandlers({...settings,VERCEL_ENV:'production'},f.db,()=>assert.fail('no query'));assert.equal((await prod.GET(f.request())).status,404);f.db.sql.close();
});
test('search forwards year and pagination with SQL parameters; invalid inputs never read candidates',async()=>{
 const f=await fixture();assert.equal((await f.api.GET(f.request('GET',undefined,'reviewState=ALL&year=1965&page=2&pageSize=2&placeName=마장'))).status,200);assert.equal(f.reads[0].year,'1965');assert.equal(f.reads[0].page,2);
 assert.equal((await f.api.GET(f.request('GET',undefined,'year=invalid'))).status,400);assert.equal(f.reads.length,1);
 const query=candidateQuery({BIGQUERY_PROJECT_ID:'seoul-place-docent-514906',BIGQUERY_DATASET_ID:'seoul_history'},parseCandidateSearch(new URLSearchParams({year:'1965',title:"' OR true --"})));assert.ok(!query.query.includes("' OR true --"));assert.ok(query.queryParameters.some(x=>x.name==='year'&&x.parameterValue.value==='1965'));f.db.sql.close();
});
test('Python and TypeScript eligibility agree on metadata, media, hashes, expiry and exact locations',()=>{
 const now=Date.parse('2026-01-01T12:00:00Z'),record={record_id:'r',record_type:'PHOTO',source_url:'https://source.example/item',_batch_sha256:'f'.repeat(64),_row_sha256:'a'.repeat(64)},place={place_id:'p',_batch_sha256:'f'.repeat(64),_row_sha256:'b'.repeat(64)},link={record_id:'r',place_id:'p',relation_type:'DISTRICT_CONTEXT',_batch_sha256:'f'.repeat(64),_row_sha256:'c'.repeat(64)};
 const review={state:'APPROVED',reviewer_id:'one',review_id:'id',reviewed_at:'2026-01-01T00:00:00Z',expires_at:'2026-02-01T00:00:00Z',checks:Object.fromEntries(['human_review','original_source','rights','place','relation'].map(k=>[k,{status:'VERIFIED',evidence_url:'https://evidence.example/'+k}])),permissions:Object.fromEntries(['metadata','display','thumbnail','embed','storage','modification'].map(k=>[k,{status:'ALLOWED',evidence_url:'https://rights.example/'+k}]))};for(const [name,row] of [['record',record],['place',place],['link',link]])for(const key of ['_batch_sha256','_row_sha256'])review[name+key]=row[key];
 const cases=[];const add=(change={},action='metadata')=>cases.push({record:structuredClone(record),place:structuredClone(place),link:structuredClone(link),review:structuredClone(review),action,...change});add();add({},'display');add({review:{...review,image_review_status:'VERIFIED'}},'display');add({},'embed');add({record:{...record,record_type:'VIDEO'},review:{...review,playback_review_status:'VERIFIED'}},'embed');add({link:{...link,relation_type:'UNCERTAIN'}});add({link:{...link,relation_type:'EXACT_SITE'}});add({link:{...link,relation_type:'EXACT_SITE'},review:{...review,verified_location:{address:'실제 검증 주소',latitude:37.5,longitude:127,evidence_url:'https://location.example/proof'}}});add({record:{...record,_row_sha256:'d'.repeat(64)}});add({place:{...place,place_id:''}});add({review:{...review,state:'REVOKED'}});add({review:{...review,expires_at:'2000-01-01T00:00:00Z'}});add({review:{...review,checks:{...review.checks,rights:{status:'PENDING'}}}});add({record:{...record,source_url:null}});
 const script="import json,sys; from datetime import datetime,timezone; from scripts.bigquery.v2.approval_gate import eligible; cases=json.load(sys.stdin); print(json.dumps([eligible(c['record'],c['place'],c['link'],c['review'],c['action'],datetime(2026,1,1,12,tzinfo=timezone.utc)) for c in cases]))";
 const result=spawnSync('python',['-c',script],{cwd:new URL('../',import.meta.url),input:JSON.stringify(cases),encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert.deepEqual(cases.map(c=>reviewEligible(c.record,c.place,c.link,c.review,c.action,now)),JSON.parse(result.stdout));
});

test('rate limit stops requests before more candidate queries and unchanged checks retain their reviewer',async()=>{
 const f=await fixture();const approved=f.verified();assert.equal((await f.api.POST(f.request('POST',approved))).status,200);
 const csrf='d'.repeat(43),token=makeReviewSession(settings.ARCHIVE_REVIEW_SESSION_SECRET,csrf,Date.now(),'reviewer-2');await registerReviewSession(f.db,token,'reviewer-2',settings.ARCHIVE_ADMIN_TOKEN);
 const req=f.request('POST',{...approved,expectedRevision:1,state:'IN_REVIEW'});req.headers.set('cookie',cookieHeaders(token,csrf).map(x=>x.split(';')[0]).join('; '));req.headers.set('x-csrf-token',csrf);
 assert.equal((await f.api.POST(req)).status,200);const stored=JSON.parse(f.db.sql.prepare('SELECT checks_json FROM bq_v2_review_state').get().checks_json);assert.equal(stored.rights.reviewerId,'reviewer-1');
 for(let i=0;i<11;i++)assert.equal((await f.api.GET(f.request())).status,200);
 assert.equal((await f.api.GET(f.request())).status,429);f.db.sql.close();
});

test('review and audit survive closing and reopening the persistent SQLite database',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'bqv2-review-')),file=join(dir,'review.sqlite');let db;
 try{const f=await fixture(file);assert.equal((await f.api.POST(f.request('POST',f.body()))).status,200);f.db.sql.close();db=database(file);
 const reloaded=reviewHandlers(settings,db,async()=>({status:'ok',records:[f.candidate],page:1,pageSize:20,nextPage:null,budget:{},notice:'미검토 후보 자료'}));
 const response=await reloaded.GET(f.request());assert.equal(response.status,200);const item=(await response.json()).records[0];assert.equal(item.review.revision,1);assert.equal(item.reviewHistory[0].action,'HOLD');
 }finally{db?.sql.close();unlinkSync(file);rmdirSync(dir);}
});

test('duplicate links with identical row hashes remain distinct by original CSV row number',async()=>{
 const f=await fixture();assert.equal((await f.api.POST(f.request('POST',f.body()))).status,200);
 f.candidate.integrity.linkInputRow=3;const next={...f.body(),linkRowNumber:3};assert.equal((await f.api.POST(f.request('POST',next))).status,200);
 const rows=f.db.sql.prepare('SELECT link_input_row FROM bq_v2_review_state ORDER BY link_input_row').all();assert.deepEqual(rows.map(x=>x.link_input_row),[2,3]);assert.equal(f.db.sql.prepare('SELECT count(*) n FROM bq_v2_review_events').get().n,2);f.db.sql.close();
});
