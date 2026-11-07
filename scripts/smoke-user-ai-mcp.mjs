// Read-only local HTTP smoke test. No address, secret or paid model request.
const url=process.argv[2]||'http://127.0.0.1:5180/mcp';
const target=new URL(url);
if(!['127.0.0.1','localhost','[::1]'].includes(target.hostname))throw Error('This smoke test is restricted to localhost.');
let id=0;
async function call(method,params={}){
  const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2025-11-25'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})});
  if(!response.ok)throw Error('HTTP '+response.status);
  const data=await response.json();if(data.error)throw Error('JSON-RPC '+data.error.code);return data.result;
}
const init=await call('initialize',{protocolVersion:'2025-11-25',clientInfo:{name:'seoul-local-smoke',version:'1'},capabilities:{}});
console.log('initialize:',init.protocolVersion);
const list=await call('tools/list');console.log('tools/list:',list.tools.map(t=>t.name).join(', '));
const result=await call('tools/call',{name:'resolve_photo_location',arguments:{}});
if(result.isError)throw Error('Tool failed');
console.log('tools/call:',JSON.parse(result.content[0].text).status,'receipt:',Boolean(result._meta?.receipt?.requestId),'persisted:',result._meta?.receipt?.persisted);
