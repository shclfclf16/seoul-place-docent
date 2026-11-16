/** Read-only query against the reviewed three-table catalog. Candidate rows are never public evidence. */
export type PlaceRecord = {
  record_id: string; record_title: string; record_type: string; source_institution: string;
  source_url: string; created_year: number | null; subject_start_year: number | null;
  subject_end_year: number | null; evidence_excerpt: string; rights_status: string;
  review_status: string; historical_place_name: string; relation_type: 'EXACT_SITE' | 'NEARBY' | 'DISTRICT_CONTEXT';
  relation_evidence: string; district: string; legal_dong: string;
};
export type PlaceRecordsResult = {status:'disabled'} | {status:'ok';location:string;records:PlaceRecord[]} | {status:'unavailable';code:string};
type Deps={getToken:(signal:AbortSignal)=>Promise<string>;fetch?:typeof fetch};
type QueryResponse={errors?:unknown[];totalBytesProcessed?:string;jobComplete?:boolean;pageToken?:string;schema?:{fields?:Array<{name:string}>};rows?:Array<{f:Array<{v:string|number|boolean|null}>}>};
const selected=['record_id','record_title','record_type','source_institution','source_url','created_year','subject_start_year','subject_end_year','evidence_excerpt','rights_status','review_status','historical_place_name','relation_type','relation_evidence','district','legal_dong'] as const;
const safeCode=/^BIGQUERY_[A-Z_]+$/;

