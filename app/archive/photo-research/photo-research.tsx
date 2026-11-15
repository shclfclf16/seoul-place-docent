'use client';
import {useEffect, useMemo, useState} from 'react';
import {ArrowLeft, ArrowUpRight, Camera, ChevronLeft, ChevronRight, Download, FileText, Info, Link2, Loader2, MapPin, Search, X} from 'lucide-react';
import PhotoPreview from '@/app/components/PhotoPreview';
import {photoResearchCredit, photoProviderLabels, photoResearchText, photoResearchThumbnail, photoResearchUrl, type PhotoResearchFilters, type PhotoResearchItem, type PhotoResearchMeta} from '@/lib/photo-research';
import IntegratedResearchPanel from './integrated-research-panel';
import DistrictMediaResearch, {type Manifest} from '../district-media/district-media-research';

type View = PhotoResearchFilters & {page: number};
type Results = {total: number; page: number; pageSize: number; rows: PhotoResearchItem[]; sourceUrlCount: number; candidateCount: number};
const num = (n: number) => n.toLocaleString('ko-KR');
function External({value, children}: {value: string; children?: React.ReactNode}) {
  const url = photoResearchUrl(value);
  return url ? <a href={url} target="_blank" rel="noopener noreferrer">{children || value}<ArrowUpRight size={13}/></a> : <>{value}</>;
}
export default function PhotoResearch({meta,districtMedia}: {meta: PhotoResearchMeta; districtMedia: Manifest}) {
  const [view, setView] = useState<View>({page: 1});
  const [ready, setReady] = useState(false);
  const [data, setData] = useState<Results | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const batch = meta.files.find(f => f.id === p.get('batch'));
    setView({page: Math.max(1, Number(p.get('page')) || 1), query: p.get('q') || '', district: batch?.district || p.get('district') || '',
      batch: batch?.id || '', dong: p.get('dong') || '', target: p.get('target') || '', provider: p.get('provider') || '', scope: p.get('scope') || '', review: p.get('review') || '',
      id: p.get('id') || '', source: p.get('source') || '', recordType: p.get('type') || '', mediaType: p.get('media') || '', previewOnly: p.get('preview') === '1', repeatsOnly: p.get('repeats') === '1', conflictsOnly: p.get('conflicts') === '1'});
    setReady(true);
  }, [meta]);
  const query = useMemo(() => {
    const p = new URLSearchParams({page: String(view.page)});
    for (const [key, value] of Object.entries({q: view.query, district: view.district, batch: view.batch, provider: view.provider,
      scope: view.scope, review: view.review, dong: view.dong, target: view.target, id: view.id, source: view.source, type: view.recordType, media: view.mediaType, preview: view.previewOnly ? '1' : '', repeats: view.repeatsOnly ? '1' : '', conflicts: view.conflictsOnly ? '1' : ''})) if (value) p.set(key, value);
    return p.toString();
  }, [view]);
  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController(); setLoading(true); setError('');
    const timer = setTimeout(() => {
      window.history.replaceState({}, '', '/archive/photo-research?' + query);
      fetch('/api/archive/photo-research?' + query, {signal: controller.signal}).then(async response => {
        const result = await response.json() as Results & {error?: string};
        if (!response.ok) throw new Error(result.error || '사진 조사자료를 불러오지 못했습니다.');
        if (!controller.signal.aborted) setData(result);
      }).catch(e => {if (!controller.signal.aborted) setError(e instanceof Error ? e.message : '사진 조사자료를 불러오지 못했습니다.');})
        .finally(() => {if (!controller.signal.aborted) setLoading(false);});
    }, 200);
    return () => {clearTimeout(timer); controller.abort();};
  }, [query, ready, refresh]);
  function change(patch: Partial<View>) {setView(previous => ({...previous, ...patch, page: 1}));}
  const batches = meta.files.filter(f => f.collectionScope === 'city' || !view.district || f.district === view.district);
  const dongs = (meta.places || []).filter(place => !view.district || place.district === view.district);
  const activeBatch = meta.files.find(f => f.id === view.batch);
  const pages = Math.max(1, Math.ceil((data?.total || 0) / 20));
  function fields(item: PhotoResearchItem, names: string[]) {
    return <dl className="photo-definition">{names.map(name => <div key={name}><dt>{name}</dt><dd>{photoResearchText(item.values[name] || '빈 값')}</dd></div>)}</dl>;
  }
  function itemCard(item: PhotoResearchItem) {
    const r = item.values;
    return <article className="photo-card" key={item.id}>
      <div className="photo-card-top"><span><MapPin size={13}/>{item.district || '서울 전역'} · {item.dong || (item.collectionScope === 'city' ? '서울 전체' : '자치구 단위')} 조사</span></div>
      <div className="photo-title"><Camera size={24} strokeWidth={1.3}/><h3>{r['자료명']}</h3></div>
      {photoResearchThumbnail(item) && <><PhotoPreview key={item.id} item={item}/><p className="photo-note">{photoResearchCredit(item)}<br/>{photoResearchText(r['이용조건'] || '이용조건은 원문에서 확인하세요.')}</p></>}
      <div className="photo-identifiers"><code>{item.id}</code><span>{photoProviderLabels[item.provider] || item.provider}</span><span>{item.mediaType}</span></div>
      {item.collectionScope === 'district' && <p className="photo-location-note">자치구 단위 조사묶음입니다. 특정 법정동·건물·필지와의 일치는 미검증이며, 원문 장소 표기를 함께 확인해 주세요.</p>}
      {item.previousIds?.map(id => <p className="photo-location-note" key={id}>이전 ID {id}에서 현재 ID로 변경된 자료입니다.</p>)}
      {item.correctionOf && <p className="photo-location-note">원래 카드 <a href={'/archive/photo-research?id=' + encodeURIComponent(item.correctionOf)}>{item.correctionOf}</a>의 정정 행입니다. 두 기록의 내용을 함께 확인해 주세요.</p>}
      {item.correctionIds.map(id => <p className="photo-location-note" key={id}>이 카드의 <a href={'/archive/photo-research?id=' + encodeURIComponent(id)}>정정 기록 {id}</a>이 있습니다.</p>)}
      {r['자치구'].normalize('NFKC').split('(')[0].trim() !== item.district && <p className="photo-location-note">자료의 자치구는 {r['자치구']}이며, {item.district} {item.dong}의 주변 기록으로 수록했습니다. 원문 장소와 주소 관계 근거를 함께 확인해 주세요.</p>}
      <dl className="photo-dates"><div><dt>{item.recordType === 'building' ? '사실의 시기 표기' : '촬영·제작일 표기'}</dt><dd>{item.recordType === 'building' ? r['사실의 시기'] || '미기재' : r['촬영·제작일'] || '미기재'}</dd></div><div><dt>역사적 대상 시기</dt><dd>{r['역사적대상시기'] || '미기재'}</dd></div></dl>
      {item.importWarnings?.map(note => <p className="photo-location-note" key={note}><b>자료 확인사항: </b>{note}</p>)}
      {item.metadataWarnings?.map(note => <p className="photo-location-note" key={note}><b>날짜 해석 주의: </b>{note}</p>)}
      <div className="photo-caption"><span>{item.recordType === 'building' ? '건물 역사 카드 · 제공 자료' : '장면 설명 · 제공 자료'}</span><p>{photoResearchText(r['사이트용캡션초안'] || r['내용설명'] || '')}</p></div>
      <div className="photo-relation"><span>{item.scope}</span><span>{item.relation}</span>{item.conflictMentioned && <span className="photo-issue">추가사항에 상충 언급</span>}</div>
      <p className="photo-location-note">{r['주소관계근거']}</p>
      <div className="photo-actions">{item.sourceUrl ? <External value={item.sourceUrl}>{item.sourceLinkType === 'portal' ? '제공기관 검색 열기' : item.sourceLinkType === 'collection' ? '기관 컬렉션 열기' : '자료 원문 열기'}</External> : <span>원문 URL 미확인</span>}{item.previewUrl && <External value={item.previewUrl}>공개 미리보기 열기</External>}</div>
      {item.sourceLinkType === 'portal' && <p className="photo-note">기관의 검색·목록 진입 주소입니다. 개별 사진의 고정 상세 URL과 구분합니다.</p>}
      {item.sourceLinkType === 'collection' && <p className="photo-note">여러 자료가 수록된 기관 컬렉션 주소입니다. 개별 사진·이미지를 확인한 것으로 보지 않습니다. 기관자료ID: {r['기관자료ID'] || '미기재'}</p>}
      {item.sameSourceCount > 1 && <button type="button" className="photo-same-source" onClick={() => {setView({page: 1, source: item.sourceKey}); document.getElementById('photo-results')?.scrollIntoView({behavior: 'smooth', block: 'start'});}}><Link2 size={13}/>같은 {item.sourceLinkType === 'portal' ? '검색·목록' : '원문'} URL의 조사 항목 {item.sameSourceCount}건<ChevronRight size={12}/></button>}
      {item.regionLinks && <details className="photo-detail"><summary>지역 연결 근거 {item.regionLinks.length}건 · 개별 주소 일치 미검증</summary><div className="photo-region-links">{item.regionLinks.map(link => <div key={link['연결ID']}><a href={'/archive/photo-research?target=' + encodeURIComponent(link['대상ID'])}>{[link['자치구'], link['법정동']].filter(Boolean).join(' ') || '서울 전체'}의 연결 자료 보기</a><code>{link['연결ID']} · {link['대상ID']} · {link['법정동코드']}</code><p>{link['연결근거']}</p><p>{link['공간범위']} · 주소관계 {link['주소관계상태']} · {photoResearchText(link['검토상태'] || '')}</p><p>근거: <External value={link['연결근거URL']}/></p></div>)}</div></details>}
      {item.regionLinks && <details className="photo-detail"><summary>과거 지명·원문 및 시각적 내용 확인 상태</summary>{fields(item, ['과거지명', '원문확인근거', '원출처확인상태', '시각적내용확인상태', '역사적시기근거', '공간판단근거', '지도·도면축척', '지도·도면방위', '페이지·도판번호'])}</details>}
      <details className="photo-detail"><summary>장소 관계·관찰·확인사항</summary>{fields(item, ['자치구', '원문장소표기', '관련주소ID', '촬영방향·위치', '확인가능한지형·시설', '원문설명과조사자관찰구분', '비교가능한현재대상', '추가확인사항'])}</details>
      {item.recordType === 'building' && <details className="photo-detail"><summary>건물 역사·원문 근거·상충 및 주의</summary>{fields(item, ['건물유형', '확인된 사실(원문 근거)', '사실의 시기', '상충·주의'])}</details>}
      <details className="photo-detail"><summary>이용조건·출처·파일 확보 상태</summary><p className="photo-note">아래 내용은 첨부 CSV의 표기입니다. 공개 링크와 사이트 복제·재사용 허락은 구분합니다.</p>{fields(item, ['이용조건', '이용조건확인내용', '원본보관가능여부', '사이트표시가능여부', '썸네일표시가능여부', '임베드가능여부', '변형이용가능여부', '필수출처표시문구', '파일확보상태', '확인일'])}<p className="photo-note">이용조건 근거: <External value={r['이용조건근거URL']}/></p></details>
      <details className="photo-detail"><summary>원본 CSV 항목 전체 보기</summary><p className="photo-note">{meta.files.find(f => f.id === item.batchId)?.filename} · {item.dataRow}번째 데이터 행</p><dl className="photo-definition">{Object.entries(r).map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{photoResearchUrl(value) ? <External value={value}/> : photoResearchText(value || '빈 값')}</dd></div>)}</dl></details>
    </article>;
  }
  return <main className="photo-page">
    <a className="skip-link" href="#photo-content">본문으로 건너뛰기</a>
    <header className="photo-top"><a href="/"><ArrowLeft size={15}/>장소 탐색</a><a href="/" className="photo-brand">서울 <b>장소 도슨트</b></a><a href="/archive">역사자료 DB<ArrowUpRight size={14}/></a></header>
    <section className="photo-hero" id="photo-content"><div><span className="photo-eyebrow"><Camera size={16}/>사진·지도·영상·건물 조사자료</span><h1>도시의 장면과 장소를,<br/><em>출처에서 찾아보다.</em></h1><p>{meta.districtCount}개 자치구·{meta.dongCount}개 동의 지역 자료와 서울 전역 통합조사.<br/>옛 사진과 현재 모습, 지도와 건물 이력을 함께 탐색합니다.</p><small>첨부 자료 확인 {meta.dateRange.join(' ~ ')} · 홈페이지 반영 {meta.importedOn}</small></div><aside><Camera size={32} strokeWidth={1.2}/><span>장소 자료를 찾는 첫 단계</span><p>장면과 장소의 설명을 읽고,<br/>제공기관의 기록으로 이어집니다.</p><div><b>{meta.batchCount}</b><span>개 조사묶음 · {meta.districtCount}개 자치구</span></div></aside></section>
    <div className="photo-metrics">{([['전체 원본 행 (중복 대조 전)', meta.recordCount + districtMedia.totals.photos, `기존 ${num(meta.recordCount)}행 + 구별 CSV ${num(districtMedia.totals.photos)}행`], ['기존 정리 조사 항목', meta.recordCount, `시각자료 ${num(meta.visualRecordCount)}건 · 건물 카드 ${meta.buildingRecordCount}행`], ['구별 추가 사진·지도 CSV', districtMedia.totals.photos, '아래 보완 목록 · 기존 통합검색 수에는 별도 집계'], ['연결 가능한 원문 URL', meta.sourceUrlCount, '검색·목록·컬렉션 URL 포함'], ['공개 미리보기 링크', meta.previewLinkCount, '중복 링크 포함'], ['원문 미확인 후보', meta.candidateCount, '제공 자료의 검토 상태']] as const).map(([label, count, note]) => <div key={label}><span>{label}</span><b>{num(count)}<small>개</small></b><p>{note}</p></div>)}</div>
    <div className="photo-scope"><Info size={18}/><div><p>{meta.scopeNote}</p><p>제공기관의 공개 미리보기 사진을 직접 연결합니다. 사진을 누르면 사이트 안에서 확대되며, 자료별 출처와 이용조건을 함께 확인할 수 있습니다.</p></div></div>
    {meta.integratedResearch && <IntegratedResearchPanel summary={meta.integratedResearch} onBrowse={filters => {setView({page: 1, ...filters}); document.getElementById('photo-results')?.scrollIntoView({behavior: 'smooth', block: 'start'});}}/>}
    <details className="photo-files"><summary><FileText size={16}/>원본 CSV {new Set(meta.files.map(file => file.path)).size}개와 조사 범위<ChevronRight size={16}/></summary><div className="photo-file-grid">{meta.files.map(file => <div key={file.id}><button type="button" onClick={() => {setView({page: 1, district: file.district, batch: file.id}); document.getElementById('photo-results')?.scrollIntoView({behavior: 'smooth', block: 'start'});}}><span>{file.district || '서울 전역'}</span><b>{file.collectionScope === 'city' ? '서울 전역 통합조사' : file.dong || '자치구 단위 누적자료'}<ChevronRight size={14}/></b><small>시각자료 {file.visualRecordCount}건 · 건물 카드 {file.buildingRecordCount}행 · 미확인 후보 {file.candidateCount}건</small></button>{file.sourceNote && <p className="photo-note">{file.sourceNote.replace(/^#\s*/, '')}</p>}<a href={file.path} download={file.filename}><Download size={13}/>원본 CSV 내려받기</a><code title={file.sha256}>SHA-256 {file.sha256}</code></div>)}</div><p className="photo-files-note">원본 {num(meta.recordCount)}개 행을 보존했습니다. 건물 카드에는 정정 {meta.correctionCount}행이 포함됩니다. 여러 장면이 같은 컬렉션 URL을 사용할 수 있어 조사 항목 수와 고유 사진 수는 다릅니다. 원문 URL 미확인 {meta.missingSourceUrlCount}건 · 검색·목록 진입 URL 항목 {meta.portalLinkCount}건 · CSV 표기상 접근 불가 {meta.accessUnavailableCount}건입니다.</p></details>
    <section className="photo-filters" aria-label="사진 조사자료 검색"><label className="photo-search"><Search size={19}/><span className="sr-only">사진 조사자료 검색</span><input value={view.query || ''} onChange={e => change({query: e.target.value, id: ''})} placeholder="동네·옛 지명·시설·장면·연도·자료 ID 검색" maxLength={150}/></label><div className="photo-selects">
      <label>자치구<select value={view.district || ''} onChange={e => change({district: e.target.value, dong: '', target: '', batch: '', id: ''})}><option value="">모든 자치구</option>{(meta.districts || [...new Set(meta.files.map(f => f.district))]).map(gu => <option key={gu}>{gu}</option>)}</select></label>
      <label>법정동<select value={view.dong || ''} onChange={e => change({dong: e.target.value, target: '', id: ''})}><option value="">모든 법정동</option>{[...new Set(dongs.map(place => place.dong))].sort().map(dong => <option key={dong}>{dong}</option>)}</select></label>
      <label>조사 범위<select value={view.batch || ''} onChange={e => {const f = meta.files.find(f => f.id === e.target.value); change({batch: e.target.value, district: f?.district || view.district, dong: '', target: '', id: ''});}}><option value="">모든 조사묶음</option>{batches.map(f => <option key={f.id} value={f.id}>{f.collectionScope === 'city' ? '서울 전역 통합조사' : f.dong || f.district + ' 자치구 단위'} · {f.count}건</option>)}</select></label>
      <label>자료 구분<select value={view.recordType || ''} onChange={e => change({recordType: e.target.value, id: ''})}><option value="">전체 자료</option><option value="visual">시각자료</option><option value="building">건물 역사 카드</option></select></label>
      <label>매체 표기<select value={view.mediaType || ''} onChange={e => change({mediaType: e.target.value, id: ''})}><option value="">모든 매체</option>{meta.mediaTypes.map(media => <option key={media}>{media}</option>)}</select></label>
      <label>제공기관<select value={view.provider || ''} onChange={e => change({provider: e.target.value, id: ''})}><option value="">모든 제공기관</option>{meta.providers.map(provider => <option value={provider} key={provider}>{photoProviderLabels[provider] || provider}</option>)}<option value="원문 URL 미확인">원문 URL 미확인</option></select></label>
      <label>공간 범위<select value={view.scope || ''} onChange={e => change({scope: e.target.value, id: ''})}><option value="">모든 범위</option>{Object.keys(meta.scopeCounts).map(scope => <option key={scope}>{scope}</option>)}</select></label>
      <label>자료 표기 검토 상태<select value={view.review || ''} onChange={e => change({review: e.target.value, id: ''})}><option value="">모든 상태</option><option value="textChecked">원문 확인</option><option value="candidate">원문 미확인 후보</option></select></label>
    </div><div className="photo-checks"><label><input type="checkbox" checked={!!view.previewOnly} onChange={e => change({previewOnly: e.target.checked, id: ''})}/>미리보기 링크 있음</label><label><input type="checkbox" checked={!!view.repeatsOnly} onChange={e => change({repeatsOnly: e.target.checked, id: ''})}/>같은 원문 URL을 쓰는 항목</label><label><input type="checkbox" checked={!!view.conflictsOnly} onChange={e => change({conflictsOnly: e.target.checked, id: ''})}/>상충 언급 있음</label><button type="button" onClick={() => setView({page: 1})}>검색 초기화</button></div>{(view.id || view.source || view.target) && <div className="photo-current-ref"><span>{view.id || (view.target ? '조사대상 ' + view.target : '같은 원문 URL로 연결된 조사 항목')}</span><button type="button" aria-label="연결 탐색 해제" onClick={() => change({id: '', source: '', target: ''})}><X size={14}/></button></div>}</section>
    <section className="photo-results" id="photo-results" aria-busy={loading}><div className="photo-results-heading"><h2>{activeBatch ? (activeBatch.dong || activeBatch.district || '서울 전역 통합조사') + ' · ' : ''}조사목록 <span>{num(data?.total || 0)}건</span></h2><a href={'/api/archive/photo-research?' + query + '&download=1'}><Download size={14}/>현재 조건 JSON</a></div><p className="photo-list-note">{data ? `현재 조건의 접속 URL ${data.sourceUrlCount}개 · 원문 미확인 후보 ${data.candidateCount}건` : '제공기관의 자료 원문과 장소 관계를 함께 확인합니다.'} · 항목의 ‘확인’은 첨부 자료의 표기입니다.</p>{activeBatch?.sourceNote && <p className="photo-location-note">{activeBatch.sourceNote.replace(/^#\s*/, '')}</p>}
      {loading ? <div className="photo-empty" role="status"><Loader2 className="spin" size={24}/><p>사진 조사자료를 불러오는 중입니다.</p></div> : error ? <div className="photo-empty" role="alert"><Info size={24}/><p>{error}</p><button type="button" onClick={() => setRefresh(n => n + 1)}>다시 불러오기</button></div> : data?.rows.length ? <div className="photo-grid">{data.rows.map(itemCard)}</div> : <div className="photo-empty"><Search size={25}/><h3>조건에 맞는 조사 항목이 없습니다.</h3><p>이 동네에 사진 기록이 없다는 의미는 아닙니다. 다른 조건으로 확인해 보세요.</p><button type="button" onClick={() => setView({page: 1})}>전체 조사목록 보기</button></div>}
      {!loading && !error && <nav className="photo-pagination" aria-label="사진 조사목록 페이지"><span>{data?.total ? `${(data.page - 1) * 20 + 1}–${Math.min(data.page * 20, data.total)} / ${num(data.total)}건` : '0건'}</span><div><button type="button" disabled={(data?.page || 1) <= 1} onClick={() => setView(v => ({...v, page: (data?.page || 1) - 1}))}><ChevronLeft size={14}/>이전</button><span>{data?.page || 1} / {pages}</span><button type="button" disabled={(data?.page || 1) >= pages} onClick={() => setView(v => ({...v, page: (data?.page || 1) + 1}))}>다음<ChevronRight size={14}/></button></div></nav>}
    </section><DistrictMediaResearch manifest={districtMedia} mode="photos" embedded/><footer className="photo-footer"><a href="/archive/article-research">기사 조사자료<ArrowUpRight size={14}/></a><a href="/archive/document-research">문헌 조사자료<ArrowUpRight size={14}/></a><a href="/archive/video-research">영상 조사자료<ArrowUpRight size={14}/></a><span>서울 장소 도슨트 · 장면과 장소의 관계를 기록으로 확인합니다.</span></footer>
  </main>;
}
