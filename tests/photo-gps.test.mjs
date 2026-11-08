import test from 'node:test';
import assert from 'node:assert/strict';
import {readPhotoGps, photoFileIssue, MAX_PHOTO_BYTES} from '../lib/photo-gps.ts';
import {validateMapPoint} from '../lib/map-address.ts';
import {gpsJpeg} from './fixtures/photo-gps.mjs';

test('JPEG EXIF fixtures preserve longitude and latitude in both TIFF byte orders', () => {
  for (const little of [true, false]) {
    const bytes = gpsJpeg({little});
    const point = readPhotoGps(bytes.buffer);
    assert.ok(point);
    assert.ok(Math.abs(point.x - 127.058) < 0.000001);
    assert.ok(Math.abs(point.y - 37.545) < 0.000001);
    assert.doesNotThrow(() => validateMapPoint(point.x, point.y));
  }
});
test('southern and western references work and non-Seoul coordinates remain outside', () => {
  const point = readPhotoGps(gpsJpeg({latitude:-33.86, longitude:-151.2}).buffer);
  assert.ok(Math.abs(point.y + 33.86) < 0.000001);
  assert.ok(Math.abs(point.x + 151.2) < 0.000001);
  assert.throws(() => validateMapPoint(point.x, point.y));
});
test('missing GPS, malformed offsets, invalid denominators and truncated JPEG are safe', () => {
  const valid = gpsJpeg();
  for (let size = 0; size < valid.length - 2; size++) assert.equal(readPhotoGps(valid.slice(0,size).buffer), null);
  assert.equal(readPhotoGps(new Uint8Array([255,216,255,217]).buffer), null);
  const badOffset = gpsJpeg();
  new DataView(badOffset.buffer).setUint32(30, 0xffffffff, true);
  assert.equal(readPhotoGps(badOffset.buffer), null);
  const zero = gpsJpeg();
  new DataView(zero.buffer).setUint32(12+80+4, 0, true);
  assert.equal(readPhotoGps(zero.buffer), null);
});
test('file checks distinguish unsupported HEIC and PNG from missing GPS and bound memory', () => {
  assert.equal(photoFileIssue({size:10,type:'image/heic',name:'iphone.heic'}),'format');
  assert.equal(photoFileIssue({size:10,type:'image/png',name:'wrong.jpg'}),'format');
  assert.equal(photoFileIssue({size:MAX_PHOTO_BYTES+1,type:'image/jpeg',name:'large.jpg'}),'size');
  assert.equal(photoFileIssue({size:0,type:'image/jpeg',name:'empty.jpg'}),'size');
  assert.equal(photoFileIssue({size:10,type:'',name:'photo.JPEG'}),null);
  assert.equal(photoFileIssue({size:10,type:'image/jpeg',name:'photo.jpg'}),null);
});
