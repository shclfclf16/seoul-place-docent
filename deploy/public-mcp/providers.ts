import {assertSeoul, normalizeAddress, ServiceError, type Address} from '../../lib/providers';
export {ServiceError};

type PublicSecrets = {MCP_ADDRESS_SIGNING_SECRET?: string};
const ADDRESS_API = 'https://seoul-place-docent-steel.vercel.app/api/address';
const MAX_QUERY_LENGTH = 100;

function signingKey(secret: string) {
  if (secret.length < 32) throw new ServiceError('KEY_MISSING', '주소 검색 연결을 준비 중입니다.', 503);
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign', 'verify']);
}
function encode(bytes: Uint8Array) {
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''))
    .replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
function decode(value: string) {
  if (!/^[\w-]+$/.test(value)) throw new Error('Invalid token encoding');
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
  return Uint8Array.from(atob(base64 + '='.repeat((4 - base64.length % 4) % 4)), (char) => char.charCodeAt(0));
}
async function signAddress(address: Address, secret: string) {
  const payload = encode(new TextEncoder().encode(JSON.stringify({address, expires: Date.now() + 30 * 60 * 1000})));
  const signature = await crypto.subtle.sign('HMAC', await signingKey(secret), new TextEncoder().encode(payload));
  return payload + '.' + encode(new Uint8Array(signature));
}

/** Uses the existing public address endpoint so JUSO_API_KEY never leaves the website deployment. */
export async function searchAddresses(query: string, page: number, secrets: PublicSecrets) {
  if (query.length < 2 || query.length > MAX_QUERY_LENGTH) throw new ServiceError('INVALID_QUERY', '도로명과 건물번호 또는 지번주소를 2~100자로 입력해 주세요.', 400);
  if (!Number.isInteger(page) || page < 1 || page > 100) throw new ServiceError('INVALID_PAGE', '페이지 값이 올바르지 않습니다.', 400);
  const secret = secrets.MCP_ADDRESS_SIGNING_SECRET;
  if (!secret) throw new ServiceError('KEY_MISSING', '주소 검색 연결을 준비 중입니다.', 503);
  const url = new URL(ADDRESS_API);
  url.searchParams.set('q', query);
  url.searchParams.set('page', String(page));
  let result: {candidates?: Record<string, unknown>[]; total?: number; page?: number; nonSeoulCount?: number};
  try {
    const response = await fetch(url, {headers: {Accept: 'application/json'}, redirect: 'error', signal: AbortSignal.timeout(12000)});
    if (!response.ok) throw new Error('upstream status');
    const body = await response.text();
    if (body.length > 64 * 1024) throw new Error('upstream response too large');
    result = JSON.parse(body);
  } catch {
    throw new ServiceError('ADDRESS_UPSTREAM', '주소 검색 제공기관과 연결되지 않았습니다. 잠시 후 다시 시도해 주세요.', 502);
  }
  const candidates = [];
  for (const raw of Array.isArray(result.candidates) ? result.candidates.slice(0, 10) : []) {
    try {
      const address = normalizeAddress(raw);
      assertSeoul(address);
      candidates.push({...address, token: await signAddress(address, secret)});
    } catch { /* An incomplete or non-Seoul result cannot become a selectable address. */ }
  }
  return {
    candidates,
    total: Number.isSafeInteger(result.total) && Number(result.total) >= 0 ? Number(result.total) : candidates.length,
    page,
    nonSeoulCount: Number.isSafeInteger(result.nonSeoulCount) && Number(result.nonSeoulCount) >= 0 ? Number(result.nonSeoulCount) : 0,
    source: '주소기반산업지원서비스',
    queriedAt: new Date().toISOString(),
  };
}

export async function verifyAddress(token: string, secrets: PublicSecrets): Promise<Address> {
  const secret = secrets.MCP_ADDRESS_SIGNING_SECRET;
  if (!secret) throw new ServiceError('KEY_MISSING', '주소 검색 연결을 준비 중입니다.', 503);
  try {
    if (token.length > 6000) throw new Error('oversized token');
    const [payload, signature, extra] = token.split('.');
    if (!payload || !signature || extra) throw new Error('invalid token shape');
    const valid = await crypto.subtle.verify('HMAC', await signingKey(secret), decode(signature), new TextEncoder().encode(payload));
    if (!valid) throw new Error('invalid signature');
    const body = JSON.parse(new TextDecoder().decode(decode(payload)));
    if (typeof body.expires !== 'number' || body.expires < Date.now() || body.expires > Date.now() + 31 * 60 * 1000) throw new Error('expired token');
    const address = normalizeAddress(body.address);
    assertSeoul(address);
    return address;
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    throw new ServiceError('INVALID_TOKEN', '주소 선택이 만료되었거나 올바르지 않습니다. 다시 검색해 주세요.', 400);
  }
}
