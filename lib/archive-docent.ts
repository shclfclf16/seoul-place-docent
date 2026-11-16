import {activePassageReviewSql,currentPassageSql} from './archive-passage-review';
import {historicalDate,type DocentStory,type StoryScene} from './docent-story';

type ArchiveRow={id:string;text:string;locator:string;text_kind:string;title:string;institution:string;url:string;label:string;level:string;relation:string;basis:string;fact_title:string|null;fact_description:string|null;time_label:string|null;start_year:number|null;end_year:number|null;review_evidence:string;checked_at:string;retrieved_at:string};
export type ArchiveDocentEvidence={status:'available'|'unavailable';scenes:StoryScene[];sources:Array<{id:string;institution:string;url:string;retrievedAt:string}>;limitations:string[]};

/** Reads only the current, actively reviewed D1 passage version for a dong/district.
 * Region tags are context only; this query never treats them as a parcel/building match.
 */
export async function readArchiveDocentEvidence(db:D1Database|undefined,district:string,dong:string):Promise<ArchiveDocentEvidence>{
  if(!db)return {status:'unavailable',scenes:[],sources:[],limitations:['D1 역사자료 DB 연결이 없어 검토 완료 본문을 조회하지 못했습니다.']};
  try {
    const rows=(await db.prepare(`SELECT p.id,p.text,p.locator,p.text_kind,s.title,s.institution,s.url,pr.label,r.level,pr.relation,pr.basis,
      (SELECT f.title FROM archive_facts f WHERE f.passage_id=p.id AND f.review_status='content_checked' ORDER BY f.id LIMIT 1) AS fact_title,
      (SELECT f.description FROM archive_facts f WHERE f.passage_id=p.id AND f.review_status='content_checked' ORDER BY f.id LIMIT 1) AS fact_description,
      (SELECT f.time_label FROM archive_facts f WHERE f.passage_id=p.id AND f.review_status='content_checked' ORDER BY f.id LIMIT 1) AS time_label,
      (SELECT f.start_year FROM archive_facts f WHERE f.passage_id=p.id AND f.review_status='content_checked' ORDER BY f.id LIMIT 1) AS start_year,
      (SELECT f.end_year FROM archive_facts f WHERE f.passage_id=p.id AND f.review_status='content_checked' ORDER BY f.id LIMIT 1) AS end_year,
      rv.evidence AS review_evidence,rv.checked_at,pv.retrieved_at
      FROM archive_passages p
      JOIN archive_sources s ON s.id=p.source_id
      JOIN archive_versions pv ON pv.id=p.version_id AND pv.source_id=p.source_id
      JOIN archive_passage_regions pr ON pr.passage_id=p.id
      JOIN archive_regions r ON r.id=pr.region_id
      JOIN archive_passage_reviews rv ON rv.passage_id=p.id AND rv.revision=(SELECT max(latest.revision) FROM archive_passage_reviews latest WHERE latest.passage_id=p.id)
      WHERE s.review_status='content_checked' AND p.review_status='content_checked'
      AND ${currentPassageSql} AND ${activePassageReviewSql}
      AND (p.text_kind='paraphrase' OR s.reuse_allowed=1)
      AND ((r.level='district' AND r.name=? AND pr.relation='district_context')
        OR (r.level='legal_dong' AND r.name=? AND r.parent_id=(SELECT id FROM archive_regions WHERE level='district' AND name=? LIMIT 1) AND pr.relation='exact_name'))
      ORDER BY coalesce((SELECT f.start_year FROM archive_facts f WHERE f.passage_id=p.id AND f.review_status='content_checked' ORDER BY f.id LIMIT 1),9999),p.id LIMIT 30`)
      .bind(district,dong,district).all<ArchiveRow>()).results||[];
    const scenes:StoryScene[]=rows.map(row=>{
      let review:Record<string,unknown>={};try{review=JSON.parse(row.review_evidence||'{}');}catch{/* a malformed review is not copied into user output */}
      const year=Number.isInteger(row.start_year)?row.start_year:historicalDate({'역사적대상시기':row.time_label||''}).year;
      const date=row.time_label||'시기 미상';
      const title=(row.fact_title||row.title||'검토 완료 지역 기록').replace(/\s+/g,' ').slice(0,180);
      const text=(row.fact_description||row.text||'').replace(/\s+/g,' ').trim().slice(0,700);
      return {id:`d1:${row.id}`,kind:'document',date,year,order:year?year*10000:Number.POSITIVE_INFINITY,title,text,scope:row.level==='district'?'district':'dong',photos:[],cutCount:0,evidence:[{title:row.title,url:row.url,institution:row.institution,locator:row.locator,note:typeof review.scopeNote==='string'?review.scopeNote:`${row.label} · ${row.basis} · 지역 맥락 자료`}]} as StoryScene;
    }).filter(scene=>scene.text.length>0);
    const sources=[...new Map(rows.map(row=>[row.id,{id:`d1:${row.id}`,institution:row.institution,url:row.url,retrievedAt:row.retrieved_at}])).values()];
    return {status:'available',scenes,sources,limitations:scenes.length?['D1 기록은 검토 당시 분류된 동네·자치구 범위 자료이며 개별 건물·필지의 동일성을 뜻하지 않습니다.']:['현재 지역에 검토 완료 상태로 연결된 D1 본문이 없습니다.']};
  } catch {
    return {status:'unavailable',scenes:[],sources:[],limitations:['D1 검토 본문 조회에 실패해 로컬 역사자료만 반환했습니다.']};
  }
}

export function mergeArchiveDocentEvidence(story:DocentStory,evidence:ArchiveDocentEvidence):DocentStory {
  if(!evidence.scenes.length)return story;
  const scenes=[...story.scenes,...evidence.scenes].sort((a,b)=>a.order-b.order||a.id.localeCompare(b.id));
  return {...story,scenes,total:scenes.length,version:`${story.version}+d1-reviewed`};
}
