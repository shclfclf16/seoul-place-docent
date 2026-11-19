import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {paginateHistoryScenes} from '../lib/mcp-history-pagination.ts';
const route=readFileSync(new URL('../app/mcp/route.ts',import.meta.url),'utf8');
test('MCP exposes evidence preparation, GPS fallback and mechanical validation',()=>{
 for(const name of ['resolve_photo_location','prepare_place_answer','generate_place_answer','validate_place_answer','get_answer_stats'])assert.ok(route.includes("name: '"+name+"'")||route.includes("name:'"+name+"'"));
 assert.ok(route.includes('mapAddress(input.longitude,input.latitude,env)'));
 assert.ok(route.includes("status:'needs_location'"));assert.ok(route.includes('needsConfirmation:true'));
 assert.equal(route.includes('spend('),false);
 assert.equal(route.includes('beforeRequest'),false);
 assert.ok(route.includes('mcpOriginalPhotoUrl'));
 assert.equal(route.includes('photoResearchThumbnail'),false);
 assert.ok(route.includes('출처 자료에 직접 저장된 imageUrl'));
 assert.ok(route.includes('제목·기관·원문 링크·공간 범위'));
});
test('grouped history pagination uses the actual scene count',()=>{
 assert.ok(route.includes('paginateHistoryScenes(story.scenes,input.offset,input.limit)'));
 const allScenes=[
  {id:'place-record',placeRelation:'EXACT_SITE'},
  {id:'nearby-1',placeRelation:'NEARBY'},
  {id:'neighborhood-1'},
  {id:'district-1',placeRelation:'DISTRICT_CONTEXT'},
 ];
 const first=paginateHistoryScenes(allScenes,0,2);
 assert.deepEqual(first.scenes.map(scene=>scene.id),['nearby-1','neighborhood-1']);
 assert.equal(first.total,3);assert.equal(first.sceneCount,3);assert.equal(first.offset,0);assert.equal(first.nextOffset,2);
 const last=paginateHistoryScenes(allScenes,2,2);
 assert.deepEqual(last.scenes.map(scene=>scene.id),['district-1']);
 assert.equal(last.total,3);assert.equal(last.nextOffset,null);
 const beyondEnd=paginateHistoryScenes(allScenes,3,2);
 assert.deepEqual(beyondEnd.scenes,[]);assert.equal(beyondEnd.total,3);assert.equal(beyondEnd.nextOffset,null);
});
