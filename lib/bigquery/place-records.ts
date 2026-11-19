import type {Address} from '@/lib/providers';
/** Read-only query against the reviewed three-table catalog. Candidate rows are never public evidence. */
export type PlaceRecord = {
  record_id: string; record_title: string; record_type: string; source_institution: string;
  source_url: string; created_year: number | null; subject_start_year: number | null;
  subject_end_year: number | null; evidence_excerpt: string; rights_status: string;
  review_status: string; historical_place_name: string; relation_type: 'EXACT_SITE' | 'NEARBY' | 'DISTRICT_CONTEXT';
  relation_evidence: string; district: string; legal_dong: string; place_id:string; place_name:string;
  current_address:string; road_address:string; jibun_address:string; building_name:string;
  building_management_number:string; latitude:number|null; longitude:number|null; coordinate_system:string;
};
export type PlaceRecordsResult = {status:'disabled'} | {status:'ok';location:string;records:PlaceRecord[]} | {status:'unavailable';code:string};
type Deps={getToken:(signal:AbortSignal)=>Promise<string>;fetch?:typeof fetch};
type QueryResponse={errors?:unknown[];totalBytesProcessed?:string;jobComplete?:boolean;pageToken?:string;schema?:{fields?:Array<{name:string}>};rows?:Array<{f:Array<{v:string|number|boolean|null}>}>};
const selected=[['record_id','r.record_id'],['record_title','r.record_title'],['record_type','r.record_type'],['source_institution','r.source_institution'],['source_url','r.source_url'],['created_year','r.created_year'],['subject_start_year','r.subject_start_year'],['subject_end_year','r.subject_end_year'],['evidence_excerpt','r.evidence_excerpt'],['rights_status','r.rights_status'],['review_status','r.review_status'],['historical_place_name','r.historical_place_name'],['relation_type','l.relation_type'],['relation_evidence','l.relation_evidence'],['district','p.district'],['legal_dong','p.legal_dong'],['place_id','p.place_id'],['place_name','p.place_name'],['current_address','p.current_address'],['road_address','p.road_address'],['jibun_address','p.jibun_address'],['building_name','p.building_name'],['building_management_number','p.building_management_number'],['latitude','p.latitude'],['longitude','p.longitude'],['coordinate_system','p.coordinate_system']] as const;
const safeCode=/^BIGQUERY_[A-Z_]+$/;

