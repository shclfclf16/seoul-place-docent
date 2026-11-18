import {randomBytes,createHmac} from 'node:crypto';
import {constantTokenMatch,makeReviewSession,cookieHeaders,REVIEW_COOKIE,CSRF_COOKIE} from '@/lib/bigquery/review-auth';
import {candidatePreviewEnabled} from '@/lib/bigquery/candidate-records';
import {env} from '@/lib/runtime-env';
export const dynamic='force-dynamic';export const runtime='nodejs';
const headers={'Cache-Control':'no-store','CDN-Cache-Control':'no-store','Vercel-CDN-Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow','Referrer-Policy':'no-referrer'};
export async function POST(req:Request){
 if(!candidatePreviewEnabled(process.env))return Response.json({error:'Preview 전용 기능입니다.'},{status:404,headers});
 if(req.headers.get('origin')&&req.headers.get('origin')!==new URL(req.url).origin)return Response.json({error:'요청 출처를 확인하세요.'},{status:403,headers});
 const admin=process.env.ARCHIVE_ADMIN_TOKEN,secret=process.env.ARCHIVE_REVIEW_SESSION_SECRET;if(!admin||!secret||secret.length<32||!env.DB)return Response.json({error:'세션 또는 영구 저장소가 설정되지 않았습니다.'},{status:503,headers});
 try{await env.DB.prepare('SELECT 1 FROM bq_v2_review_events LIMIT 1').first();}catch{return Response.json({error:'검토 저장소 마이그레이션이 필요합니다.'},{status:503,headers});}
 const ip=req.headers.get('x-forwarded-for')?.split(',')[0]?.slice(0,80)||'unknown';const rate=createHmac('sha256',secret).update(ip).digest('hex').slice(0,32);const since=new Date(Date.now()-15*60_000).toISOString();
 try{const n=await env.DB.prepare("SELECT count(*) n FROM bq_v2_review_events WHERE reviewer_id=? AND action='LOGIN_FAILED' AND created_at>=?").bind('login:'+rate,since).first<{n:number}>();if((n?.n||0)>=12)return Response.json({error:'로그인 시도 횟수를 초과했습니다.'},{status:429,headers});}catch{return Response.json({error:'검토 저장소를 사용할 수 없습니다.'},{status:503,headers});}
 const raw=await req.text();if(raw.length>2048)return Response.json({error:'요청이 너무 큽니다.'},{status:413,headers});let token,reviewerId;try{const input=JSON.parse(raw);token=input?.token;reviewerId=input?.reviewerId;}catch{return Response.json({error:'요청 형식을 확인하세요.'},{status:400,headers});}
 if(!constantTokenMatch(token,admin)){try{await env.DB.prepare('INSERT INTO bq_v2_review_events(id,review_state_id,revision,action,snapshot_json,reviewer_id,created_at) VALUES(?,?,?,?,?,?,?)').bind(crypto.randomUUID(),'login',Date.now()*1000+Math.floor(Math.random()*1000),'LOGIN_FAILED','{}','login:'+rate,new Date().toISOString()).run();}catch{}return Response.json({error:'관리자 인증이 필요합니다.'},{status:403,headers});}
 if(typeof reviewerId!=='string'||! /^[A-Za-z0-9._@-]{2,80}$/.test(reviewerId))return Response.json({error:'담당자 ID는 영문·숫자와 . _ @ - 기호로 2~80자 입력하세요.'},{status:400,headers});
 const csrf=randomBytes(32).toString('base64url'),response=Response.json({authenticated:true,csrf},{headers});for(const c of cookieHeaders(makeReviewSession(secret,csrf,Date.now(),reviewerId),csrf))response.headers.append('Set-Cookie',c);return response;
}
export async function DELETE(){const response=Response.json({authenticated:false},{headers});for(const key of [REVIEW_COOKIE,CSRF_COOKIE])response.headers.append('Set-Cookie',`${key}=; Path=/api/admin/bigquery-v2; Max-Age=0; Secure; SameSite=Strict`);return response;}
