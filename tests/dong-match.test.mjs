import test from 'node:test';
import assert from 'node:assert/strict';
import {matchMuseumPhotoDongs} from '../scripts/lib/dong-match.mjs';

const patterns=[
 {district:'성동구',dong:'마장동',needsDistrict:false,names:['마장동']},
 {district:'종로구',dong:'숭인동',needsDistrict:false,names:['숭인동']},
 {district:'강남구',dong:'논현동',needsDistrict:false,names:['논현동']},
 {district:'강남구',dong:'개포동',needsDistrict:false,names:['개포동']},
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

test('a source description restores a directly identified event scene while broad source district agrees',()=>{
 const result=matchMuseumPhotoDongs({place:'서울특별시 강남구',title:'영동지구 시영단독주택 준공식',description:'영부인과 시장 등이 참석한 가운데 논현동 영동지구 제3단지에서 단독주택 준공식이 열렸다.'},patterns);
 assert.deepEqual(result.dongs.map(x=>x.dong),['논현동']);
 assert.equal(result.basis,'source_description_title_anchor');
});

test('a different dong mentioned as history or comparison is not treated as the photographed scene',()=>{
 const result=matchMuseumPhotoDongs({place:'서울특별시 종로구',title:'서울특별시 지가색별도 신문로 지역',description:'신문로의 위세는 1983년 논현동에 그 위세를 내어주었다.'},patterns);
 assert.deepEqual(result.dongs,[]);
});

test('a dong in the description cannot override the source district',()=>{
 const result=matchMuseumPhotoDongs({place:'서울특별시 종로구',title:'서울 지가 자료',description:'논현동 지역을 조사한 기록이다.'},patterns);
 assert.deepEqual(result.dongs,[]);
});
