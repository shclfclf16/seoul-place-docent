import test from 'node:test';
import assert from 'node:assert/strict';
import {searchAddresses, verifyAddress} from '../deploy/public-mcp/providers.ts';

const address = {
  roadAddr: '서울특별시 성동구 마장로42길 16 (마장동, 세림아파트)',
  jibunAddr: '서울특별시 성동구 마장동 784 세림아파트',
  siNm: '서울특별시', sggNm: '성동구', emdNm: '마장동', admCd: '1120010500',
  bdMgtSn: '1120010500107840000', bdNm: '세림아파트', lnbrMnnm: '0784', lnbrSlno: '0000', mtYn: '0', zipNo: '04705',
};

test('public address proxy signs returned candidates with a separate MCP secret', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    assert.equal(url.origin + url.pathname, 'https://seoul-place-docent-steel.vercel.app/api/address');
    assert.equal(url.searchParams.get('q'), '마장로42길 16');
    return Response.json({candidates: [{...address, token: 'upstream-token-is-ignored'}], total: 1, nonSeoulCount: 0});
  };
  try {
    const secrets = {MCP_ADDRESS_SIGNING_SECRET: 'test-secret-value-longer-than-thirty-two-characters'};
    const result = await searchAddresses('마장로42길 16', 1, secrets);
    assert.equal(result.candidates.length, 1);
    assert.notEqual(result.candidates[0].token, 'upstream-token-is-ignored');
    assert.deepEqual(await verifyAddress(result.candidates[0].token, secrets), address);
    await assert.rejects(() => verifyAddress(result.candidates[0].token, {MCP_ADDRESS_SIGNING_SECRET: 'another-long-secret-value-longer-than-thirty-two'}), {code: 'INVALID_TOKEN'});
  } finally { globalThis.fetch = original; }
});

test('public address proxy rejects invalid search input before network access', async () => {
  await assert.rejects(() => searchAddresses('x', 1, {MCP_ADDRESS_SIGNING_SECRET: 'test-secret-value-longer-than-thirty-two-characters'}), {code: 'INVALID_QUERY'});
  await assert.rejects(() => searchAddresses('서울', 0, {MCP_ADDRESS_SIGNING_SECRET: 'test-secret-value-longer-than-thirty-two-characters'}), {code: 'INVALID_PAGE'});
});
