import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import handler from '../.vercel/output/functions/mcp.func/index.mjs';
test('Vercel Node HTTP adapter serves real unauthenticated MCP HTTP and health requests',async()=>{
 const server=createServer((req,res)=>{handler(req,res).catch(error=>{res.statusCode=500;res.end(String(error));});});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${server.address().port}`;const before=process.env.MCP_ADDRESS_SIGNING_SECRET;
 try{
  process.env.MCP_ADDRESS_SIGNING_SECRET='test-address-signing-secret-long-enough-to-use';
  const response=await fetch(base+'/mcp',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25'}})});
  assert.equal(response.status,200);assert.equal(response.headers.has('www-authenticate'),false);assert.equal((await response.json()).result.protocolVersion,'2025-11-25');
  const ready=await fetch(base+'/health');assert.equal(ready.status,200);assert.equal((await ready.json()).addressConfigured,true);
  delete process.env.MCP_ADDRESS_SIGNING_SECRET;
  for(const path of ['/health','/mcp?__route=health']){const r=await fetch(base+path);assert.equal(r.status,503);assert.equal((await r.json()).addressConfigured,false);}
  assert.equal((await fetch(base+'/api/admin/mcp-stats')).status,404);
 }finally{if(before===undefined)delete process.env.MCP_ADDRESS_SIGNING_SECRET;else process.env.MCP_ADDRESS_SIGNING_SECRET=before;await new Promise(resolve=>server.close(resolve));}
});