export async function readVerifiedPlaceRecords(settings:Record<string,string|undefined>,input:{address:Address;point?:{x:number;y:number}},deps:Deps):Promise<PlaceRecordsResult>{
  if(settings.BIGQUERY_PLACE_SEARCH_ENABLED!=='true')return {status:'disabled'};
  const project=settings.BIGQUERY_PROJECT_ID??'',dataset=settings.BIGQUERY_DATASET_ID??'',locationSetting=settings.BIGQUERY_LOCATION??'';
  const byteCap=settings.BIGQUERY_MAX_BYTES_BILLED??'104857600',limit=Number(settings.BIGQUERY_MAX_ROWS??'25');
  const district=input.address.sggNm.trim(),dong=input.address.emdNm.trim();
  const pointInvalid=!!input.point&&(!Number.isFinite(input.point.x)||!Number.isFinite(input.point.y)||input.point.x<126.7||input.point.x>127.3||input.point.y<37.4||input.point.y>37.8);
  if(!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project)||!/^\w{1,1024}$/.test(dataset)||
    (locationSetting&&!/^[a-z0-9-]{1,64}$/i.test(locationSetting))||!/^[1-9]\d{0,17}$/.test(byteCap)||
    !Number.isInteger(limit)||limit<1||limit>100||input.address.siNm!=='서울특별시'||!/^11\d{8}$/.test(input.address.admCd)||pointInvalid||district.length<2||district.length>40||dong.length<1||dong.length>60||/[\u0000-\u001f]/.test(district+dong))return {status:'unavailable',code:'BIGQUERY_CONFIG_INVALID'};
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
    const query=`SELECT ${selected.map(([name,expression])=>`${expression} AS ${name}`).join(', ')}
FROM ${tables[0]} r JOIN ${tables[1]} l ON l.record_id=r.record_id JOIN ${tables[2]} p ON p.place_id=l.place_id
WHERE p.district=@district AND (p.legal_dong=@dong OR l.relation_type='DISTRICT_CONTEXT' OR
  (@latitude!='' AND @longitude!='' AND p.latitude IS NOT NULL AND p.longitude IS NOT NULL AND
   ST_DISTANCE(ST_GEOGPOINT(p.longitude,p.latitude),ST_GEOGPOINT(SAFE_CAST(@longitude AS FLOAT64),SAFE_CAST(@latitude AS FLOAT64)))<=500))
AND LOWER(r.review_status)='content_checked' AND LOWER(p.location_review_status)='verified'
AND LOWER(l.link_review_status)='content_checked' AND l.relation_type IN ('EXACT_SITE','NEARBY','DISTRICT_CONTEXT')
AND r.rights_status IN ('KOGL0','KOGL1','public_domain')
AND LOWER(COALESCE(r.duplicate_status,'')) IN ('unique','verified_unique','not_duplicate','confirmed_unique')
AND STARTS_WITH(LOWER(r.source_url),'https://')
ORDER BY COALESCE(r.subject_start_year,r.created_year) IS NULL,COALESCE(r.subject_start_year,r.created_year),r.record_id LIMIT @maxRows`;
    const base={query,parameterMode:'NAMED',queryParameters:[{name:'district',parameterType:{type:'STRING'},parameterValue:{value:district}},{name:'dong',parameterType:{type:'STRING'},parameterValue:{value:dong}},{name:'latitude',parameterType:{type:'STRING'},parameterValue:{value:input.point?String(input.point.y):''}},{name:'longitude',parameterType:{type:'STRING'},parameterValue:{value:input.point?String(input.point.x):''}},{name:'maxRows',parameterType:{type:'INT64'},parameterValue:{value:String(limit)}}],useLegacySql:false,location,maximumBytesBilled:byteCap,maxResults:limit,timeoutMs:8000};
    const estimate=await api<QueryResponse>('/queries',{...base,dryRun:true});
    if(estimate.errors?.length||typeof estimate.totalBytesProcessed!=='string'||!/^\d+$/.test(estimate.totalBytesProcessed))throw new Error('BIGQUERY_ESTIMATE_FAILED');
    if(BigInt(estimate.totalBytesProcessed)>BigInt(byteCap))throw new Error('BIGQUERY_BUDGET_EXCEEDED');
    const result=await api<QueryResponse>('/queries',base);
    if(result.errors?.length)throw new Error('BIGQUERY_QUERY_FAILED');if(result.jobComplete!==true)throw new Error('BIGQUERY_QUERY_INCOMPLETE');if(result.pageToken)throw new Error('BIGQUERY_RESULT_TRUNCATED');
    const fields=result.schema?.fields?.map(field=>field.name)??selected.map(([name])=>name);
    const records=(result.rows??[]).slice(0,limit).map(row=>Object.fromEntries(row.f.map((cell,index)=>[fields[index],cell.v==null?'':String(cell.v)]))).map(row=>mapRecord(row)).filter((row):row is PlaceRecord=>!!row).map(record=>classifyPlaceRecord(record,input.address,input.point)).filter((row):row is PlaceRecord=>!!row);
    return {status:'ok',location,records};
  }
  try{return await Promise.race([run(),deadline]);}catch(error){const message=error instanceof Error?error.message:'';return {status:'unavailable',code:safeCode.test(message)?message:'BIGQUERY_REQUEST_FAILED'};}finally{clearTimeout(timer);}
}

function optionalYear(value:unknown){if(value===''||value==null)return null;const n=Number(value);return Number.isInteger(n)&&n>=1&&n<=9999?n:null;}
function optionalCoordinate(value:unknown,min:number,max:number){if(value===''||value==null)return null;const n=Number(value);return Number.isFinite(n)&&n>=min&&n<=max?n:null;}
function mapRecord(row:Record<string,unknown>):PlaceRecord|null{
  const get=(key:string)=>typeof row[key]==='string'?row[key] as string:'';
  const relation=get('relation_type');
  if(!get('record_id')||!get('record_title')||!get('source_institution')||!get('source_url').startsWith('https://')||!['EXACT_SITE','NEARBY','DISTRICT_CONTEXT'].includes(relation))return null;
  return {record_id:get('record_id'),record_title:get('record_title'),record_type:get('record_type'),source_institution:get('source_institution'),source_url:get('source_url'),created_year:optionalYear(row.created_year),subject_start_year:optionalYear(row.subject_start_year),subject_end_year:optionalYear(row.subject_end_year),evidence_excerpt:get('evidence_excerpt'),rights_status:get('rights_status'),review_status:get('review_status'),historical_place_name:get('historical_place_name'),relation_type:relation as PlaceRecord['relation_type'],relation_evidence:get('relation_evidence'),district:get('district'),legal_dong:get('legal_dong'),place_id:get('place_id'),place_name:get('place_name'),current_address:get('current_address'),road_address:get('road_address'),jibun_address:get('jibun_address'),building_name:get('building_name'),building_management_number:get('building_management_number'),latitude:optionalCoordinate(row.latitude,-90,90),longitude:optionalCoordinate(row.longitude,-180,180),coordinate_system:get('coordinate_system')};
}

