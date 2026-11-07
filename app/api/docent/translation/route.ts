import {env} from '@/lib/runtime-env';
import {getDocentStory} from '@/lib/docent-data';
import {translateScenes} from '@/lib/docent-translation';
import {errorResponse,ServiceError} from '@/lib/providers';
export async function POST(request:Request){try{
 if(Number(request.headers.get('content-length')||0)>4096)throw new ServiceError('SIZE','Request too large.',413);
 const raw=await request.text();if(raw.length>4096)throw new ServiceError('SIZE','Request too large.',413);
 const body=JSON.parse(raw) as {district?:unknown;dong?:unknown;ids?:unknown};if(typeof body.district!=='string'||typeof body.dong!=='string'||!Array.isArray(body.ids)||!body.ids.length||body.ids.length>6||body.ids.some(id=>typeof id!=='string'||id.length>120))throw new ServiceError('TRANSLATION_REQUEST','Select up to six story scenes.',400);
 const ids=body.ids as string[];const story=getDocentStory(body.district,body.dong);const scenes=story.scenes.filter(s=>ids.includes(s.id));if(scenes.length!==new Set(body.ids).size)throw new ServiceError('TRANSLATION_SCENE','Story scenes were not found.',400);
 return Response.json({scenes:await translateScenes(scenes,{BUCKET:env.BUCKET,OPENAI_MODEL:env.OPENAI_MODEL}),language:'en',notice:'AI translation for reference. The Korean original is authoritative.'},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return errorResponse(e);}}
