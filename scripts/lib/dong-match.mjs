/**
 * Shared rules for attaching archive photos to legal dongs (used by every build-*-photos script).
 * - full name (삼선동2가), the 동-form base (삼선동 → every 삼선동N가), and a 3+ syllable bare name (여의도 → 여의도동)
 * - a name must start a word and not be followed by a digit or by 구 (영등포 ≠ 영등포구); a short name followed by 로/길 is a road
 * - two-syllable names except 명동 (합동, 정동) and names shared by two districts (신사동, 신정동) also need the district in the text
 * - when the exact legal name appears, siblings are not added; at most 6 dongs per photo
 */
import {readFileSync} from 'node:fs';
const esc=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
// A short name followed by 로/길 is a road (동소문로, 삼선교로), not the neighborhood.
export const has=(text,name)=>name.length<=2?new RegExp(`(?<![가-힣])${esc(name)}(?![0-9]|[가-힣](?<![에의을은이과와로도]))`).test(text):new RegExp(`(?<![가-힣])${esc(name)}(?![0-9]|구(?![가-힣])${/동$|\d가$/.test(name)?'':'|[로길]'})`).test(text);
export function loadDongs(root){
  const bundle=JSON.parse(readFileSync(new URL('data/document-research/bundle.json',root),'utf8'));
  const dongs=bundle.targets.filter(t=>t.level==='법정동').map(t=>({district:t.district,dong:t.name}));
  const count=new Map();for(const d of dongs)count.set(d.dong,(count.get(d.dong)||0)+1);
  const patterns=dongs.map(d=>{const base=d.dong.replace(/\d+가$/,'').replace(/(\D)\d+동$/,'$1동');const bare=base.replace(/동$/,'');
    return {...d,needsDistrict:count.get(d.dong)>1||(d.dong.length<=2&&d.dong!=='명동'),names:[...new Set([d.dong,/동$/.test(base)?base:'',bare.length>=3&&bare!==base?bare:''].filter(Boolean))]};});
  return {dongs,patterns,districts:[...new Set(dongs.map(d=>d.district))]};
}
export function matchDongs(text,patterns,onlyDistrict){
  const hits=patterns.filter(p=>(!onlyDistrict||p.district===onlyDistrict)&&p.names.some(n=>has(text,n))&&(!p.needsDistrict||onlyDistrict===p.district||text.includes(p.district)));
  const exact=hits.filter(p=>has(text,p.dong));return (exact.length?exact:hits).slice(0,6);
}
/** Link archive photos from explicit source location/title; use description only when the
 * same source sentence ties the title's subject to a dong as the photographed scene. */
export function matchMuseumPhotoDongs(item,patterns){
  const byPlace=matchDongs(item.place||'',patterns);
  const byTitle=matchDongs(item.title||'',patterns);
  const placeDistricts=patterns.map(p=>p.district).filter((d,i,a)=>a.indexOf(d)===i&&(item.place||'').includes(d));
  if(byPlace.length&&byTitle.length&&!byPlace.some(a=>byTitle.some(b=>a.district===b.district&&a.dong===b.dong)))return {dongs:[],conflict:true,basis:'conflicting_place_and_title'};
  if(placeDistricts.length&&byTitle.some(p=>!placeDistricts.includes(p.district)))return {dongs:[],conflict:true,basis:'title_outside_source_district'};
  if(byPlace.length)return {dongs:byPlace,conflict:false,basis:'source_place'};
  if(byTitle.length)return {dongs:byTitle,conflict:false,basis:'source_title'};
  if(placeDistricts.length===1){
    const anchors=(item.title||'').match(/[가-힣A-Za-z0-9]{3,}/g)||[];
    const sentences=(item.description||'').split(/[.!?。\n]+/);
    const described=patterns.filter(p=>p.district===placeDistricts[0]&&p.names.some(name=>sentences.some(sentence=>{
      if(!has(sentence,name))return false;
      return anchors.some(anchor=>anchor.length>=3&&sentence.includes(anchor));
    })));
    const exact=described.filter(p=>has(item.description||'',p.dong));
    if(exact.length)return {dongs:exact.slice(0,6),conflict:false,basis:'source_description_title_anchor'};
  }
  return {dongs:[],conflict:false,basis:'unmatched'};
}
/** Spread at most `cap` photos evenly through time as district background. */
export function backgroundPick(list,cap=40){const s=[...list].sort((a,b)=>(a.date||'9999').localeCompare(b.date||'9999'));const step=Math.max(1,s.length/cap);const out=[];for(let k=0;k<s.length&&out.length<cap;k+=step)out.push(s[Math.floor(k)]);return out;}
/**
 * Keeps a dong's story readable: one photo per numbered series ("스마일이발관(1)", "(2)" …), then at most `cap`
 * per dong, preferring older photos while still spreading across the years.
 */
export function capPerDong(entries,cap=60){
  const byDong=new Map();for(const e of entries){const k=e.district+'|'+(e.dong||'');byDong.set(k,[...(byDong.get(k)||[]),e]);}
  const out=[];
  for(const list of byDong.values()){
    const seen=new Set();const series=list.filter(e=>{const key=e.title.replace(/\s*[\(\[]?\d+[\)\]]?\s*$/,'').trim();if(seen.has(key))return false;seen.add(key);return true;});
    const year=e=>Number((e.date||'').match(/(1[5-9]\d{2}|20[0-2]\d)/)?.[1]||9999);
    const sorted=series.sort((a,b)=>year(a)-year(b));
    if(sorted.length<=cap){out.push(...sorted);continue;}
    // Half the slots for the oldest photos, the rest spread evenly over the remaining years.
    const old=sorted.slice(0,cap/2),rest=sorted.slice(cap/2);const step=rest.length/(cap/2);
    out.push(...old,...Array.from({length:cap/2},(_,k)=>rest[Math.floor(k*step)]));
  }
  return out;
}

/** A record's date, falling back to a year or decade written in its title ("1950년대 …", "…(1976)"). */
export function dateOf(date,title=''){
  // A year the title states explicitly is the shooting year; the record date is often when it was registered.
  const stated=title.match(/\((1[89]\d{2}|20[0-2]\d)\)/)||title.match(/^(1[89]\d0|20[0-2]0)년대/);if(stated)return stated[0].replace(/[()]/g,'');
  if(date&&/(1[5-9]\d{2}|20[0-2]\d)/.test(date))return date;
  const decade=title.match(/(1[89]\d0|20[0-2]0)년대/);if(decade)return decade[1]+'년대';
  const year=title.match(/(?<!\d)(1[89]\d{2}|20[0-2]\d)(?!\d)/);if(year)return year[1];
  return date||'시기 미상';
}
