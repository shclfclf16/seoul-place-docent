import test from 'node:test';
import assert from 'node:assert/strict';
import {trustedPhotoUrl,readAttachedPhoto} from '../lib/mcp-photo.ts';
import {MAX_PHOTO_BYTES} from '../lib/photo-gps.ts';
import {gpsJpeg} from './fixtures/photo-gps.mjs';

test('attachment downloads reject arbitrary hosts, credentials, ports and redirects',async()=>{
 for(const url of ['http://files.oaiusercontent.com/a','https://127.0.0.1/a','https://files.oaiusercontent.com.evil.test/a','https://user:pass@files.oaiusercontent.com/a','https://files.oaiusercontent.com:444/a','https://s3.amazonaws.com/a'])assert.throws(()=>trustedPhotoUrl(url));
 assert.equal(trustedPhotoUrl('https://files.oaiusercontent.com/a?sig=x').hostname,'files.oaiusercontent.com');
 const original=globalThis.fetch;globalThis.fetch=async(_url,options)=>{assert.equal(options.redirect,'manual');return new Response(null,{status:302,headers:{location:'http://127.0.0.1/'}});};
 try{await assert.rejects(readAttachedPhoto('https://files.oaiusercontent.com/a'),/가져오지/);}finally{globalThis.fetch=original;}
});
test('original bytes produce GPS; missing GPS never becomes guessed coordinates',async()=>{
 const original=globalThis.fetch;
 try{
  globalThis.fetch=async()=>new Response(gpsJpeg());
  const parsed=await readAttachedPhoto('https://files.oaiusercontent.com/a');
  assert.equal(parsed.location.status,'ready');assert.equal(parsed.location.point.x,126+58/60);assert.equal(parsed.capturedAt,null);
  globalThis.fetch=async()=>new Response(new Uint8Array([255,216,255,217]));
  assert.equal((await readAttachedPhoto('https://files.oaiusercontent.com/a')).location.status,'no_gps');
  globalThis.fetch=async()=>new Response(gpsJpeg({ns:'S'}));
  assert.equal((await readAttachedPhoto('https://files.oaiusercontent.com/a')).location.status,'outside_seoul');
 }finally{globalThis.fetch=original;}
});
test('size limit applies to declared length and streamed bytes',async()=>{
 const original=globalThis.fetch;
 try{
  globalThis.fetch=async()=>new Response(new Uint8Array([1]),{headers:{'content-length':String(MAX_PHOTO_BYTES+1)}});
  await assert.rejects(readAttachedPhoto('https://files.oaiusercontent.com/a'),/20MiB/);
  globalThis.fetch=async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(MAX_PHOTO_BYTES));c.enqueue(new Uint8Array(1));c.close();}}));
  await assert.rejects(readAttachedPhoto('https://files.oaiusercontent.com/a'),/20MiB/);
 }finally{globalThis.fetch=original;}
});
