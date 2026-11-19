/** Explicit opt-in local Preview handler + real BigQuery smoke checks. No deploy/write operations. */
import {randomBytes} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {GET} from '../../../app/api/admin/bigquery-v2/records/route.ts';

const args=process.argv.slice(2);
const value=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
if(value('--confirm-read')!=='seoul-place-docent-514906.seoul_history')throw Error('Explicit --confirm-read seoul-place-docent-514906.seoul_history required');
const output=value('--out');if(!output)throw Error('--out required');
const allCases=[
  ...['DOCUMENT','NEWS','PHOTO','MAP','DRAWING','VIDEO'].map(recordType=>({name:recordType,params:{recordType,pageSize:'2'}})),
  {name:'pagination',params:{recordType:'PHOTO',page:'2',pageSize:'2'}},
  {name:'place',params:{placeName:'당인',pageSize:'2'}},
  {name:'district_dong',params:{district:'성동구',legalDong:'마장동',pageSize:'2'}},
  {name:'specific_address',params:{district:'성동구',placeName:'서울특별시 성동구 마장로42길 16',pageSize:'2'}},
];
const cases=value('--case')?allCases.filter(c=>c.name===value('--case')):allCases;
if(!cases.length)throw Error('Unknown case');
const report={mode:'LOCAL_PREVIEW_HANDLER_REAL_BIGQUERY',hostedVercelVerified:false,tests:[],queries:[],maximumCumulativeBilledBytes:1_000_000_000};
const originalFetch=globalThis.fetch;let billed=0;
globalThis.fetch=async(url,options)=>{
  const response=await originalFetch(url,options);
  if(String(url).includes('bigquery.googleapis.com')&&String(url).endsWith('/queries')){
    const request=JSON.parse(options.body);const body=await response.clone().json();
    report.queries.push({dryRun:request.dryRun===true,httpStatus:response.status,estimatedOrProcessedBytes:body.totalBytesProcessed??null,billedBytes:body.totalBytesBilled??null,jobId:body.jobReference?.jobId??null,errorCode:body.error?.code??null});
    if(!request.dryRun)billed+=Number(body.totalBytesBilled??0);
  }
  return response;
};
Object.assign(process.env,{VERCEL_ENV:'preview',BIGQUERY_V2_PREVIEW_ENABLED:'true',BIGQUERY_PLACE_SEARCH_ENABLED:'false',BIGQUERY_AUTH_MODE:'adc',ARCHIVE_ADMIN_TOKEN:randomBytes(32).toString('hex'),BIGQUERY_PROJECT_ID:'seoul-place-docent-514906',BIGQUERY_DATASET_ID:'seoul_history',BIGQUERY_LOCATION:'asia-northeast3'});
const request=(params,authenticated=true)=>new Request('https://local-preview.test/api/admin/bigquery-v2/records?'+new URLSearchParams(params),{headers:authenticated?{'x-archive-admin':process.env.ARCHIVE_ADMIN_TOKEN}:{}});
try{
  const denied=await GET(request({},false));report.unauthenticatedStatus=denied.status;
  for(const item of cases){
    if(billed+100_000_000>report.maximumCumulativeBilledBytes)throw Error('Smoke cumulative budget exhausted');
    process.env.BIGQUERY_V2_MAX_BYTES_BILLED='100000000';
    const response=await GET(request(item.params));const data=await response.json();
    report.tests.push({name:item.name,params:item.params,status:response.status,noStore:response.headers.get('Cache-Control'),code:data.code??null,count:data.records?.length??0,nextPage:data.nextPage??null,budget:data.budget??null,
      validOriginalLinks:data.records?.filter(r=>r.sourceUrl?.startsWith('https://')).length??0,
      allUnreviewed:data.records?.every(r=>r.candidateLabel==='미검토 후보 자료'&&!r.directConnection&&!r.approvedForPublicUse)??null,
      mediaDenied:data.records?.every(r=>Object.values(r.mediaPermissions).every(p=>p.allowed===false))??null,
      types:[...new Set(data.records?.map(r=>r.recordType)??[])],
      scopes:[...new Set(data.records?.map(r=>r.relationScope)??[])]});
    if(response.status!==200)throw Error('Live check failed: '+item.name+' '+data.code);
    if(item.name==='PHOTO'&&data.records?.[0]){
      const first=data.records[0];
      cases.push({name:'institution_title',params:{institution:first.institution,title:first.title.slice(0,100),pageSize:'2'}});
    }
  }
  process.env.VERCEL_ENV='production';
  report.productionStatus=(await GET(request({}))).status;
}catch(error){report.error=error.message;process.exitCode=1;}
finally{
  report.totalBilledBytes=billed;report.totalProcessedBytes=report.queries.filter(q=>!q.dryRun).reduce((sum,q)=>sum+Number(q.estimatedOrProcessedBytes??0),0);
  globalThis.fetch=originalFetch;await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
}
