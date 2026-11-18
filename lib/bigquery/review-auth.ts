import {timingSafeEqual,createHmac} from 'node:crypto';
export const REVIEW_COOKIE='seoul_bqv2_review';
export const CSRF_COOKIE='seoul_bqv2_csrf';
export const REVIEW_SECONDS=2*60*60;
const equal=(a:string,b:string)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};
const sign=(secret:string,payload:string)=>createHmac('sha256',secret).update(payload).digest('base64url');
export function previewReviewEnabled(env:Record<string,string|undefined>){return env.VERCEL_ENV==='preview'&&env.BIGQUERY_V2_PREVIEW_ENABLED==='true';}
export function constantTokenMatch(a:unknown,b:string|undefined){return typeof a==='string'&&a.length>=32&&a.length<=512&&!!b&&equal(a,b);}
export function makeReviewSession(secret:string,csrf:string,now=Date.now(),reviewerId='admin'){
 const exp=Math.floor(now/1000)+REVIEW_SECONDS;const reviewer=Buffer.from(reviewerId).toString('base64url');const body=`v1.${exp}.${csrf}.${reviewer}`;return `${body}.${sign(secret,body)}`;
}
export function readReviewSession(req:Request,env:Record<string,string|undefined>,now=Date.now()){
 if(!previewReviewEnabled(env)||!env.ARCHIVE_ADMIN_TOKEN||!env.ARCHIVE_REVIEW_SESSION_SECRET||env.ARCHIVE_REVIEW_SESSION_SECRET.length<32)return null;
 const cookies=Object.fromEntries((req.headers.get('cookie')||'').split(';').map(x=>{const i=x.indexOf('=');return i<1?['','']:[x.slice(0,i).trim(),x.slice(i+1).trim()];}));
 const session=cookies[REVIEW_COOKIE]||'',parts=session.split('.');
 if(parts.length!==5||parts[0]!=='v1'||!/^[0-9]{10}$/.test(parts[1])||Number(parts[1])<=Math.floor(now/1000)||! /^[A-Za-z0-9_-]{32,80}$/.test(parts[2])||!/^[A-Za-z0-9_-]{2,120}$/.test(parts[3]))return null;
 const csrfCookie=cookies[CSRF_COOKIE]||'';if(!equal(parts[2],csrfCookie)||!equal(parts[4],sign(env.ARCHIVE_REVIEW_SESSION_SECRET,parts.slice(0,4).join('.'))))return null;
 let reviewerId='';try{reviewerId=Buffer.from(parts[3],'base64url').toString('utf8');}catch{return null;}if(!/^[A-Za-z0-9._@-]{2,80}$/.test(reviewerId))return null;
 return {reviewerId,csrf:parts[2]};
}
export function csrfValid(req:Request,session:{csrf:string}){
 const origin=req.headers.get('origin');return (!origin||origin===new URL(req.url).origin)&&equal(req.headers.get('x-csrf-token')||'',session.csrf);
}
export function cookieHeaders(session:string,csrf:string,age=REVIEW_SECONDS){return [`${REVIEW_COOKIE}=${session}; Path=/api/admin/bigquery-v2; Max-Age=${age}; HttpOnly; Secure; SameSite=Strict`,`${CSRF_COOKIE}=${csrf}; Path=/api/admin/bigquery-v2; Max-Age=${age}; Secure; SameSite=Strict`];}