function normalizedAddress(value:string){return value.normalize('NFKC').replace(/\([^)]*\)/g,'').replace(/\s+/g,'').replace(/[.,]/g,'').trim();}
function distanceMeters(a:{x:number;y:number},b:{x:number;y:number}){const rad=(n:number)=>n*Math.PI/180;const dLat=rad(b.y-a.y),dLon=rad(b.x-a.x),v=Math.sin(dLat/2)**2+Math.cos(rad(a.y))*Math.cos(rad(b.y))*Math.sin(dLon/2)**2;return 6371000*2*Math.atan2(Math.sqrt(v),Math.sqrt(1-v));}
/** EXACT_SITE is usable only when the selected signed address matches the catalog building/address. Nearby requires verified coordinates. */
export function classifyPlaceRecord(record:PlaceRecord,address:Address,point?:{x:number;y:number}):PlaceRecord|null{
 if(record.district!==address.sggNm)return null;
 if(record.relation_type==='EXACT_SITE'){
  const managementMatch=!!address.bdMgtSn&&address.bdMgtSn===record.building_management_number;
  const searched=new Set([normalizedAddress(address.roadAddr),normalizedAddress(address.jibunAddr)].filter(Boolean));
  const catalog=[record.current_address,record.road_address,record.jibun_address].map(normalizedAddress).filter(Boolean);
  return managementMatch||catalog.some(value=>searched.has(value))?record:null;
 }
 if(record.relation_type==='NEARBY'){
  if(!point||record.coordinate_system.toUpperCase()!=='EPSG:4326'||record.latitude===null||record.longitude===null)return null;
  return distanceMeters(point,{x:record.longitude,y:record.latitude})<=500?record:null;
 }
 return !record.legal_dong||record.legal_dong===address.emdNm?record:null;
}

export function placeRecordsAsScenes(records:PlaceRecord[]){return records.map(record=>{const year=record.subject_start_year??record.created_year;const end=record.subject_end_year;const date=year===null?'시기 미상':end&&end!==year?`${year}~${end}년`:`${year}년`;const relationNote=record.relation_type==='EXACT_SITE'?'선택한 주소의 건축물관리번호 또는 도로명·지번주소와 자료 장소가 일치했습니다.':record.relation_type==='NEARBY'?`검토된 인접 장소(${record.place_name||record.historical_place_name})와의 직선거리가 500m 이내입니다. 검색 주소의 건물 역사로 단정하지 마세요.`:record.legal_dong?`${record.legal_dong} 동네 배경자료입니다. 특정 건물·부지의 직접 역사로 단정하지 마세요.`:'자치구 배경자료입니다. 특정 동·건물의 직접 역사로 단정하지 마세요.';return {id:`bq:${record.record_id}`,kind:'document' as const,date,year,order:year??Number.POSITIVE_INFINITY,title:record.record_title,text:record.evidence_excerpt||'자료의 제목과 출처가 확인되었습니다. 자세한 내용은 원문에서 확인해 주세요.',scope:record.relation_type==='EXACT_SITE'?'place' as const:record.relation_type==='DISTRICT_CONTEXT'&&!record.legal_dong?'district' as const:'dong' as const,placeRelation:record.relation_type,photos:[],cutCount:0,evidence:[{title:record.record_title,url:record.source_url,institution:record.source_institution,note:[`자료 유형: ${record.record_type||'미분류'}`,relationNote,record.relation_evidence].filter(Boolean).join(' ')}]};});}
