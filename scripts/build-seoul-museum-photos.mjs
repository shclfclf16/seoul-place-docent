#!/usr/bin/env node
/** data/seoul-museum/raw.jsonl → data/seoul-museum/photos.json. Resolves place from source location/title, never description context. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {loadDongs,matchMuseumPhotoDongs,backgroundPick,capPerDong} from './lib/dong-match.mjs';
import {dateOf} from './lib/dong-match.mjs';
import {museumThumb,museumViewUrl,museumUsable,KOGL_LABEL} from '../lib/seoul-museum.ts';
const root=new URL('../',import.meta.url);const {dongs,patterns,districts}=loadDongs(root);
const items=readFileSync(new URL('data/seoul-museum/raw.jsonl',root),'utf8').split('\n').flatMap(l=>{try{return l?[JSON.parse(l)]:[];}catch{return [];}}).filter((i,k,a)=>i.ok&&museumUsable(i)&&a.findIndex(x=>x.fileId===i.fileId)===k);
const label={B:'서울시정사진',D:'근현대서울사진',A:'서울생활문화자료조사',E:'서울발굴기록'};
const entry=(i,district,dong)=>({district,...(dong?{dong}:{}),title:i.title,date:dateOf(i.date,i.title),imageUrl:museumThumb(i),sourceUrl:museumViewUrl(i),institution:'서울역사박물관',credit:`서울역사박물관 · ${label[i.type]||'서울역사아카이브'}`,license:`${KOGL_LABEL[i.kogl]} · 출처: 서울역사박물관(https://museum.seoul.go.kr)`,description:(i.description||i.title).replace(/\s*\(\d{4}[.\d]*\)\s*$/,'').slice(0,300),allowDisplay:true});
const out=[];const bg=new Map();let matched=0;
let placeTitleConflicts=0;
for(const i of items){const match=matchMuseumPhotoDongs(i,patterns);const chosen=match.dongs;
  if(match.conflict){placeTitleConflicts++;continue;}
  if(chosen.length){matched++;for(const p of chosen)out.push(entry(i,p.district,p.dong));continue;}
  const ds=districts.filter(d=>(i.place||'').includes(d));if(ds.length===1)bg.set(ds[0],[...(bg.get(ds[0])||[]),i]);}
for(const [d,list] of bg)for(const i of backgroundPick(list))out.push(entry(i,d,''));
mkdirSync(new URL('data/seoul-museum/',root),{recursive:true});const capped=capPerDong(out);writeFileSync(new URL('data/seoul-museum/photos.json',root),JSON.stringify(capped));
console.log(`서울역사박물관 photos ${items.length} · matched ${matched} · location/title conflicts quarantined ${placeTitleConflicts} · entries ${capped.length} (before cap ${out.length}) · dongs ${new Set(out.filter(e=>e.dong).map(e=>e.district+e.dong)).size}/${dongs.length}`);
