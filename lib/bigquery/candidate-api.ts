import {requireArchiveAdmin} from '@/lib/archive-db';
import {candidatePreviewEnabled,parseCandidateSearch,type CandidateSearch,type CandidateResult} from '@/lib/bigquery/candidate-records';

const headers={'Cache-Control':'no-store','CDN-Cache-Control':'no-store','Vercel-CDN-Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow','Vary':'x-archive-admin'};

export function candidateHandler(settings:Record<string,string|undefined>,read:(input:CandidateSearch)=>Promise<CandidateResult>){
  return async (request:Request)=>{
    if(!candidatePreviewEnabled(settings))return Response.json({error:'Preview 전용 기능입니다.'},{status:404,headers});
    try{requireArchiveAdmin(request,{ARCHIVE_ADMIN_TOKEN:settings.ARCHIVE_ADMIN_TOKEN});}
    catch{return Response.json({error:'관리자 인증이 필요합니다.'},{status:403,headers});}
    let input:CandidateSearch;
    try{input=parseCandidateSearch(new URL(request.url).searchParams);}
    catch{return Response.json({error:'검색 조건 또는 페이지 범위를 확인하세요.'},{status:400,headers});}
    try{
      const result=await read(input);
      return Response.json(result,{status:result.status==='ok'?200:503,headers});
    }catch{return Response.json({status:'unavailable',code:'BIGQUERY_REQUEST_FAILED'},{status:503,headers});}
  };
}
