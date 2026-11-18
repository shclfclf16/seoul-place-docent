/** Private metadata only. Never import this module into public evidence/MCP consumers. */
export const V2_SNAPSHOT = '15dcc4c5894501266afb2062e7ba8eb4dd9f12970b7f2309e8c14410b80bae90';
export const CANDIDATE_NOTICE = '미검토 후보 자료 — 원문·권리·장소·관계 확인 전이며 특정 건물의 직접 역사로 사용할 수 없습니다.';
export type CandidateSearch = {institution:string;recordType:string;district:string;legalDong:string;placeName:string;title:string;recordId:string;linkRowNumber:string;page:number;pageSize:number};
type Settings = Record<string,string|undefined>;
type Deps = {getToken:(signal:AbortSignal)=>Promise<string>;fetch?:typeof fetch};
type QueryResponse = {errors?:unknown[];jobComplete?:boolean;pageToken?:string;totalBytesProcessed?:string;totalBytesBilled?:string;cacheHit?:boolean;jobReference?:{jobId?:string};schema?:{fields?:{name:string}[]};rows?:{f:{v:unknown}[]}[]};

export function candidatePreviewEnabled(settings:Settings){
  return settings.VERCEL_ENV==='preview' && settings.BIGQUERY_V2_PREVIEW_ENABLED==='true';
}

export function parseCandidateSearch(params:URLSearchParams):CandidateSearch {
  const keys=['institution','recordType','district','legalDong','placeName','title','recordId','linkRowNumber','page','pageSize'];
  for(const key of params.keys())if(!keys.includes(key)||params.getAll(key).length!==1)throw new Error('CANDIDATE_INPUT_INVALID');
  const text=(key:string)=>{const value=(params.get(key)??'').trim();if(value.length>120||/[\u0000-\u001f\u007f]/.test(value))throw new Error('CANDIDATE_INPUT_INVALID');return value;};
  const integer=(key:string,fallback:number)=>{const raw=params.get(key);if(raw!==null&&!/^[1-9]\d{0,4}$/.test(raw))throw new Error('CANDIDATE_INPUT_INVALID');return raw===null?fallback:Number(raw);};
  const result={institution:text('institution'),recordType:text('recordType'),district:text('district'),legalDong:text('legalDong'),placeName:text('placeName'),title:text('title'),recordId:text('recordId'),linkRowNumber:text('linkRowNumber'),page:integer('page',1),pageSize:integer('pageSize',25)};
  if(result.pageSize>50||(result.page-1)*result.pageSize>10000)throw new Error('CANDIDATE_INPUT_INVALID');
  return result;
}

export function candidateQuery(settings:Settings,input:CandidateSearch){
  const project=settings.BIGQUERY_PROJECT_ID??'',dataset=settings.BIGQUERY_DATASET_ID??'';
  if(!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project)||!/^\w{1,1024}$/.test(dataset))throw new Error('BIGQUERY_CONFIG_INVALID');
  // Revalidate service inputs too, not only HTTP inputs.
  const checked=parseCandidateSearch(new URLSearchParams(Object.entries(input).map(([k,v])=>[k,String(v)])));
  const table=(kind:string)=>'`'+`${project}.${dataset}.v2_${kind}_${V2_SNAPSHOT}`+'`';
  const query=`WITH links AS (
 SELECT l.*, COUNT(*) OVER (PARTITION BY record_id, place_id) AS duplicate_link_count
 FROM ${table('links')} l
)
SELECT r.record_id, r.record_title, r.record_type, r.created_year, r.batch_sha256, r.row_sha256, r.input_row_number, r.rights_evidence_url, r.subject_start_year,
 r.subject_end_year, r.source_institution, r.source_url, r.review_status, r.rights_status,
 r.approved_for_public_use, r.image_review_status, r.playback_review_status,
 r.display_permission, r.thumbnail_permission, r.embed_permission, r.storage_permission, r.modification_permission,
 l.place_id, l.relation_type, l.link_review_status, l.approved_relation, l._batch_sha256 AS link_batch_sha256, l._row_sha256 AS link_row_sha256,
 l._input_row_number AS link_row_number, l.duplicate_link_count,
 p.place_name, p.district, p.legal_dong, p.location_review_status, p.approved_location, p._batch_sha256 AS place_batch_sha256, p._row_sha256 AS place_row_sha256, p.road_address, p.jibun_address, p.building_management_number, p.latitude_value, p.longitude_value,
 CASE WHEN l._input_row_number IS NULL THEN 'NO_LINK'
      WHEN l.place_id IS NULL OR l.place_id='' THEN 'EMPTY_PLACE_ID'
      WHEN p.place_id IS NULL THEN 'MISSING_PLACE'
      WHEN l.relation_type='EXACT_SITE' THEN 'UNVERIFIED_EXACT_SITE'
      ELSE 'REVIEW_REQUIRED' END AS audit_state
FROM ${table('records')} r
LEFT JOIN links l ON l.record_id=r.record_id
LEFT JOIN ${table('places')} p ON p.place_id=l.place_id
WHERE (@institution='' OR STRPOS(LOWER(r.source_institution),LOWER(@institution))>0)
 AND (@recordType='' OR r.record_type=@recordType)
 AND (@district='' OR p.district=@district)
 AND (@legalDong='' OR p.legal_dong=@legalDong)
 AND (@placeName='' OR STRPOS(LOWER(p.place_name),LOWER(@placeName))>0)
 AND (@title='' OR STRPOS(LOWER(r.record_title),LOWER(@title))>0)
 AND (@recordId='' OR r.record_id=@recordId)
 AND (@linkRowNumber='' OR CAST(COALESCE(l._input_row_number,0) AS STRING)=@linkRowNumber)
ORDER BY r.record_id, COALESCE(l._input_row_number,0)
LIMIT @limit OFFSET @offset`;
  const parameter=(name:string,value:string|number,type='STRING')=>({name,parameterType:{type},parameterValue:{value:String(value)}});
  return {query,parameterMode:'NAMED',queryParameters:[...['institution','recordType','district','legalDong','placeName','title','recordId','linkRowNumber'].map(key=>parameter(key,checked[key as keyof CandidateSearch])),parameter('limit',checked.pageSize+1,'INT64'),parameter('offset',(checked.page-1)*checked.pageSize,'INT64')]};
}

