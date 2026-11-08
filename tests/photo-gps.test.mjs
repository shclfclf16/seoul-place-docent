import test from 'node:test';
import assert from 'node:assert/strict';
import {readPhotoGps,inspectPhonePhotoLocation,inspectPhotoGps,MAX_PHOTO_BYTES} from '../lib/photo-gps.ts';
import {gpsJpeg,xmpGpsJpeg} from './fixtures/photo-gps.mjs';
test('little/big endian GPS preserves longitude=x latitude=y',()=>{for(const little of [true,false])assert.deepEqual(readPhotoGps(gpsJpeg({little})),{x:126+58/60,y:37+34/60});});
test('missing GPS, corrupt/truncated data and invalid angles are safe',()=>{
 assert.equal(readPhotoGps(new Uint8Array([255,216,255,217]).buffer),null);
 for(let n=0;n<150;n++)assert.doesNotThrow(()=>readPhotoGps(gpsJpeg().slice(0,n)));
 assert.equal(readPhotoGps(gpsJpeg({lat:[37,60,0]})),null);
 const b=gpsJpeg();new DataView(b).setUint32(12+78+4,0,true);assert.equal(readPhotoGps(b),null);
});
test('format, size, Seoul range and hemispheres are checked',async()=>{
 assert.equal((await inspectPhonePhotoLocation(new ArrayBuffer(0))).status,'empty');
 assert.equal((await inspectPhonePhotoLocation(new ArrayBuffer(MAX_PHOTO_BYTES+1))).status,'too_large');
 assert.equal((await inspectPhonePhotoLocation(new TextEncoder().encode('ftypheic').buffer)).status,'unsupported');
 assert.equal((await inspectPhonePhotoLocation(gpsJpeg({ns:'S'}))).status,'outside_seoul');
 assert.equal((await inspectPhonePhotoLocation(gpsJpeg({lon:[37,0,0],lat:[126,0,0]}))).status,'no_gps');
 assert.equal((await inspectPhonePhotoLocation(gpsJpeg())).status,'ready');
});
test('browser file inspection reads JPEG GPS and rejects mismatched extensions and null-island coordinates',async()=>{
 const file=(bytes,name,type)=>new File([bytes],name,{type});
 const found=await inspectPhotoGps(file(gpsJpeg(),'camera.jpg','image/jpeg'));
 assert.equal(found.status,'ok');assert.equal(found.format,'jpeg');assert.equal(found.source,'exif');assert.deepEqual(found.point,{x:126+58/60,y:37+34/60});
 const mismatch=await inspectPhotoGps(file(gpsJpeg(),'camera.heic','image/heic'));
 assert.equal(mismatch.status,'format_mismatch');assert.equal(mismatch.format,'jpeg');
 const zero=await inspectPhotoGps(file(gpsJpeg({lat:[0,0,0],lon:[0,0,0]}),'zero.jpg','image/jpeg'));
 assert.equal(zero.status,'invalid_coordinates');
 const missing=await inspectPhotoGps(file(new Uint8Array([255,216,255,217]),'no-gps.jpg','image/jpeg'));
 assert.equal(missing.status,'gps_missing');
 const xmp=await inspectPhotoGps(file(xmpGpsJpeg(),'xmp.jpg','image/jpeg'));
 assert.equal(xmp.status,'ok');assert.equal(xmp.source,'xmp');assert.equal(xmp.exifPresent,false);assert.ok(Math.abs(xmp.point.y-(37+34/60))<1e-9);
 const xmpWithoutDirection=await inspectPhotoGps(file(xmpGpsJpeg({lat:'37, 34.000',lon:'126, 58.000'}),'unknown-direction.jpg','image/jpeg'));
 assert.equal(xmpWithoutDirection.status,'invalid_coordinates');
});
