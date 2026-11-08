import {readFileSync} from 'node:fs';
const path=process.argv[2];
if(!path)throw new Error('Usage: node scripts/evaluate-photo-kpi.mjs observations.jsonl');
const rows=readFileSync(path,'utf8').split(/\r?\n/).filter(s=>s.trim()).map(s=>JSON.parse(s));
const bools=['eligible','delivered','gpsCorrect','addressCorrect','answerComplete','visualExpected','visualShown','sourcesComplete','falseBuildingClaim','fallbackExpected','fallbackCorrect'];
const ids=new Set();
for(const r of rows){
 if(typeof r.id!=='string'||!r.id||ids.has(r.id))throw new Error('Each observation needs a unique id');ids.add(r.id);
 for(const key of bools)if(r[key]!==null&&typeof r[key]!=='boolean')throw new Error(`${r.id}: ${key} must be boolean or null`);
 if(r.latencyMs!==null&&(!Number.isFinite(r.latencyMs)||r.latencyMs<0))throw new Error(`${r.id}: invalid latencyMs`);
 if(typeof r.evidence!=='string'||!r.evidence)throw new Error(`${r.id}: review evidence required`);
}
const eligible=rows.filter(r=>r.eligible===true);
const rate=(group,predicate)=>({passed:group.filter(predicate).length,total:group.length,rate:group.length?group.filter(predicate).length/group.length:null});
const complete=r=>r.delivered===true&&r.gpsCorrect===true&&r.addressCorrect===true&&r.answerComplete===true&&r.sourcesComplete===true&&r.falseBuildingClaim===false&&(r.visualExpected===false||r.visualShown===true);
const ms=eligible.filter(complete).map(r=>r.latencyMs).filter(Number.isFinite).sort((a,b)=>a-b);
console.log(JSON.stringify({observations:rows.length,eligible:eligible.length,targets:{endToEnd:0.9,gps:0.95,address:0.95,visual:0.95,sources:1,falseBuildingClaims:0,p95Ms:30000},
 delivered:rate(eligible,r=>r.delivered===true),gps:rate(eligible,r=>r.gpsCorrect===true),address:rate(eligible,r=>r.addressCorrect===true),endToEnd:rate(eligible,complete),
 visuals:rate(rows.filter(r=>r.visualExpected===true),r=>r.visualShown===true),sources:rate(rows.filter(r=>r.answerComplete===true),r=>r.sourcesComplete===true),
 falseBuildingClaims:rows.filter(r=>r.falseBuildingClaim===true).length,falseBuildingClaimsUnreviewed:rows.filter(r=>r.falseBuildingClaim===null).length,
 fallback:rate(rows.filter(r=>r.fallbackExpected===true),r=>r.fallbackCorrect===true),p95Ms:ms.length?ms[Math.ceil(ms.length*.95)-1]:null,latencySamples:ms.length,
 note:'Manual reviewed observations; null means unmeasured. Synthetic tests are not device KPI.'},null,2));
