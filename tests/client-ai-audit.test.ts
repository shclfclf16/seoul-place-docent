import {test} from 'node:test';
import assert from 'node:assert/strict';
import {POST} from '../app/mcp/route';
import {POST as summary} from '../app/api/ai-summary/route';
import {POST as narration} from '../app/api/docent/narration/route';
import {translateScenes} from '../lib/docent-translation';
import {signAddress} from '../lib/providers';

test('real MCP route, five signed Seoul locations, all network denied: no model keys or requests',async()=>{
 const original=globalThis.fetch,old=process.env.JUSO_API_KEY;
 process.env.JUSO_API_KEY='audit-signature-key';
 let calls=0;globalThis.fetch=async()=>{calls++;throw Error('Outbound network denied by audit');};
 const rpc=async(method:string,params:any={}):Promise<any>=>await(await POST(new Request('http://localhost/mcp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})}))).json();
 const call=async(name:string,args:any)=>rpc('tools/call',{name,arguments:args});
 try {
  assert.ok((await rpc('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'audit',version:'1'}})).result);
  assert.equal((await rpc('tools/list')).result.tools.length,8);
  for(const [gu,dong,road] of [['종로구','세종로','사직로 161'],['성동구','성수동1가','왕십리로 83'],['강북구','우이동','삼양로173길 7'],['종로구','가회동','북촌로 53'],['마포구','서교동','양화로 160']]){
   const token=await signAddress({roadAddr:road,jibunAddr:road,siNm:'서울특별시',sggNm:gu,emdNm:dong,admCd:'1111010100',bdMgtSn:'audit-fixture',bdNm:'',lnbrMnnm:'1',lnbrSlno:'0',mtYn:'0',zipNo:''},process.env.JUSO_API_KEY);
   for(const name of ['get_place_history','prepare_place_answer','generate_place_answer']){
    const response=await call(name,{token});assert.equal(response.result.isError,undefined,JSON.stringify(response));
    const data=JSON.parse(response.result.content[0].text);assert.ok(data.neighborhood);assert.equal(data.place.status,'unverified');
   }
  }
  assert.equal(JSON.parse((await call('resolve_photo_location',{})).result.content[0].text).status,'needs_location');
  assert.equal(summary().status,410);assert.equal(narration().status,410);
  assert.deepEqual(await translateScenes([{id:'audit',title:'서울',text:'서울 기록'} as any],{OPENAI_API_KEY:'unused-test-key'}),[]);
  assert.equal(calls,0);
 }finally{globalThis.fetch=original;if(old===undefined)delete process.env.JUSO_API_KEY;else process.env.JUSO_API_KEY=old;}
});
