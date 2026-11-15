'use client';

import {useEffect, useMemo, useState} from 'react';
import {ArrowLeft, ArrowUpRight, Download, FileText, Image as ImageIcon, Info, Loader2, Search} from 'lucide-react';

type Dataset = {id:string;district:string;kind:'articles'|'photos';file:string;url:string;originalName:string;sourceFolder:string;encoding:'utf-8'|'euc-kr';rowCount:number;columns:string[];sizeBytes:number;compressedSizeBytes:number;sha256:string;classificationNote?:string};
export type Manifest = {id:string;importedOn:string;districts:string[];totals:{districts:number;files:number;articles:number;photos:number};files:Dataset[];note:string};
type CsvRecord = {values:string[];index:number};

function parseCsv(text:string):CsvRecord[]{
  const rows:string[][]=[];let row:string[]=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++){
    const char=text[i];
    if(quoted){if(char==='"'&&text[i+1]==='"'){cell+='"';i++;}else if(char==='"')quoted=false;else cell+=char;}
    else if(char==='"'&&cell==='')quoted=true;
    else if(char===','){row.push(cell);cell='';}
    else if(char==='\n'||char==='\r'){if(char==='\r'&&text[i+1]==='\n')i++;row.push(cell);cell='';if(row.some(value=>value!==''))rows.push(row);row=[];}
    else cell+=char;
  }
  if(cell||row.length){row.push(cell);if(row.some(value=>value!==''))rows.push(row);}
  const headers=(rows.shift()||[]).map((value,index)=>index===0?value.replace(/^\uFEFF/,''):value);
  const used=new Map<string,number>();
  const uniqueHeaders=headers.map(header=>{const count=(used.get(header)||0)+1;used.set(header,count);return count===1?header:`${header}__${count}`;});
  return rows.map((values,index)=>({index:index+1,values:uniqueHeaders.map((_,column)=>values[column]||'')}));
}
const normalize=(value:string)=>value.normalize('NFKC').toLocaleLowerCase('ko').replace(/[^\p{L}\p{N}]/gu,'');
function value(record:CsvRecord,dataset:Dataset,aliases:string[]){
  const keys=aliases.map(normalize);const index=dataset.columns.findIndex(column=>keys.includes(normalize(column)));
  return index>=0?(record.values[index]||'').trim():'';
}
function externalUrl(raw:string){
  const match=raw.trim().match(/^https?:\/\/[^\s<>"']+/i);if(!match)return null;
  try{const url=new URL(match[0]);return url.username||url.password?null:url.href;}catch{return null;}
}
const articleTitle=['article_title','original_title','기사 원제목','기사_원제목','기사제목','제목','title'];
const photoTitle=['자료명','자료명·원제목','자료명·원제목','원문제목','자료제목','photo_title','original_title','제목','title'];
const articleDate=['publication_date','신문 발행일','신문_발행일','기사 발행일','발행일','published_date','published'];
const photoDate=['역사적대상시기','촬영시기(원문)','촬영시기','촬영일_원문표기','촬영연도','photo_date','period','촬영시기(원문표기)','자료시기(원표기)','날짜'];
const articleLocation=['확인된_장소','현재 법정동/지역','관련 동','related_location','현재 법정동','현재_법정동','현재지역','current_dong','current_region','current_location','현재주소','장소 관련 직접 근거','기사 내 장소 관련 직접 근거','장소_관련근거','historical_region'];
const photoLocation=['관련장소','현재 관련 장소','원문촬영장소','촬영장소','원문상 장소','장소명','법정동','동·권역','동네·법정동','현재주소','현재 추정 주소','location_name','location'];
const articleSource=['신문사','언론사','publisher','newspaper','source_platform','자료 검색 플랫폼'];
const photoSource=['제공기관·채널','제작기관','발행기관','출처명','소장기관','원출처기관','원출처기관','소장·관리기관','소장기관·출처','자료원·원사이트','source_archive','source_organization','기관'];
const articleSummary=['독립 핵심요약','독립요약','기사 독립요약','기사_독립요약','독립 핵심 요약','article_summary','summary','기사와 사건 연결 메모','기사와 사건 연결메모','확인된 장소','기사 내 장소 관련 직접 근거'];
const photoSummary=['요약','내용설명','원문설명','원문기록·설명','photo_description','설명요약','사이트용캡션초안','확인가능한지형·시설'];
const articleStatus=['검증 상태 S0-S5','검증_상태','검증상태','원문 확인 여부','원문_확인_상태','verification_status','verification_grade','장소 검증 A1-A2-B-C','장소등급','장소검증등급'];
const photoStatus=['확인수준','원문확인수준','원문확인상태','자료검증상태','원출처검증단계','실제이미지직접열람','이미지직접열람','시각적내용확인상태','장소연결등급','위치등급','검증단계'];
const articleRights=['저작권/재사용','저작권_재사용','copyright_note','copyright_status','copyright_status','재사용_권한','저작권·재사용','저작권·재사용가능'];
const photoRights=['개별이용조건','이용조건','웹게시가능여부','사이트표시허용','사이트표시가능여부','화면캡처·썸네일허용여부','서비스 재사용허용여부','서비스재사용허용여부','저작권상태','권리상태','권리·라이선스','rights_check','copyright_status'];

export default function DistrictMediaResearch({manifest}:{manifest:Manifest}){
  const [district,setDistrict]=useState(manifest.districts[0]||'');
  const [kind,setKind]=useState<'articles'|'photos'>('articles');
  const [query,setQuery]=useState('');
  const [page,setPage]=useState(1);
  const [records,setRecords]=useState<CsvRecord[]>([]);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const dataset=manifest.files.find(file=>file.district===district&&file.kind===kind);
  const pageSize=30;

  useEffect(()=>{setPage(1);setQuery('');},[district,kind]);
  useEffect(()=>{
    if(!dataset){setRecords([]);setError('');setLoading(false);return;}
    const controller=new AbortController();setLoading(true);setError('');
    fetch(dataset.url,{signal:controller.signal}).then(async response=>{if(!response.ok)throw new Error('자료 파일을 불러오지 못했습니다.');if(!('DecompressionStream' in window))throw new Error('이 브라우저는 압축 CSV 열기를 지원하지 않습니다. 최신 브라우저에서 다시 열어 주세요.');const compressed=new Blob([await response.arrayBuffer()]);const bytes=await new Response(compressed.stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();return new TextDecoder(dataset.encoding).decode(bytes);})
      .then(text=>{if(!controller.signal.aborted)setRecords(parseCsv(text));})
      .catch(reason=>{if(!controller.signal.aborted){setRecords([]);setError(reason instanceof Error?reason.message:'자료를 불러오지 못했습니다.');}})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[dataset?.id,dataset?.url]);

  const filtered=useMemo(()=>{
    const terms=normalize(query.trim());if(!terms)return records;
    return records.filter(record=>normalize(record.values.join(' ')).includes(terms));
  },[records,query]);
  const pages=Math.max(1,Math.ceil(filtered.length/pageSize));
  const visible=filtered.slice((page-1)*pageSize,page*pageSize);

  return <main className="district-media-page">
    <header className="district-media-top"><a href="/archive"><ArrowLeft size={16}/>자료실로</a><span>서울 장소 도슨트</span><span>구별 수집 조사자료</span></header>
    <section className="district-media-hero"><div className="eyebrow"><FileText size={15}/>DISTRICT RESEARCH COLLECTION</div><h1>구별 사진·기사<br/><em>조사자료 모아보기.</em></h1><p>제공된 CSV 원문을 구와 자료 종류별로 살펴보고, 제목·장소·시기·검토 표기를 검색합니다.</p></section>
    <section className="district-media-note"><Info size={17}/><p>{manifest.note} 이 목록은 장소별 도슨트 설명에 자동 사용되지 않습니다. 미리보기 이미지를 복사하지 않으며, 원문·이용조건은 각 제공처에서 확인해야 합니다.</p></section>
    <section className="district-media-controls" aria-label="자료 필터">
      <label>자치구<select value={district} onChange={event=>setDistrict(event.target.value)}>{manifest.districts.map(name=><option key={name} value={name}>{name}</option>)}</select></label>
      <label>자료 종류<select value={kind} onChange={event=>setKind(event.target.value as 'articles'|'photos')}><option value="articles">기사</option><option value="photos">사진·지도</option></select></label>
      <label className="district-media-search"><span>목록 검색</span><div><Search size={16}/><input value={query} onChange={event=>{setQuery(event.target.value);setPage(1);}} placeholder="제목, 장소, 시기, 기관 검색"/></div></label>
    </section>
    <section className="district-media-results" aria-live="polite" aria-busy={loading}>
      {dataset?<div className="district-media-results-head"><div><h2>{district} · {kind==='articles'?'기사':'사진·지도'} 자료</h2><p>{dataset.rowCount.toLocaleString('ko-KR')}행 · 원본 {Math.ceil(dataset.sizeBytes/1024).toLocaleString('ko-KR')}KB (압축 {Math.ceil(dataset.compressedSizeBytes/1024).toLocaleString('ko-KR')}KB) · {dataset.encoding.toUpperCase()} · 파일명 {dataset.originalName}</p></div><a href={dataset.url} download={dataset.file}><Download size={15}/>압축 원본 CSV</a></div>:<div className="district-media-missing"><ImageIcon size={23}/><p>{district} 사진·지도 CSV를 찾을 수 없습니다. 제공된 자료 묶음에 해당 자료가 있는지 확인해 주세요.</p></div>}
      {dataset?.classificationNote&&<p className="district-media-classification">{dataset.classificationNote}</p>}
      {loading?<p className="district-media-state"><Loader2 size={16} className="spin"/>자료를 불러오고 있습니다.</p>:error?<p className="district-media-state" role="alert">{error}</p>:dataset&&<>
        <p className="district-media-count">검색 결과 {filtered.length.toLocaleString('ko-KR')}건 · {page}/{pages}페이지</p>
        {visible.length?visible.map(record=>{
          const title=value(record,dataset,kind==='articles'?articleTitle:photoTitle)||`${kind==='articles'?'기사':'자료'} ${record.index}`;
          const source=value(record,dataset,kind==='articles'?articleSource:photoSource);
          const date=value(record,dataset,kind==='articles'?articleDate:photoDate);
          const location=value(record,dataset,kind==='articles'?articleLocation:photoLocation);
          const summary=value(record,dataset,kind==='articles'?articleSummary:photoSummary);
          const status=value(record,dataset,kind==='articles'?articleStatus:photoStatus);
          const rights=value(record,dataset,kind==='articles'?articleRights:photoRights);
          const mainUrl=value(record,dataset,kind==='articles'?['원문_URL','기사 원문 URL','기사_원문_URL','원문URL','original_url','출처URL','원문 URL']:['원문URL','원문_URL','원문상세URL','원문 상세 URL','source_page_url','original_detail_url','출처URL']);
          const secondUrl=value(record,dataset,kind==='articles'?['지면_URL','신문 지면 URL','신문 지면 URL','신문_지면_URL','지면/면수 URL','page_url']:['원자료URL','원본자료URL','원자료_URL','원본파일URL','원본이미지URL','미리보기URL','preview_url']);
          const links=[...new Set([mainUrl,secondUrl].map(externalUrl).filter((url):url is string=>!!url))];
          return <article className="district-media-record" key={`${dataset.id}-${record.index}`}>
            <div className="district-media-record-heading"><span>{kind==='articles'?'기사':'사진·지도'} · 원본 행 {record.index}</span>{date&&<time>{date}</time>}</div>
            <h3>{title}</h3>
            <dl>{source&&<div><dt>{kind==='articles'?'언론사·플랫폼':'제공기관·출처'}</dt><dd>{source}</dd></div>}{location&&<div><dt>장소 표기</dt><dd>{location}</dd></div>}{status&&<div><dt>검토·확인 표기</dt><dd>{status}</dd></div>}{rights&&<div><dt>권리·이용조건 표기</dt><dd>{rights}</dd></div>}</dl>
            {summary&&<p className="district-media-summary">{summary}</p>}
            <details><summary>원본 행 전체 보기 · {dataset.columns.length}개 열</summary><dl className="district-media-full">{dataset.columns.map((column,index)=>{const cell=record.values[index]||'';if(!cell)return null;const link=externalUrl(cell);return <div key={`${index}-${column}`}><dt>{column}</dt><dd>{link?<a href={link} target="_blank" rel="noopener noreferrer">{cell}<ArrowUpRight size={12}/></a>:cell}</dd></div>;})}</dl></details>
            {!!links.length&&<div className="district-media-links">{links.map((link,index)=><a key={link} href={link} target="_blank" rel="noopener noreferrer">{index===0?'원문 페이지 열기':'관련 원문 열기'}<ArrowUpRight size={13}/></a>)}</div>}
          </article>;
        }):<p className="district-media-state">검색어와 일치하는 자료가 없습니다.</p>}
        {filtered.length>pageSize&&<nav className="district-media-pagination" aria-label="조사자료 페이지"><button type="button" onClick={()=>setPage(number=>Math.max(1,number-1))} disabled={page<=1}>이전</button><span>{page} / {pages}</span><button type="button" onClick={()=>setPage(number=>Math.min(pages,number+1))} disabled={page>=pages}>다음</button></nav>}
      </>}
    </section>
    <footer className="district-media-footer"><a href="/archive/photo-research">통합 사진·지도 조사자료 보기<ArrowUpRight size={13}/></a><a href="/archive/document-research">문헌 조사자료 보기<ArrowUpRight size={13}/></a><span>제공된 행의 원문 표기와 이용조건을 별도로 확인해 주세요.</span></footer>
  </main>;
}