function safeSourceUrl(value:string){
  try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.href:null;}catch{return null;}
}

export function candidateMetadata(row:Record<string,unknown>){
  const str=(key:string)=>typeof row[key]==='string'?row[key] as string:'';
  const year=(key:string)=>{const value=row[key];const n=Number(value);return value!==''&&value!=null&&Number.isInteger(n)&&n>=1&&n<=9999?n:null;};
  const number=(key:string)=>{const n=Number(row[key]);return Number.isSafeInteger(n)&&n>=0?n:0;};
  const relation=str('relation_type');
  const relationScope=relation==='EXACT_SITE'?'UNVERIFIED_EXACT_SITE':relation==='DISTRICT_CONTEXT'?'DISTRICT_CONTEXT':relation==='UNCERTAIN'?'UNCERTAIN':relation==='NEARBY'?'UNVERIFIED_NEARBY':'UNLINKED';
  // No trusted approval registry/exporter is connected. Raw permission strings alone never grant rights.
  const permission=(field:string)=>({sourceStatus:str(field)||'UNKNOWN',allowed:false,reason:'별도 권리 승인 미완료'});
  return {
    candidateLabel:'미검토 후보 자료',notice:CANDIDATE_NOTICE,
    recordId:str('record_id'),title:str('record_title'),recordType:str('record_type'),
    year:year('created_year'),subjectStartYear:year('subject_start_year'),subjectEndYear:year('subject_end_year'),
    institution:str('source_institution'),sourceUrl:safeSourceUrl(str('source_url')),
    placeId:str('place_id'),placeName:str('place_name'),district:str('district'),legalDong:str('legal_dong'),
    relationType:relation,relationScope,directConnection:false,approvedForPublicUse:false,integrity:{batchSha256:str('batch_sha256'),recordRowSha256:str('row_sha256'),placeRowSha256:str('place_row_sha256'),linkRowSha256:str('link_row_sha256'),placeBatchSha256:str('place_batch_sha256'),linkBatchSha256:str('link_batch_sha256'),recordInputRow:number('input_row_number'),linkInputRow:number('link_row_number')},
    location:{roadAddress:str('road_address'),jibunAddress:str('jibun_address'),buildingManagementNumber:str('building_management_number'),latitude:row.latitude_value??null,longitude:row.longitude_value??null},
    review:{record:str('review_status'),rights:str('rights_status'),place:str('location_review_status'),relation:str('link_review_status'),image:str('image_review_status'),playback:str('playback_review_status')},
    diagnostics:{auditState:str('audit_state'),linkRowNumber:number('link_row_number'),duplicateLinkCount:number('duplicate_link_count'),emptyPlaceId:str('audit_state')==='EMPTY_PLACE_ID'},
    mediaPermissions:{display:permission('display_permission'),thumbnail:permission('thumbnail_permission'),embed:permission('embed_permission'),storage:permission('storage_permission'),modification:permission('modification_permission')},
  };
}
export type CandidateResult = {status:'disabled'} | {status:'unavailable';code:string} | {
  status:'ok';notice:string;records:ReturnType<typeof candidateMetadata>[];page:number;pageSize:number;nextPage:number|null;
  budget:{estimatedBytes:string;processedBytes:string|null;billedBytes:string|null;maximumBytesBilled:string;jobId:string|null;cacheHit:boolean};
};

