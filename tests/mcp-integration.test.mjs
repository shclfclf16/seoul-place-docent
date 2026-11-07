import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {auditedTool,mcpAuditStats} from '../lib/mcp-audit.ts';
import {checkMcpHttp,createMcpLimiter} from '../lib/mcp-http.ts';
import {historyQuestion,AI_SERVICES} from '../lib/user-ai-guide.ts';
import {POST,GET} from '../app/mcp/route.ts';
import {GET as admin} from '../app/api/mcp-admin/route.ts';
import {signAddress} from '../lib/providers.ts';
function sqlite(){const sql=new DatabaseSync(':memory:');return {sql,prepare(query){let args=[];const s={bind(...v){args=v;return s;},async run(){sql.prepare(query).run(...args);return {success:true};},async all(){return {results:sql.prepare(query).all(...args)};},async first(){return sql.prepare(query).get(...args)??null;}};return s;}};}
const req=(body,headers={})=>new Request('http://localhost/mcp',{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream',...headers},body:typeof body==='string'?body:JSON.stringify(body)});
const rpc=(method,params={},id=1)=>({jsonrpc:'2.0',id,method,params});
test('SQLite persisted receipts, safe errors, aggregate counts, P95 and no private payload',async()=>{
  const db=sqlite();try{
    const r=await auditedTool(db,'prepare_place_answer',async()=>({content:[{type:'text',text:JSON.stringify({question:'PRIVATE_QUESTION',address:'PRIVATE_ADDRESS',neighborhood:{records:[{text:'PRIVATE_TEXT'}]}})}]}));
    assert.equal(r._meta.receipt.persisted,true);
    await auditedTool(db,'search_place',async()=>{throw new Error('PRIVATE_KEY');});
    await auditedTool(db,'validate_place_answer',async()=>({content:[{type:'text',text:'{"valid":false}'}]}));
    const rows=db.sql.prepare('SELECT * FROM mcp_request_log').all();assert.equal(rows.length,3);
    assert.equal(JSON.stringify(rows).includes('PRIVATE'),false);assert.equal(rows[0].records,1);
    const stats=await mcpAuditStats(db);assert.equal(stats.totals.total,3);assert.equal(stats.totals.success,2);assert.equal(stats.totals.failure,1);assert.equal(stats.totals.validations,1);assert.equal(stats.errors[0].error_code,'INTERNAL_ERROR');
    assert.equal(stats.p95Ms,Math.max(...rows.map(r=>r.ms)));assert.equal(stats.clientTokens,null);
  }finally{db.sql.close();}
});
test('receipt distinguishes absent or failed storage from persisted evidence',async()=>{
  const run=()=>Promise.resolve({content:[{type:'text',text:'{}'}]});
  const a=await auditedTool(undefined,'search_place',run);assert.equal(a._meta.receipt.persisted,false);
  const b=await auditedTool({prepare(){throw Error('SECRET');}},'search_place',run);assert.equal(b._meta.receipt.persisted,false);assert.notEqual(a._meta.receipt.requestId,b._meta.receipt.requestId);
});
test('HTTP guards: Origin, host, version, Accept and non-identity rate backstop',()=>{
  assert.equal(checkMcpHttp(req(rpc('ping'),{origin:'https://evil.test'})),403);
  assert.equal(checkMcpHttp(req(rpc('ping')),{MCP_ALLOWED_HOSTS:'production.test'}),403);
  assert.equal(checkMcpHttp(req(rpc('ping'),{'mcp-protocol-version':'bad'})),400);
  assert.equal(checkMcpHttp(req(rpc('ping'),{accept:'text/html'})),406);
  const limit=createMcpLimiter(2);assert.equal(limit(60000),true);assert.equal(limit(60001),true);assert.equal(limit(60002),false);assert.equal(limit(120000),true);
});
test('actual HTTP initialization, tools, errors, limits and notification acknowledgement',async()=>{
  const init=await (await POST(req(rpc('initialize',{protocolVersion:'2025-11-25'})))).json();assert.equal(init.result.protocolVersion,'2025-11-25');
  const list=await (await POST(req(rpc('tools/list')))).json();assert.equal(list.result.tools.length,8);
  assert.equal((await POST(req('{'))).status,400);
  assert.equal((await POST(req(' '.repeat(33000)))).status,413);
  assert.equal((await POST(req({jsonrpc:'2.0',method:'notifications/initialized'}))).status,202);
  assert.equal((await GET(new Request('http://localhost/mcp'))).status,405);
  assert.equal((await GET(new Request('http://localhost/mcp',{headers:{origin:'https://evil.test'}}))).status,403);
  assert.equal((await (await POST(req(rpc('tools/call',{name:'missing'})))).json()).error.code,-32602);
});
test('actual MCP evidence calls cannot reach any LLM or network; input failures safe',async()=>{
  const old=globalThis.fetch,oldKey=process.env.JUSO_API_KEY;let calls=0;
  process.env.JUSO_API_KEY='test-only-not-real';globalThis.fetch=async()=>{calls++;throw Error('NETWORK_BLOCKED');};
  try {
    const token=await signAddress({roadAddr:'서울특별시 종로구 사직로 161',jibunAddr:'서울특별시 종로구 세종로 1-1',siNm:'서울특별시',sggNm:'종로구',emdNm:'세종로',admCd:'1111011900',bdMgtSn:'fixture',bdNm:'',lnbrMnnm:'1',lnbrSlno:'1',mtYn:'0',zipNo:'03045'},'test-only-not-real');
    for(const name of ['get_place_history','prepare_place_answer','generate_place_answer']){
      const body=await (await POST(req(rpc('tools/call',{name,arguments:{token}})))).json();assert.notEqual(body.result.isError,true,name);const data=JSON.parse(body.result.content[0].text);assert.ok((data.neighborhood.records??data.neighborhood.scenes).length>0);assert.ok(body.result._meta.receipt.requestId);
    }
    const bad=await (await POST(req(rpc('tools/call',{name:'resolve_photo_location',arguments:{latitude:200,longitude:999}})))).json();assert.equal(bad.result.isError,true);
    const missing=await (await POST(req(rpc('tools/call',{name:'resolve_photo_location',arguments:{}})))).json();assert.equal(JSON.parse(missing.result.content[0].text).status,'needs_location');assert.equal(calls,0);
  }finally{globalThis.fetch=old;if(oldKey===undefined)delete process.env.JUSO_API_KEY;else process.env.JUSO_API_KEY=oldKey;}
});
test('admin rejects forged identity, wrong token and cross-origin; authorized missing DB explicit',async()=>{
  const old=process.env.ARCHIVE_ADMIN_TOKEN;process.env.ARCHIVE_ADMIN_TOKEN='fixture-admin';
  try{
    assert.equal((await admin(new Request('http://localhost/api/mcp-admin',{headers:{'oai-authenticated-user-id':'fake','oai-authenticated-user-email':'owner@test'}}))).status,403);
    assert.equal((await admin(new Request('http://localhost/api/mcp-admin',{headers:{'x-archive-admin':'wrong'}}))).status,403);
    assert.equal((await admin(new Request('http://localhost/api/mcp-admin',{headers:{'x-archive-admin':'fixture-admin',origin:'https://evil.test'}}))).status,403);
    assert.equal((await admin(new Request('http://localhost/api/mcp-admin',{headers:{'x-archive-admin':'fixture-admin'}}))).status,503);
  }finally{if(old===undefined)delete process.env.ARCHIVE_ADMIN_TOKEN;else process.env.ARCHIVE_ADMIN_TOKEN=old;}
});
test('question includes visible address and tool workflow; service links never carry private queries',()=>{
  const q=historyQuestion('서울특별시 성동구 왕십리로 83');assert.ok(q.includes('왕십리로 83'));assert.ok(q.includes('prepare_place_answer'));assert.ok(q.includes('validate_place_answer'));
  assert.ok(AI_SERVICES.every(s=>new URL(s.url).search===''));assert.ok(historyQuestion('').includes('[조회할 서울 주소]'));
});
test('authorized admin API reads actual SQL aggregates and looks up a receipt through mocked D1 transport',async()=>{
  const db=sqlite(),oldFetch=globalThis.fetch;
  const names=['ARCHIVE_ADMIN_TOKEN','CLOUDFLARE_ACCOUNT_ID','CLOUDFLARE_D1_DATABASE_ID','CLOUDFLARE_D1_API_TOKEN'];
  const saved=Object.fromEntries(names.map(n=>[n,process.env[n]]));
  try{
    const r=await auditedTool(db,'search_place',async()=>({content:[{type:'text',text:'{"candidates":[{}]}'}]}));
    for(const name of names)process.env[name]='test-only';
    globalThis.fetch=async(_url,init)=>{const q=JSON.parse(init.body);const statement=db.sql.prepare(q.sql);const results=statement.all(...(q.params??[]));return Response.json({success:true,result:[{success:true,results}]});};
    const request=suffix=>new Request('http://localhost/api/mcp-admin'+suffix,{headers:{'x-archive-admin':'test-only'}});
    const totals=await admin(request(''));assert.equal(totals.status,200);assert.equal((await totals.json()).totals.total,1);
    const lookup=await admin(request('?requestId='+r._meta.receipt.requestId));assert.equal(lookup.status,200);assert.equal((await lookup.json()).receipt.tool,'search_place');
    assert.equal((await admin(request('?requestId='+crypto.randomUUID()))).status,404);
    assert.equal((await admin(request('?requestId=SQL-INJECTION'))).status,400);
  }finally{globalThis.fetch=oldFetch;for(const name of names){if(saved[name]===undefined)delete process.env[name];else process.env[name]=saved[name];}db.sql.close();}
});
