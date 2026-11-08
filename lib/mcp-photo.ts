import {inspectPhonePhotoLocation, MAX_PHOTO_BYTES} from './photo-gps';
import {ServiceError} from './providers';

/** Only host-issued temporary file URLs; no arbitrary URL fetch or redirects. */
export function trustedPhotoUrl(value:string):URL {
 let url:URL;
 try {url=new URL(value);} catch {throw new ServiceError('PHOTO_URL','원본 파일을 다시 첨부해 주세요.',400);}
 const host=url.hostname.toLowerCase();
 const allowed=host==='files.oaiusercontent.com'||host.endsWith('.oaiusercontent.com')||
  /^oais(?:dmnt|dsor)pr[a-z0-9]+\.blob\.core\.windows\.net$/.test(host)||
  /^oaisdmntpr[a-z0-9-]*aws\.s3\.[a-z0-9-]+\.amazonaws\.com$/.test(host);
 if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash||!allowed)
  throw new ServiceError('PHOTO_URL','지원하는 AI 파일 첨부 URL이 아닙니다. 웹에서 원본 사진을 선택하거나 실제 GPS를 공유해 주세요.',400);
 return url;
}

export async function readAttachedPhoto(downloadUrl:string){
 const url=trustedPhotoUrl(downloadUrl);
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),15000);
 try {
  const response=await fetch(url,{redirect:'manual',signal:controller.signal,headers:{Accept:'image/jpeg, image/heic, image/heif, application/octet-stream'}});
  if(!response.ok)throw new ServiceError('PHOTO_DOWNLOAD','사진 원본을 가져오지 못했습니다. 만료된 첨부는 다시 올려 주세요.',400);
  if(Number(response.headers.get('content-length'))>MAX_PHOTO_BYTES){await response.body?.cancel();throw new ServiceError('PHOTO_SIZE','20MiB 이하의 원본 사진을 선택해 주세요.',413);}
  const chunks:Uint8Array[]=[];let size=0;const reader=response.body?.getReader();
  if(reader)try {while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;
   if(size>MAX_PHOTO_BYTES){await reader.cancel();throw new ServiceError('PHOTO_SIZE','20MiB 이하의 원본 사진을 선택해 주세요.',413);}chunks.push(part.value);
  }}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  const location=await inspectPhonePhotoLocation(bytes.buffer);
  // Only the camera timestamp is returned. Never send EXIF serial numbers, names or comments.
  let capturedAt:string|null=null;let utcOffset:string|null=null;
  if(location.status==='ready')try {
   const {default:exifr}=await import('exifr');
   const tags=await exifr.parse(bytes,{pick:['DateTimeOriginal','OffsetTimeOriginal'],reviveValues:false});
   if(typeof tags?.DateTimeOriginal==='string'&&/^\d{4}:\d{2}:\d{2} \d{2}:\d{2}:\d{2}$/.test(tags.DateTimeOriginal))capturedAt=tags.DateTimeOriginal;
   if(typeof tags?.OffsetTimeOriginal==='string'&&/^[+-]\d{2}:\d{2}$/.test(tags.OffsetTimeOriginal))utcOffset=tags.OffsetTimeOriginal;
  }catch{/* A missing timestamp does not invalidate GPS. */}
  return {location,capturedAt,utcOffset};
 }catch(error){
  if(error instanceof ServiceError)throw error;
  throw new ServiceError('PHOTO_DOWNLOAD','사진 원본을 읽지 못했습니다. 원본 파일을 다시 첨부하거나 웹에서 위치를 확인해 주세요.',400);
 }finally{clearTimeout(timer);}
}
