import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadDongs, matchMuseumPhotoDongs} from '../scripts/lib/dong-match.mjs';

const raw = new Map(readFileSync(new URL('../data/seoul-museum/raw.jsonl', import.meta.url), 'utf8')
  .trim().split('\n').map(line => JSON.parse(line)).map(item => [item.fileId, item]));
const generated = JSON.parse(readFileSync(new URL('../data/seoul-museum/photos.json', import.meta.url), 'utf8'));
const {patterns} = loadDongs(new URL('../', import.meta.url));

test('museum photo output uses raw source records and every dong is supported by that record', () => {
  assert.equal(generated.length, 5138);
  for (const photo of generated) {
    const url = new URL(photo.sourceUrl);
    const item = raw.get(url.searchParams.get('fileId'));
    assert.ok(item?.ok, photo.title);
    assert.equal(photo.title, item.title);
    assert.equal(url.searchParams.get('fileSn'), item.fileSn);
    if (photo.dong) {
      const match = matchMuseumPhotoDongs(item, patterns);
      assert.ok(match.dongs.some(place => place.district === photo.district && place.dong === photo.dong), item.fileId);
    } else {
      assert.ok(item.place.includes(photo.district), item.fileId);
    }
  }
});

test('restores a directly described valid scene and keeps the known contradictory record quarantined', () => {
  const restored = generated.find(photo => new URL(photo.sourceUrl).searchParams.get('fileId') === 'H-TRNS-54376-741');
  assert.ok(restored);
  assert.equal(restored.district, '강남구');
  assert.equal(restored.dong, '논현동');
  assert.equal(generated.some(photo => new URL(photo.sourceUrl).searchParams.get('fileId') === 'H-TRNS-55104-375'), false);
});
