import {buildings, type Address, type Building, type Secrets as ProviderSecrets} from './providers';
import {closedBuildings, type ClosedBuilding, type PlaceContextSecrets} from './place-context';

export type PlaceEntity = {
  placeId: string;
  name: string | null;
  address: string;
  lotAddress: string;
  entityType: 'building' | 'parcel';
  matchStatus: 'confirmed';
  identityBasis: 'official_building_management_number' | 'official_parcel';
  source: {institution: string; url: string};
};

export type PlaceRecord = {
  id: string;
  subjectId: string;
  title: string;
  claim: string;
  scope: 'building' | 'parcel';
  spatialMatch: 'exact' | 'associated';
  verification: 'source_verified';
  observedAt: string;
  source: {id: string; institution: string; url: string};
  values: Record<string, string>;
};

export type PlaceProfile = {
  status: 'confirmed' | 'ambiguous' | 'partial' | 'unavailable';
  matchStatus: 'confirmed' | 'ambiguous' | 'unverified';
  records: PlaceRecord[];
  sources: Array<{id: string; institution: string; url: string; retrievedAt: string}>;
  limitations: string[];
};

export type PlaceEntitySecrets = ProviderSecrets & PlaceContextSecrets;

function hex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
}

/** Stable identity derived only from official JUSO building/parcel identifiers. */
export async function identifyPlace(address: Address): Promise<PlaceEntity> {
  const hasBuildingNumber = /^\d{10,25}$/.test(address.bdMgtSn);
  const parcel = `${address.admCd}:${address.mtYn}:${address.lnbrMnnm.padStart(4, '0')}:${(address.lnbrSlno || '0').padStart(4, '0')}`;
  const basis = hasBuildingNumber ? `juso-building:${address.bdMgtSn}` : `juso-parcel:${parcel}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(basis));
  return {
    placeId: `place:${hex(digest).slice(0, 24)}`,
    name: address.bdNm || null,
    address: address.roadAddr || address.jibunAddr,
    lotAddress: address.jibunAddr,
    entityType: hasBuildingNumber ? 'building' : 'parcel',
    matchStatus: 'confirmed',
    identityBasis: hasBuildingNumber ? 'official_building_management_number' : 'official_parcel',
    source: {institution: '주소기반산업지원서비스', url: 'https://business.juso.go.kr/'},
  };
}

function buildingValues(row: Building) {
  return {
    건물명: row.name || '확인되지 않음',
    도로명주소: row.roadAddr || '확인되지 않음',
    지번주소: row.lotAddr || '확인되지 않음',
    주용도: row.use || '확인되지 않음',
    구조: row.structure || '확인되지 않음',
    대지면적_m2: row.landArea || '확인되지 않음',
    연면적_m2: row.area || '확인되지 않음',
    지상층수: row.above || '확인되지 않음',
    지하층수: row.below || '확인되지 않음',
    사용승인일: row.approved || '확인되지 않음',
    대장생성일: row.created || '확인되지 않음',
  };
}

function closedValues(row: ClosedBuilding) {
  return {
    과거건물명: row.name || '확인되지 않음',
    도로명주소: row.roadAddress || '확인되지 않음',
    지번주소: row.lotAddress || '확인되지 않음',
    주용도: row.use || '확인되지 않음',
    연면적_m2: row.area || '확인되지 않음',
    지상층수: row.above || '확인되지 않음',
    지하층수: row.below || '확인되지 않음',
    사용승인일: row.approved || '확인되지 않음',
    폐쇄구분: row.closureType || '확인되지 않음',
  };
}

function record(input: {
  id: string; placeId: string; title: string; scope: PlaceRecord['scope']; values: Record<string, string>;
  observedAt: string; sourceId: string; sourceName: string; sourceUrl: string;
}): PlaceRecord {
  const details = Object.entries(input.values).filter(([, value]) => value !== '확인되지 않음').map(([key, value]) => `${key.replaceAll('_m2', ' (㎡)')}: ${value}`).join(' · ');
  return {
    id: input.id,
    subjectId: input.placeId,
    title: input.title,
    claim: details || input.title,
    scope: input.scope,
    spatialMatch: input.scope === 'building' ? 'exact' : 'associated',
    verification: 'source_verified',
    observedAt: input.observedAt,
    source: {id: input.sourceId, institution: input.sourceName, url: input.sourceUrl},
    values: input.values,
  };
}

/**
 * Reads building sources independently. A failed or unconfigured source is
 * represented as a limitation and never blocks neighborhood evidence.
 */
export async function readPlaceProfile(address: Address, place: PlaceEntity, secrets: PlaceEntitySecrets): Promise<PlaceProfile> {
  const currentTask = secrets.BUILDING_API_KEY
    ? buildings(address, secrets).then(data => ({kind: 'current' as const, data}))
    : Promise.resolve({kind: 'current' as const, unavailable: '건축물대장 API 키가 설정되지 않았습니다.'});
  const closedTask = secrets.CLOSED_BUILDING_API_KEY
    ? closedBuildings(address, secrets).then(data => ({kind: 'closed' as const, data}))
    : Promise.resolve({kind: 'closed' as const, unavailable: '폐쇄말소대장 API 키가 설정되지 않았습니다.'});
  const [currentResult, closedResult] = await Promise.allSettled([currentTask, closedTask]);
  const records: PlaceRecord[] = [];
  const sources: PlaceProfile['sources'] = [];
  const limitations: string[] = [];
  let ambiguous = false;
  let anyAvailable = false;

  if (currentResult.status === 'fulfilled' && 'data' in currentResult.value) {
    anyAvailable = true;
    const data = currentResult.value.data;
    sources.push({id: 'building-register', institution: '국토교통부 건축물대장', url: data.sourceUrl, retrievedAt: data.queriedAt});
    ambiguous ||= data.items.length > 1;
    for (const row of data.items) records.push(record({
      id: `building:${row.id}`,
      placeId: place.placeId,
      title: row.name || '건축물대장 표제부',
      scope: data.items.length === 1 ? 'building' : 'parcel',
      values: buildingValues(row),
      observedAt: data.queriedAt,
      sourceId: 'building-register',
      sourceName: '국토교통부 건축물대장',
      sourceUrl: data.sourceUrl,
    }));
    for (const row of data.parcelCandidates.slice(0, 10)) records.push(record({
      id: `parcel-building:${row.id}`,
      placeId: place.placeId,
      title: row.name || '같은 지번의 건축물대장 후보',
      scope: 'parcel',
      values: buildingValues(row),
      observedAt: data.queriedAt,
      sourceId: 'building-register',
      sourceName: '국토교통부 건축물대장',
      sourceUrl: data.sourceUrl,
    }));
    if (data.items.length > 1) limitations.push('같은 주소·필지에 건축물대장 후보가 여러 건 있어 개별 동·건물은 특정하지 않았습니다.');
    if (!data.items.length && data.parcelCandidates.length) limitations.push('같은 지번의 대장 후보는 있으나 도로명주소 일치가 확인되지 않아 필지 참고자료로만 분류했습니다.');
    if (!data.items.length && !data.parcelCandidates.length) limitations.push('현재 주소와 일치하는 건축물대장 자료를 확인하지 못했습니다.');
  } else if (currentResult.status === 'rejected') {
    limitations.push('건축물대장 API 조회가 실패했습니다.');
  } else if ('unavailable' in currentResult.value) {
    limitations.push(currentResult.value.unavailable);
  }

  if (closedResult.status === 'fulfilled' && 'data' in closedResult.value) {
    anyAvailable = true;
    const data = closedResult.value.data;
    sources.push({id: 'closed-building-register', institution: '국토교통부 폐쇄말소대장', url: data.sourceUrl, retrievedAt: data.queriedAt});
    for (const row of data.items.slice(0, 10)) records.push(record({
      id: `closed-building:${row.id}`,
      placeId: place.placeId,
      title: row.name || '폐쇄말소대장 기록',
      scope: 'parcel',
      values: closedValues(row),
      observedAt: data.queriedAt,
      sourceId: 'closed-building-register',
      sourceName: '국토교통부 폐쇄말소대장',
      sourceUrl: data.sourceUrl,
    }));
    if (data.items.length) limitations.push('폐쇄말소대장 기록은 동일 필지의 과거 건축물 자료입니다. 현재 건물과 같은 건물이라고 단정하지 않았습니다.');
  } else if (closedResult.status === 'rejected') {
    limitations.push('폐쇄말소대장 API 조회가 실패했습니다.');
  } else if ('unavailable' in closedResult.value) {
    limitations.push(closedResult.value.unavailable);
  }

  const currentDirect = records.filter(item => item.id.startsWith('building:') && item.scope === 'building');
  const status: PlaceProfile['status'] = ambiguous ? 'ambiguous' : currentDirect.length ? 'confirmed' : records.length ? 'partial' : anyAvailable ? 'partial' : 'unavailable';
  return {
    status,
    matchStatus: currentDirect.length === 1 ? 'confirmed' : ambiguous ? 'ambiguous' : 'unverified',
    records,
    sources,
    limitations,
  };
}
