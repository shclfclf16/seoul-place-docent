import test from 'node:test';
import assert from 'node:assert/strict';
import {matchMuseumPhotoDongs} from '../scripts/lib/dong-match.mjs';

const patterns=[
 {district:'성동구',dong:'마장동',needsDistrict:false,names:['마장동']},
 {district:'종로구',dong:'숭인동',needsDistrict:false,names:['숭인동']},
];

test('museum photo location uses source place or title, never a neighborhood mentioned only in description',()=>{
 const item={place:'서울특별시 성동구 마장동',title:'마장동 가축시장 풍경',description:'숭인동 우시장이 이전한 뒤 마장동에 시장이 들어섰다.'};
 const result=matchMuseumPhotoDongs(item,patterns);
 assert.deepEqual(result.dongs.map(x=>x.dong),['마장동']);
 assert.equal(result.basis,'source_place');
});

test('conflicting source place and photo title are quarantined instead of cross-linked',()=>{
 const result=matchMuseumPhotoDongs({place:'서울특별시 성동구 마장동',title:'숭인동 우시장의 모습',description:'세운상가와 무관한 기록'},patterns);
 assert.equal(result.conflict,true);
 assert.deepEqual(result.dongs,[]);
});
