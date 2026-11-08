import test from 'node:test';
import assert from 'node:assert/strict';
import {signAddress} from '../lib/providers.ts';
import {POST} from '../app/api/docent/packet/route.ts';

process.env.JUSO_API_KEY ||= 'fixture-packet-signing-key';
const request = body => new Request('https://example.test/api/docent/packet', {
  method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),
});
test('packet rejects invalid tokens and bodies without treating an upload as a location', async () => {
  assert.equal((await POST(request({token:'broken'}))).status,400);
  assert.equal((await POST(request({latitude:37.5,longitude:127}))).status,400);
  assert.equal((await POST(request({token:'x'.repeat(8100)}))).status,413);
  const malformed = new Request('https://example.test/api/docent/packet', {
    method:'POST', headers:{'Content-Type':'application/json'},body:'{',
  });
  assert.equal((await POST(malformed)).status,400);
});
test('a signed fixture address returns real catalogue evidence and never calls a model or external URL', async () => {
  const previousKey=process.env.JUSO_API_KEY;
  const originalFetch=globalThis.fetch;
  process.env.JUSO_API_KEY='test-photo-docent-signing-key';
  let requests=0;
  globalThis.fetch=async()=>{requests++;throw new Error('No external calls allowed');};
  try {
    const address={roadAddr:'서울특별시 성동구 테스트로 1',jibunAddr:'서울특별시 성동구 마장동 1',
      siNm:'서울특별시',sggNm:'성동구',emdNm:'마장동',admCd:'1120010500',
      bdMgtSn:'fixture',bdNm:'테스트 건물',lnbrMnnm:'1',lnbrSlno:'0',mtYn:'0',zipNo:'00000'};
    const token=await signAddress(address,process.env.JUSO_API_KEY);
    const response=await POST(request({token}));
    assert.equal(response.status,200);
    assert.equal(response.headers.get('cache-control'),'no-store');
    const packet=await response.json();
    assert.equal(packet.generation.serverAiCalls,0);
    assert.equal(packet.place.status,'unverified');
    assert.ok(packet.media.videos.length>0);
    assert.ok(packet.media.videos.length<=6&&packet.media.photos.length<=6);
    assert.ok(packet.media.videos.every(v=>v.detailUrl.includes('dataset=combined')));
    for(const video of packet.media.videos) {
      assert.ok(video.segments.every(s=>s.verifiedTime&&s.validTime&&s.start>=0));
      assert.ok(['legal_dong_candidate','place_candidate','district_background','seoul_background'].includes(video.relation));
    }
    assert.equal(requests,0);
    assert.equal(JSON.stringify(packet).includes(token),false);
  } finally {
    globalThis.fetch=originalFetch;
    if(previousKey===undefined) delete process.env.JUSO_API_KEY;
    else process.env.JUSO_API_KEY=previousKey;
  }
});
