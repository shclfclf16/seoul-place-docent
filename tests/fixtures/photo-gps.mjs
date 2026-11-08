// Synthetic TIFF fixture, not a real iPhone/Android camera photograph.
export function gpsJpeg({little=true,lat=[37,34,0],lon=[126,58,0],ns='N',ew='E'}={}){
 const b=new ArrayBuffer(150),v=new DataView(b);v.setUint16(0,0xffd8);v.setUint16(2,0xffe1);v.setUint16(4,146);v.setUint32(6,0x45786966);const base=12;
 const u16=(p,n)=>v.setUint16(base+p,n,little),u32=(p,n)=>v.setUint32(base+p,n,little);
 u16(0,little?0x4949:0x4d4d);u16(2,42);u32(4,8);u16(8,1);u16(10,0x8825);u16(12,4);u32(14,1);u32(18,26);u16(26,4);
 for(let i=0;i<4;i++){const p=28+i*12;u16(p,i+1);u16(p+2,i%2?5:2);u32(p+4,i%2?3:2);if(i%2){const at=i===1?78:102;u32(p+8,at);(i===1?lat:lon).forEach((n,j)=>{u32(at+j*8,n);u32(at+j*8+4,1);});}else v.setUint8(base+p+8,(i===0?ns:ew).charCodeAt(0));}
 return b;
}

export function xmpGpsJpeg({lat='37, 34.000N',lon='126, 58.000E'}={}){
 const xml=`<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:exif="http://ns.adobe.com/exif/1.0/" exif:GPSLatitude="${lat}" exif:GPSLongitude="${lon}" /></rdf:RDF></x:xmpmeta>`;
 const payload=Buffer.concat([Buffer.from('http://ns.adobe.com/xap/1.0/\0'),Buffer.from(xml)]);
 const image=Buffer.alloc(8+payload.length);image.set([0xff,0xd8,0xff,0xe1]);image.writeUInt16BE(payload.length+2,4);payload.copy(image,6);image.set([0xff,0xd9],image.length-2);return image;
}