export async function readCandidateRecords(settings:Settings,input:CandidateSearch,deps:Deps):Promise<CandidateResult>{
  if(!candidatePreviewEnabled(settings))return {status:'disabled'};
  const byteCap=settings.BIGQUERY_V2_MAX_BYTES_BILLED??'100000000';
  const location=settings.BIGQUERY_LOCATION??'asia-northeast3';
  if(!/^[1-9]\d{0,9}$/.test(byteCap)||BigInt(byteCap)>BigInt('1000000000')||location!=='asia-northeast3')return {status:'unavailable',code:'BIGQUERY_CONFIG_INVALID'};
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('BIGQUERY_TIMEOUT'));},12000);});
  async function run():Promise<CandidateResult>{
    const query=candidateQuery(settings,input);
    const token=await deps.getToken(controller.signal).catch(()=>{throw new Error('BIGQUERY_AUTH_FAILED');});
    if(!token)throw new Error('BIGQUERY_AUTH_FAILED');
    controller.signal.throwIfAborted();
    const root=`https://bigquery.googleapis.com/bigquery/v2/projects/${settings.BIGQUERY_PROJECT_ID}`;
    async function api<T>(path:string,body?:object):Promise<T>{
      controller.signal.throwIfAborted();
      const response=await (deps.fetch??fetch)(root+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:controller.signal,cache:'no-store',redirect:'error'});
      if(!response.ok)throw new Error(response.status===401||response.status===403?'BIGQUERY_ACCESS_DENIED':'BIGQUERY_REQUEST_FAILED');
      return await response.json() as T;
    }
    const metadata=await api<{location:string}>(`/datasets/${settings.BIGQUERY_DATASET_ID}?fields=location`);
    if(metadata.location?.toLowerCase()!==location)throw new Error('BIGQUERY_LOCATION_MISMATCH');
    const base={...query,useLegacySql:false,location,maximumBytesBilled:byteCap,maxResults:input.pageSize+1,timeoutMs:8000,jobTimeoutMs:'8000',useQueryCache:false};
    const dry=await api<QueryResponse>('/queries',{...base,dryRun:true});
    if(dry.errors?.length||typeof dry.totalBytesProcessed!=='string'||!/^\d+$/.test(dry.totalBytesProcessed))throw new Error('BIGQUERY_ESTIMATE_FAILED');
    if(BigInt(dry.totalBytesProcessed)>BigInt(byteCap))throw new Error('BIGQUERY_BUDGET_EXCEEDED');
    const result=await api<QueryResponse>('/queries',base);
    if(result.errors?.length)throw new Error('BIGQUERY_QUERY_FAILED');
    if(result.jobComplete!==true)throw new Error('BIGQUERY_QUERY_INCOMPLETE');
    if(result.pageToken)throw new Error('BIGQUERY_RESULT_TRUNCATED');
    const fields=result.schema?.fields?.map(field=>field.name);
    if(!fields||!fields.includes('record_id')||!fields.includes('audit_state')||(result.rows?.length??0)>input.pageSize+1)throw new Error('BIGQUERY_RESULT_INVALID');
    const rows=(result.rows??[]).map(row=>{
      if(row.f.length!==fields.length)throw new Error('BIGQUERY_RESULT_INVALID');
      return candidateMetadata(Object.fromEntries(row.f.map((cell,i)=>[fields[i],cell.v])));
    });
    return {status:'ok',notice:CANDIDATE_NOTICE,records:rows.slice(0,input.pageSize),page:input.page,pageSize:input.pageSize,nextPage:rows.length>input.pageSize&&input.page*input.pageSize<=10000?input.page+1:null,
      budget:{estimatedBytes:dry.totalBytesProcessed,processedBytes:result.totalBytesProcessed??null,billedBytes:result.totalBytesBilled??null,maximumBytesBilled:byteCap,jobId:result.jobReference?.jobId??null,cacheHit:result.cacheHit===true}};
  }
  try{return await Promise.race([run(),deadline]);}catch(error){const code=error instanceof Error?error.message:'';return {status:'unavailable',code:/^(BIGQUERY|CANDIDATE)_[A-Z_]+$/.test(code)?code:'BIGQUERY_REQUEST_FAILED'};}finally{clearTimeout(timer);}
}