export async function readVerifiedPlaceRecords(settings:Record<string,string|undefined>,input:{district:string;dong:string},deps:Deps):Promise<PlaceRecordsResult>{
  if(settings.BIGQUERY_PLACE_SEARCH_ENABLED!=='true')return {status:'disabled'};
  const project=settings.BIGQUERY_PROJECT_ID??'',dataset=settings.BIGQUERY_DATASET_ID??'',locationSetting=settings.BIGQUERY_LOCATION??'';
  const byteCap=settings.BIGQUERY_MAX_BYTES_BILLED??'104857600',limit=Number(settings.BIGQUERY_MAX_ROWS??'25');
  const district=input.district.trim(),dong=input.dong.trim();
  if(!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project)||!/^\w{1,1024}$/.test(dataset)||
    (locationSetting&&!/^[a-z0-9-]{1,64}$/i.test(locationSetting))||!/^[1-9]\d{0,17}$/.test(byteCap)||
    !Number.isInteger(limit)||limit<1||limit>100||district.length<2||district.length>40||dong.length<1||dong.length>60||/[\u0000-\u001f]/.test(district+dong))return {status:'unavailable',code:'BIGQUERY_CONFIG_INVALID'};
  const abort=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{abort.abort();reject(new Error('BIGQUERY_TIMEOUT'));},12000);});
  async function run():Promise<PlaceRecordsResult>{
    let token:string;try{token=await deps.getToken(abort.signal);}catch{throw new Error('BIGQUERY_AUTH_FAILED');}
    if(!token)throw new Error('BIGQUERY_AUTH_FAILED');
    const root=`https://bigquery.googleapis.com/bigquery/v2/projects/${project}`;
    async function api<T>(path:string,body?:object):Promise<T>{
      const response=await (deps.fetch??fetch)(root+path,{method:body?'POST':'GET',redirect:'error',cache:'no-store',signal:abort.signal,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
      if(!response.ok)throw new Error(response.status===401||response.status===403?'BIGQUERY_ACCESS_DENIED':'BIGQUERY_REQUEST_FAILED');
      return await response.json() as T;
    }
    const metadata=await api<{location?:string}>(`/datasets/${dataset}?fields=location`),location=metadata.location;
    if(typeof location!=='string'||!/^[a-z0-9-]{1,64}$/i.test(location))throw new Error('BIGQUERY_LOCATION_UNKNOWN');
    if(locationSetting&&locationSetting.toLowerCase()!==location.toLowerCase())throw new Error('BIGQUERY_LOCATION_MISMATCH');
    const names=['historical_records','record_place_links','places'] as const;
    const quote=String.fromCharCode(96);
    const tables=names.map(name=>`${quote}${project}.${dataset}.${name}${quote}`);
    const query=`SELECT ${selected.map(name=>name.startsWith('relation_')?'l.'+name:name==='district'||name==='legal_dong'?'p.'+name:'r.'+name).join(', ')}
FROM ${tables[0]} r JOIN ${tables[1]} l ON l.record_id=r.record_id JOIN ${tables[2]} p ON p.place_id=l.place_id
WHERE p.district=@district AND (p.legal_dong=@dong OR l.relation_type='DISTRICT_CONTEXT')
AND LOWER(r.review_status)='content_checked' AND LOWER(p.location_review_status)='verified'
AND LOWER(l.link_review_status)='content_checked' AND l.relation_type IN ('EXACT_SITE','NEARBY','DISTRICT_CONTEXT')
AND r.rights_status IN ('KOGL0','KOGL1','public_domain')
AND LOWER(COALESCE(r.duplicate_status,'')) IN ('unique','verified_unique','not_duplicate','confirmed_unique')
AND STARTS_WITH(LOWER(r.source_url),'https://')
ORDER BY COALESCE(r.subject_start_year,r.created_year) IS NULL,COALESCE(r.subject_start_year,r.created_year),r.record_id LIMIT @maxRows`;
    const base={query,parameterMode:'NAMED',queryParameters:[{name:'district',parameterType:{type:'STRING'},parameterValue:{value:district}},{name:'dong',parameterType:{type:'STRING'},parameterValue:{value:dong}},{name:'maxRows',parameterType:{type:'INT64'},parameterValue:{value:String(limit)}}],useLegacySql:false,location,maximumBytesBilled:byteCap,maxResults:limit,timeoutMs:8000};
    const estimate=await api<QueryResponse>('/queries',{...base,dryRun:true});
    if(estimate.errors?.length||typeof estimate.totalBytesProcessed!=='string'||!/^\d+$/.test(estimate.totalBytesProcessed))throw new Error('BIGQUERY_ESTIMATE_FAILED');
    if(BigInt(estimate.totalBytesProcessed)>BigInt(byteCap))throw new Error('BIGQUERY_BUDGET_EXCEEDED');
    const result=await api<QueryResponse>('/queries',base);
    if(result.errors?.length)throw new Error('BIGQUERY_QUERY_FAILED');if(result.jobComplete!==true)throw new Error('BIGQUERY_QUERY_INCOMPLETE');if(result.pageToken)throw new Error('BIGQUERY_RESULT_TRUNCATED');
    const fields=result.schema?.fields?.map(field=>field.name)??selected;
    const records=(result.rows??[]).slice(0,limit).map(row=>Object.fromEntries(row.f.map((cell,index)=>[fields[index],cell.v==null?'':String(cell.v)]))).map(row=>mapRecord(row)).filter((row):row is PlaceRecord=>row!==null);
    return {status:'ok',location,records};
  }
  try{return await Promise.race([run(),deadline]);}catch(error){const message=error instanceof Error?error.message:'';return {status:'unavailable',code:safeCode.test(message)?message:'BIGQUERY_REQUEST_FAILED'};}finally{clearTimeout(timer);}
}

function optionalYear(value:unknown){if(value===''||value==null)return null;const n=Number(value);return Number.isInteger(n)&&n>=1&&n<=9999?n:null;}
function mapRecord(row:Record<string,unknown>):PlaceRecord|null{
  const get=(key:string)=>typeof row[key]==='string'?row[key] as string:'';
  const relation=get('relation_type');
  if(!get('record_id')||!get('record_title')||!get('source_institution')||!get('source_url').startsWith('https://')||!['EXACT_SITE','NEARBY','DISTRICT_CONTEXT'].includes(relation))return null;
  return {record_id:get('record_id'),record_title:get('record_title'),record_type:get('record_type'),source_institution:get('source_institution'),source_url:get('source_url'),created_year:optionalYear(row.created_year),subject_start_year:optionalYear(row.subject_start_year),subject_end_year:optionalYear(row.subject_end_year),evidence_excerpt:get('evidence_excerpt'),rights_status:get('rights_status'),review_status:get('review_status'),historical_place_name:get('historical_place_name'),relation_type:relation as PlaceRecord['relation_type'],relation_evidence:get('relation_evidence'),district:get('district'),legal_dong:get('legal_dong')};
}

export function placeRecordsAsScenes(records:PlaceRecord[]){return records.map(record=>{const year=record.subject_start_year??record.created_year;const end=record.subject_end_year;const date=year===null?'시기 미상':end&&end!==year?`${year}~${end}년`:`${year}년`;const relationNote=record.relation_type==='EXACT_SITE'?'검토된 장소 연결 자료입니다. 개별 건물의 동일성은 별도 근거를 확인하세요.':record.relation_type==='NEARBY'?'검토된 인근 자료입니다. 검색한 건물·부지와 같다고 단정하지 마세요.':'자치구 배경자료입니다. 특정 동·건물의 직접 역사로 단정하지 마세요.';return {id:`bq:${record.record_id}`,kind:'document' as const,date,year,order:year??Number.POSITIVE_INFINITY,title:record.record_title,text:record.evidence_excerpt||'자료의 제목과 출처가 확인되었습니다. 자세한 내용은 원문에서 확인해 주세요.',scope:record.relation_type==='DISTRICT_CONTEXT'?'district' as const:'dong' as const,photos:[],cutCount:0,evidence:[{title:record.record_title,url:record.source_url,institution:record.source_institution,note:[relationNote,record.relation_evidence].filter(Boolean).join(' ')}]};});}
