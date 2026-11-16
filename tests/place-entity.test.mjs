import test from 'node:test';
import assert from 'node:assert/strict';
import {identifyPlace,readPlaceProfile} from '../lib/place-entity.ts';

const address={roadAddr:'서울특별시 성동구 마장로42길 16',jibunAddr:'서울특별시 성동구 마장동 784-0',siNm:'서울특별시',sggNm:'성동구',emdNm:'마장동',admCd:'1120010500',bdMgtSn:'1120010500107840000000000',bdNm:'세림아파트',lnbrMnnm:'784',lnbrSlno:'0',mtYn:'0',zipNo:'04752'};

test('place IDs use official identifiers and stay identical across signed-query aliases',async()=>{
 const first=await identifyPlace(address),same=await identifyPlace({...address,roadAddr:'서울 마장로42길 16'}),other=await identifyPlace({...address,lnbrMnnm:'785',bdMgtSn:'1120010500107850000000000'});
 assert.match(first.placeId,/^place:[a-f0-9]{24}$/);assert.equal(first.placeId,same.placeId);assert.notEqual(first.placeId,other.placeId);
 assert.equal(first.identityBasis,'official_building_management_number');assert.equal(first.matchStatus,'confirmed');
});

test('no configured building providers yields honest unavailable sections without network calls',async()=>{
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw new Error('must not fetch without a key');};
 try {
  const entity=await identifyPlace(address),profile=await readPlaceProfile(address,entity,{});
  assert.equal(calls,0);assert.equal(profile.status,'unavailable');assert.equal(profile.matchStatus,'unverified');assert.deepEqual(profile.records,[]);
  assert.ok(profile.limitations.some(line=>line.includes('건축물대장 API 키')));
 } finally {globalThis.fetch=original;}
});

test('building provider failure degrades to neighborhood-compatible unavailable evidence',async()=>{
 const original=globalThis.fetch;globalThis.fetch=async()=>{throw new Error('provider offline');};
 try {
  const entity=await identifyPlace(address),profile=await readPlaceProfile(address,entity,{BUILDING_API_KEY:'fixture'});
  assert.equal(profile.status,'unavailable');assert.equal(profile.matchStatus,'unverified');assert.deepEqual(profile.records,[]);
  assert.ok(profile.limitations.some(line=>line.includes('조회가 실패')));
 } finally {globalThis.fetch=original;}
});

test('exact parcel and road match creates a building fact; multiple candidates stay parcel-scoped',async()=>{
 const original=globalThis.fetch,entity=await identifyPlace(address);let rows=[];
 globalThis.fetch=async url=>{
  assert.equal(new URL(String(url)).hostname,'apis.data.go.kr');
  return Response.json({response:{header:{resultCode:'00'},body:{items:{item:rows},totalCount:rows.length}}});
 };
 const row={sigunguCd:'11200',bjdongCd:'10500',platGbCd:'0',bun:'0784',ji:'0000',mgmBldrgstPk:'registry-1',bldNm:'세림아파트',dongNm:'101동',mainPurpsCdNm:'공동주택',strctCdNm:'철근콘크리트',totArea:'4800',platArea:'1200',grndFlrCnt:'15',ugrndFlrCnt:'1',useAprDay:'19860620',crtnDay:'19860620',newPlatPlc:'서울특별시 성동구 마장로42길 16',platPlc:'서울특별시 성동구 마장동 784'};
 try {
  rows=[row];let profile=await readPlaceProfile(address,entity,{BUILDING_API_KEY:'fixture'});
  assert.equal(profile.status,'confirmed');assert.equal(profile.matchStatus,'confirmed');assert.equal(profile.records[0].scope,'building');assert.equal(profile.records[0].values.사용승인일,'19860620');
  rows=[row,{...row,mgmBldrgstPk:'registry-2',bldNm:'별관'}];profile=await readPlaceProfile(address,entity,{BUILDING_API_KEY:'fixture'});
  assert.equal(profile.status,'ambiguous');assert.equal(profile.matchStatus,'ambiguous');assert.ok(profile.records.every(record=>record.scope==='parcel'));
  assert.ok(profile.limitations.some(line=>line.includes('여러 건')));
 } finally {globalThis.fetch=original;}
});
