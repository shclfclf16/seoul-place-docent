import exifr from 'exifr';

export type PhotoGpsInspection = {status:'ok';format:'jpeg'|'heic'|'png';exifPresent:boolean;gpsPresent:true;source:'exif'|'xmp';point:{x:number;y:number}} | {status:'gps_missing'|'exif_corrupt'|'invalid_coordinates'|'format_mismatch'|'unsupported_format';format:string;exifPresent:boolean;gpsPresent:boolean};

function xmpCoordinate(value:unknown,reference:unknown,axis:'latitude'|'longitude'){
 const ref=typeof reference==='string'?reference.trim().toUpperCase():'';
 const validRefs=axis==='latitude'?['N','S']:['E','W'];
 if(ref&&!validRefs.includes(ref))return null;
 let degrees:number,minutes=0,seconds=0,direction=ref;
 if(typeof value==='number')degrees=value;
 else if(typeof value==='string'){
  const match=value.trim().match(/^([+-]?\d+(?:\.\d+)?)(?:(?:\s*,\s*|\s+)(\d+(?:\.\d+)?))?(?:(?:\s*,\s*|\s+)(\d+(?:\.\d+)?))?\s*([NSEW])?$/i);
  if(!match)return null;
  degrees=Number(match[1]);minutes=match[2]===undefined?0:Number(match[2]);seconds=match[3]===undefined?0:Number(match[3]);
  if(match[4]){const suffix=match[4].toUpperCase();if(!validRefs.includes(suffix)||direction&&direction!==suffix)return null;direction=suffix;}
  if((match[2]!==undefined||match[3]!==undefined)&&!direction)return null;
 }else return null;
 if(!Number.isFinite(degrees)||!Number.isFinite(minutes)||!Number.isFinite(seconds)||minutes>=60||seconds>=60)return null;
 const magnitude=Math.abs(degrees)+minutes/60+seconds/3600;
 return direction?(direction==='S'||direction==='W'?-magnitude:magnitude):degrees;
}

/** Inspect real file content and read GPS in the browser. Never uploads or stores image bytes. */
export async function inspectPhotoGps(file:Pick<File,'name'|'type'|'arrayBuffer'>):Promise<PhotoGpsInspection>{
 const b=new Uint8Array(await file.arrayBuffer());const ascii=(a:number,z:number)=>String.fromCharCode(...b.slice(a,z));let format:string='unknown';
 if(b.length>=3&&b[0]===255&&b[1]===216&&b[2]===255)format='jpeg';
 else if(b.length>=12&&ascii(4,8)==='ftyp'){const brand=ascii(8,12);if(['heic','heix','hevc','hevx','mif1','msf1'].includes(brand))format='heic';}
 else if(b.length>=8&&[137,80,78,71,13,10,26,10].every((v,i)=>b[i]===v))format='png';
 const ext=file.name.split('.').pop()?.toLowerCase()||'';const declared=file.type.toLowerCase();const extensionMismatch=(format==='jpeg'&&!['jpg','jpeg'].includes(ext))||(format==='heic'&&!['heic','heif'].includes(ext))||(format==='png'&&ext!=='png');const mimeMismatch=!!declared&&!((format==='jpeg'&&declared==='image/jpeg')||(format==='heic'&&['image/heic','image/heif','image/heic-sequence','image/heif-sequence','application/octet-stream'].includes(declared))||(format==='png'&&declared==='image/png'));
 if(format==='unknown')return {status:'unsupported_format',format,exifPresent:false,gpsPresent:false};
 if(extensionMismatch||mimeMismatch)return {status:'format_mismatch',format,exifPresent:false,gpsPresent:false};
 if(format==='png')return {status:'gps_missing',format,exifPresent:false,gpsPresent:false};
 if(format==='jpeg'){
  const buffer=b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);
  const point=readPhotoGps(buffer);
  if(point){
   if(point.x===0&&point.y===0)return {status:'invalid_coordinates',format:'jpeg',exifPresent:true,gpsPresent:true};
   return {status:'ok',format:'jpeg',exifPresent:true,gpsPresent:true,source:'exif',point};
  }
 }
 try{
  const tags=await exifr.parse(b,{tiff:true,exif:true,gps:true,xmp:false,icc:false,iptc:false});
  const exifPresent=Boolean(tags&&Object.keys(tags).some(key=>key!=='errors'));
  const gps=await exifr.gps(b);
  if(gps||tags?.GPSLatitude||tags?.GPSLongitude){
   const {latitude,longitude}=gps||{};
   if(typeof latitude!=='number'||typeof longitude!=='number'||!Number.isFinite(latitude)||!Number.isFinite(longitude)||Math.abs(latitude)>90||Math.abs(longitude)>180||(latitude===0&&longitude===0))return {status:'invalid_coordinates',format,exifPresent:true,gpsPresent:true};
   return {status:'ok',format:format as 'jpeg'|'heic',exifPresent:true,gpsPresent:true,source:'exif',point:{x:longitude,y:latitude}};
  }
  const xmp=await exifr.parse(b,{tiff:false,exif:false,gps:false,xmp:true,icc:false,iptc:false});
  if(!xmp?.GPSLatitude&&!xmp?.GPSLongitude)return {status:'gps_missing',format,exifPresent,gpsPresent:false};
  const latitude=xmpCoordinate(xmp.GPSLatitude,xmp.GPSLatitudeRef,'latitude');
  const longitude=xmpCoordinate(xmp.GPSLongitude,xmp.GPSLongitudeRef,'longitude');
  if(typeof latitude!=='number'||typeof longitude!=='number'||!Number.isFinite(latitude)||!Number.isFinite(longitude)||Math.abs(latitude)>90||Math.abs(longitude)>180||(latitude===0&&longitude===0))return {status:'invalid_coordinates',format,exifPresent,gpsPresent:true};
  return {status:'ok',format:format as 'jpeg'|'heic',exifPresent,gpsPresent:true,source:'xmp',point:{x:longitude,y:latitude}};
 }catch{return {status:'exif_corrupt',format,exifPresent:true,gpsPresent:false};}
}

