import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveMcpMapAddress} from '../lib/mcp-map-address.ts';
import {verifyAddress} from '../lib/providers.ts';
const endpoint='https://seoul-place-history.xeonire.chatgpt.site/api/map-address';
const address={roadAddr:'서울특별시 종로구 사직로 161',jibunAddr:'서울특별시 종로구 세종로 1-1',siNm:'서울특별시',sggNm:'종로구',emdNm:'세종로',admCd:'1111011900',bdMgtSn:'fixture',bdNm:'경복궁',lnbrMnnm:'1',lnbrSlno:'1',mtYn:'0',zipNo:'03045'};
test('existing service fallback verifies coordinates and reissues local JUSO token',async()=>{
 const original=globalThis.fetch;const calls=[];
 globalThis.fetch=async(url,options)=>{const u=new URL(url);calls.push(u.hostname);
  if(u.hostname==='seoul-place-history.xeonire.chatgpt.site'){assert.equal(options.redirect,'manual');return Response.json({location:{x:126.97,y:37.58,precision:'parcel',address},candidates:[{...address,token:'must-not-trust-upstream-token'}]});}
  assert.equal(u.hostname,'business.juso.go.kr');return Response.json({results:{common:{errorCode:'0',totalCount:'1'},juso:[address]}});
 };
 try{const secrets={JUSO_API_KEY:'local-test-key',MCP_MAP_ADDRESS_URL:endpoint};const r=await resolveMcpMapAddress(126.97,37.58,secrets);
  assert.equal(r.candidates.length,1);assert.deepEqual(await verifyAddress(r.candidates[0].token,secrets),address);assert.equal(r.locationProvider,'existing_site_address_service');
  assert.deepEqual(calls,['seoul-place-history.xeonire.chatgpt.site','business.juso.go.kr']);
 }finally{globalThis.fetch=original;}
});
test('fallback refuses alternate endpoints, redirects and coordinate mismatch',async()=>{
 const original=globalThis.fetch;
 try{
  await assert.rejects(resolveMcpMapAddress(126.97,37.58,{MCP_MAP_ADDRESS_URL:'https://evil.test'}),/설정/);
  globalThis.fetch=async()=>new Response(null,{status:302,headers:{location:'https://evil.test'}});
  await assert.rejects(resolveMcpMapAddress(126.97,37.58,{MCP_MAP_ADDRESS_URL:endpoint}),/연결/);
  globalThis.fetch=async()=>Response.json({location:{x:127,y:37.58,precision:'parcel',address}});
  await assert.rejects(resolveMcpMapAddress(126.97,37.58,{MCP_MAP_ADDRESS_URL:endpoint}),/연결/);
 }finally{globalThis.fetch=original;}
});
