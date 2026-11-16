import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {saveArchiveSource,addArchivePassage} from '../lib/archive-db.ts';
import {listPassageReviewTargets,reviewArchivePassage,reviewDimensions} from '../lib/archive-passage-review.ts';
import {seedArchive} from '../lib/archive-seed.ts';
import {readArchiveDocentEvidence} from '../lib/archive-docent.ts';

function database(){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
 for(const name of readdirSync(new URL('../drizzle/',import.meta.url)).filter(name=>name.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../drizzle/'+name,import.meta.url),'utf8'));
 return {sql,prepare(query){return {values:[],bind(...values){this.values=values;return this;},async first(){return sql.prepare(query).get(...this.values)||null;},async all(){return {results:sql.prepare(query).all(...this.values)};},async run(){return sql.prepare(query).run(...this.values);}};},async batch(statements){sql.exec('BEGIN');try{const output=[];for(const statement of statements)output.push(await statement.run());sql.exec('COMMIT');return output;}catch(error){sql.exec('ROLLBACK');throw error;}}};
}

test('MCP archive lookup returns only active reviewed current-version neighborhood passages',async()=>{
 const db=database();await seedArchive(db,'test-seed');
 const source=await saveArchiveSource(db,{title:'성수동 검토 자료',institution:'시험 기관',url:'https://history.example.org/seongsu',kind:'web',summary:'검토된 성수동 설명',reviewStatus:'content_checked',regionIds:[]},'tester');
 const passage=await addArchivePassage(db,source.id,{text:'성수동의 산업 변화에 관한 검토된 요약이다.',locator:'2쪽 1문단',textKind:'paraphrase'},'tester');
 db.sql.prepare('INSERT INTO archive_passage_regions (id,passage_id,region_id,label,relation,basis) VALUES (?,?,?,?,?,?)').run('seongsu-scope',passage.id,'dong-성동구-성수동1가','성수동1가','exact_name','원문 표제 일치 대조');
 const target=(await listPassageReviewTargets(db,new URLSearchParams())).items.find(item=>item.id===passage.id);
 const checks=Object.fromEntries(reviewDimensions.map(key=>[key,{result:'checked',note:'제공기관 원문과 대조한 검토 기록'}]));
 await reviewArchivePassage(db,{passageId:passage.id,expectedRevision:0,expectedFingerprint:target.fingerprint,status:'content_checked',evidence:{sourceUrl:'https://history.example.org/seongsu',sourceLocator:'2쪽 1문단',observedAt:new Date().toISOString(),sourceHash:null,classification:'factual',spatialScope:'neighborhood',scopeNote:'성수동 동네 범위이며 개별 부지 동일성은 확인하지 않았다.',summary:'검토된 요약이 원문과 일치한다.',checks}},'reviewer');
 const result=await readArchiveDocentEvidence(db,'성동구','성수동1가');
 assert.equal(result.status,'available');assert.equal(result.scenes.length,1);assert.equal(result.scenes[0].scope,'dong');assert.match(result.scenes[0].text,/검토된 요약/);assert.equal(result.scenes[0].photos.length,0);
 assert.equal(result.sources[0].url,'https://history.example.org/seongsu');assert.ok(result.limitations[0].includes('개별 건물·필지'));
 const notReviewed=await readArchiveDocentEvidence(db,'종로구','세종로');assert.equal(notReviewed.scenes.length,0);
 db.sql.close();
});

test('archive lookup degrades without D1 and never fabricates a regional match',async()=>{
 const result=await readArchiveDocentEvidence(undefined,'성동구','성수동1가');
 assert.equal(result.status,'unavailable');assert.deepEqual(result.scenes,[]);assert.ok(result.limitations[0].includes('D1'));
});
