import test from 'node:test';import assert from 'node:assert/strict';
import {previewReviewEnabled,constantTokenMatch,makeReviewSession,readReviewSession,csrfValid,cookieHeaders} from '../lib/bigquery/review-auth.ts';
import {readFileSync} from 'node:fs';import {DatabaseSync} from 'node:sqlite';
import {GET} from '../app/api/admin/bigquery-v2/reviews/route.ts';
import {approvalBlock} from '../lib/bigquery/review-policy.ts';
const env={VERCEL_ENV:'preview',BIGQUERY_V2_PREVIEW_ENABLED:'true',ARCHIVE_ADMIN_TOKEN:'a'.repeat(40),ARCHIVE_REVIEW_SESSION_SECRET:'s'.repeat(40)};
test('review session is Preview-only, signed, short-lived, and double-submit CSRF bound',()=>{
 const csrf='c'.repeat(43),session=makeReviewSession(env.ARCHIVE_REVIEW_SESSION_SECRET,csrf,Date.UTC(2026,0,1));const [s,c]=cookieHeaders(session,csrf);
 const req=new Request('https://x.test/api/admin/bigquery-v2/reviews',{headers:{cookie:s.split(';')[0]+'; '+c.split(';')[0],'x-csrf-token':csrf,origin:'https://x.test'}});
 assert.ok(readReviewSession(req,env,Date.UTC(2026,0,1)));assert.ok(csrfValid(req,{csrf}));
 assert.equal(csrfValid(new Request(req.url,{method:'POST',headers:{cookie:req.headers.get('cookie'),'x-csrf-token':csrf,origin:'https://evil.test'}}),{csrf}),false);
 assert.equal(readReviewSession(req,{...env,VERCEL_ENV:'production'},Date.UTC(2026,0,1)),null);
 assert.equal(readReviewSession(req,env,Date.UTC(2026,0,1)+3*60*60*1000),null);
 assert.equal(readReviewSession(new Request(req.url,{headers:{cookie:s.split(';')[0]+'; '+c.split(';')[0].replace(csrf,'wrong')}}),env,Date.UTC(2026,0,1)),null);
 assert.ok(s.includes('HttpOnly')&&s.includes('Secure')&&s.includes('SameSite=Strict'));
 assert.ok(c.includes('Secure')&&c.includes('SameSite=Strict'));
 assert.equal(constantTokenMatch(env.ARCHIVE_ADMIN_TOKEN,env.ARCHIVE_ADMIN_TOKEN),true);
});
test('migration creates separate append-only review and event tables; original catalog untouched',()=>{
 const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../drizzle/0005_bigquery_v2_reviews.sql',import.meta.url),'utf8'));
 const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'bq_v2_review_%'").all().map(x=>x.name).sort();
 assert.deepEqual(tables,['bq_v2_review_events','bq_v2_review_rate_limits','bq_v2_review_state']);
 const state=db.prepare("INSERT INTO bq_v2_review_state VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
 state.run('x','f'.repeat(64),'r','a'.repeat(64),'p','b'.repeat(64),'c'.repeat(64),2,'APPROVED','{}','{}','{}','', 'reviewer','2099-01-01T00:00:00.000Z',1,'2026-01-01');
 db.prepare("INSERT INTO bq_v2_review_events VALUES('e','x',1,'SAVE','{}','reviewer','2026-01-01')").run();assert.throws(()=>db.prepare("UPDATE bq_v2_review_events SET action='REVOKE' WHERE id='e'").run());assert.throws(()=>db.prepare("DELETE FROM bq_v2_review_events WHERE id='e'").run());
 assert.throws(()=>db.prepare("UPDATE bq_v2_review_state SET state='AUTO_APPROVED'").run());
 db.close();
});
test('review routes fail closed when persistent D1 is unavailable',async()=>{
 const saved={...process.env};Object.assign(process.env,env);
 try{const csrf='z'.repeat(43),session=makeReviewSession(env.ARCHIVE_REVIEW_SESSION_SECRET,csrf);const [a,b]=cookieHeaders(session,csrf);const response=await GET(new Request('https://x.test/api/admin/bigquery-v2/reviews',{headers:{cookie:a.split(';')[0]+'; '+b.split(';')[0]}}));assert.equal(response.status,503);assert.match(await response.text(),/영구 검토 저장소/);}finally{for(const k of Object.keys(env))saved[k]===undefined?delete process.env[k]:process.env[k]=saved[k];}
});
test('approval gate requires all reviews, original metadata rights, safe relation, location evidence and expiry',()=>{
 const good={sourceUrl:'https://archive.example/item'},value={checks:Object.fromEntries(['human_review','original_source','rights','place','relation'].map(k=>[k,{status:'VERIFIED'}])),permissions:{metadata:{status:'ALLOWED'}},verifiedLocation:{address:'서울 주소',buildingManagementNumber:'',latitude:null,evidenceUrl:'https://source.example/location'}};const expires=new Date(Date.now()+86400000).toISOString();
 assert.equal(approvalBlock({...good,relationType:'DISTRICT_CONTEXT'},value,expires),null);
 assert.match(approvalBlock({...good,relationType:'UNCERTAIN'},value,expires),/불확실/);
 assert.match(approvalBlock({...good,relationType:'EXACT_SITE'}, {...value,verifiedLocation:{}}, expires),/위치 근거/);
 assert.match(approvalBlock({...good,relationType:'NEARBY'}, {...value,checks:{...value.checks,rights:{status:'PENDING'}}}, expires),/다섯 검토/);
 assert.match(approvalBlock({...good,relationType:'NEARBY'}, {...value,permissions:{metadata:{status:'UNKNOWN'}}}, expires),/metadata 권리/);
 assert.match(approvalBlock({...good,relationType:'NEARBY'},value,new Date(Date.now()-86400000).toISOString()),/만료일/);
});
