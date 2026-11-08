/** Generated EXIF fixtures, not photographs captured on a physical phone. */
export function gpsJpeg({little=true, latitude=37.545, longitude=127.058}={}) {
  const bytes = new Uint8Array(142);
  const view = new DataView(bytes.buffer);
  bytes.set([255,216,255,225]);
  view.setUint16(4,136);
  bytes.set([69,120,105,102,0,0],6);
  const base=12;
  bytes.set(little?[73,73]:[77,77],base);
  const u16=(offset,value)=>view.setUint16(base+offset,value,little);
  const u32=(offset,value)=>view.setUint32(base+offset,value,little);
  u16(2,42);u32(4,8);u16(8,1);
  u16(10,0x8825);u16(12,4);u32(14,1);u32(18,26);
  u16(26,4);
  const entry=(index,tag,type,count,value)=>{
    const offset=28+index*12;
    u16(offset,tag);u16(offset+2,type);u32(offset+4,count);
    if(type===2)bytes[base+offset+8]=value.charCodeAt(0);
    else u32(offset+8,value);
  };
  entry(0,1,2,2,latitude<0?'S':'N');entry(1,2,5,3,80);
  entry(2,3,2,2,longitude<0?'W':'E');entry(3,4,5,3,104);
  const coordinate=(value,offset)=>{
    const total=Math.round(Math.abs(value)*3600*1000000);
    const degrees=Math.floor(total/(3600*1000000));
    const remaining=total-degrees*3600*1000000;
    const minutes=Math.floor(remaining/(60*1000000));
    const seconds=remaining-minutes*60*1000000;
    u32(offset,degrees);u32(offset+4,1);
    u32(offset+8,minutes);u32(offset+12,1);
    u32(offset+16,seconds);u32(offset+20,1000000);
  };
  coordinate(latitude,80);coordinate(longitude,104);
  bytes.set([255,217],140);
  return bytes;
}