/** Legacy strict JPEG GPS reader retained for existing callers. */
export function readPhotoGps(buffer:ArrayBuffer):{x:number;y:number}|null{
 try{
  const v=new DataView(buffer);if(v.byteLength<4||v.getUint16(0)!==0xffd8)return null;
  let pos=2;
  while(pos+4<=v.byteLength){if(v.getUint8(pos)!==255)return null;const marker=v.getUint8(pos+1);if(marker===0xda||marker===0xd9)break;const size=v.getUint16(pos+2);if(size<2||pos+2+size>v.byteLength)return null;
   if(marker===0xe1&&size>=16&&v.getUint32(pos+4)===0x45786966&&v.getUint16(pos+8)===0){
    const start=pos+10,end=pos+2+size;const little=v.getUint16(start)===0x4949;if(!little&&v.getUint16(start)!==0x4d4d)return null;
    const u16=(p:number)=>{if(p<start||p+2>end)throw Error();return v.getUint16(p,little);};const u32=(p:number)=>{if(p<start||p+4>end)throw Error();return v.getUint32(p,little);};if(u16(start+2)!==42)return null;
    const ifd=start+u32(start+4),count=u16(ifd);if(count>1024)return null;let gps=0;
    for(let i=0;i<count;i++){const p=ifd+2+i*12;if(u16(p)===0x8825&&u16(p+2)===4&&u32(p+4)===1)gps=start+u32(p+8);}
    if(!gps){pos+=2+size;continue;}const n=u16(gps);if(n>64)return null;let lat:number[]|undefined,lon:number[]|undefined,ns='',ew='';
    for(let i=0;i<n;i++){const p=gps+2+i*12,tag=u16(p),type=u16(p+2),cnt=u32(p+4);if([1,3].includes(tag)&&type===2&&cnt===2){const char=String.fromCharCode(v.getUint8(p+8));if(tag===1)ns=char;else ew=char;}
     if([2,4].includes(tag)&&type===5&&cnt===3){const at=start+u32(p+8),a=[];for(let j=0;j<3;j++){const denominator=u32(at+j*8+4);if(!denominator)return null;a.push(u32(at+j*8)/denominator);}if(tag===2)lat=a;else lon=a;}}
    if(!lat||!lon||!['N','S'].includes(ns)||!['E','W'].includes(ew)||lat[0]>90||lon[0]>180||lat[1]>=60||lat[2]>=60||lon[1]>=60||lon[2]>=60)return null;
    const y=(lat[0]+lat[1]/60+lat[2]/3600)*(ns==='S'?-1:1),x=(lon[0]+lon[1]/60+lon[2]/3600)*(ew==='W'?-1:1);
    return Number.isFinite(x)&&Number.isFinite(y)&&Math.abs(x)<=180&&Math.abs(y)<=90?{x,y}:null;
   }pos+=2+size;
  }return null;
 }catch{return null;}
}

/** Keep the existing JPEG parser; load the HEIF metadata reader only for ISO BMFF files. */
export async function readPhonePhotoGps(buffer: ArrayBuffer): Promise<{x: number; y: number} | null> {
 const view = new DataView(buffer);
 if (view.byteLength < 12 || view.getUint32(4) !== 0x66747970) return readPhotoGps(buffer);
 // Reject malformed top-level boxes before handing the file to the HEIF parser.
 let offset = 0;
 while (offset + 8 <= view.byteLength) {
  const size = view.getUint32(offset);
  if (size < 8 || offset + size > view.byteLength) return null;
  if (view.getUint32(offset + 4) === 0x6d657461) break;
  offset += size;
 }
 if (offset + 12 > view.byteLength || view.getUint32(offset) < 12) return null;
 try {
  const {default: exifr} = await import('exifr');
  const coordinates = await exifr.gps(buffer);
  if (!coordinates) return null;
  const {latitude, longitude} = coordinates;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return {x: longitude, y: latitude};
 } catch {
  return null;
 }
}

export const MAX_PHOTO_BYTES=20*1024*1024;
export type PhotoLocationResult={status:'ready';point:{x:number;y:number}}|{status:'empty'|'too_large'|'unsupported'|'no_gps'|'outside_seoul'};
/** Inspect only supported file bytes on the user's device; never upload a photo. */
export async function inspectPhonePhotoLocation(buffer:ArrayBuffer):Promise<PhotoLocationResult>{
 if(!buffer.byteLength)return {status:'empty'};
 if(buffer.byteLength>MAX_PHOTO_BYTES)return {status:'too_large'};
 const v=new DataView(buffer);
 const jpeg=v.byteLength>=2&&v.getUint16(0)===0xffd8;
 const heif=v.byteLength>=16&&v.getUint32(0)>=16&&v.getUint32(4)===0x66747970&&/heic|heix|hevc|hevx|mif1|msf1/.test(new TextDecoder().decode(new Uint8Array(buffer,8,Math.min(v.getUint32(0)-8,v.byteLength-8))));
 if(!jpeg&&!heif)return {status:'unsupported'};
 const point=await readPhonePhotoGps(buffer);
 if(!point)return {status:'no_gps'};
 if(point.x<126.7||point.x>127.3||point.y<37.4||point.y>37.8)return {status:'outside_seoul'};
 return {status:'ready',point};
}
