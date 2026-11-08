import {mapAddress,matchMapCandidates,validateMapPoint,type MapLocation} from './map-address';
import {normalizeAddress,searchAddresses,ServiceError,type Secrets} from './providers';

/** Reuse our existing public address service without copying its provider credential. */
export async function resolveMcpMapAddress(x:number,y:number,secrets:Secrets){
 validateMapPoint(x,y);
 if(secrets.KAKAO_REST_API_KEY||!secrets.MCP_MAP_ADDRESS_URL)return mapAddress(x,y,secrets);
 const endpoint='https://seoul-place-history.xeonire.chatgpt.site/api/map-address';
 if(secrets.MCP_MAP_ADDRESS_URL!==endpoint)throw new ServiceError('MAP_CONFIG','좌표 변환 연결 설정을 확인해야 합니다.',503);
 const url=new URL(endpoint);url.search=new URLSearchParams({x:String(x),y:String(y)}).toString();
 let location:MapLocation;
 try{
  const response=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error();
  const body=await response.json() as {location?:MapLocation};const value=body.location;
  if(!value||value.x!==x||value.y!==y||!['parcel','dong'].includes(value.precision)||!value.address)throw Error();
  const address=normalizeAddress(value.address as unknown as Record<string,unknown>);
  if(address.siNm!=='서울특별시'||!/^11\d{8}$/.test(address.admCd)||!address.sggNm||!address.emdNm)throw Error();
  if(value.precision==='parcel'&&(!/^\d{1,4}$/.test(address.lnbrMnnm)||!/^\d{0,4}$/.test(address.lnbrSlno)||!['0','1'].includes(address.mtYn)))throw Error();
  location={x,y,precision:value.precision,address,administrativeDong:typeof value.administrativeDong==='string'?value.administrativeDong:''};
 }catch{throw new ServiceError('MAP_UPSTREAM','기존 주소 변환 서비스에 연결하지 못했습니다. 잠시 후 재시도하거나 주소를 입력해 주세요.',502);}
 // Never reuse the other server's signed token. Re-query JUSO and issue our own.
 const found=location.precision==='parcel'?await searchAddresses(location.address.roadAddr||location.address.jibunAddr,1,secrets):{candidates:[]};
 const candidates=matchMapCandidates(found.candidates,location);
 return {location,candidates,message:candidates.length?'촬영 지점의 주소 후보를 확인했습니다.':'촬영 지점의 동네를 확인했습니다. 건물 주소는 직접 입력해 주세요.',locationProvider:'existing_site_address_service'};
}
