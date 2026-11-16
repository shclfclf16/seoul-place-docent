import {getDocentStory} from '@/lib/docent-data';
import {addBigQueryEvidence} from '@/lib/bigquery/docent';
import {errorResponse} from '@/lib/providers';
export async function GET(request:Request){try{const p=new URL(request.url).searchParams;const story=getDocentStory(p.get('district')||'',p.get('dong')||'',(p.get('focus')||'').split(',').map(x=>x.trim().slice(0,30)).filter(Boolean).slice(0,3));const result=await addBigQueryEvidence(story);return Response.json({...result.story,bigQueryStatus:result.bigQueryStatus},{headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}catch(e){return errorResponse(e);}}
