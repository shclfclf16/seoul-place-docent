'use client';

import {useState} from 'react';
import type {FormEvent} from 'react';
import type {ClassroomRecordsResult, ClassroomRecord} from '@/lib/bigquery/classroom-records';
import './classroom-demo.css';

const museumBoardUrl = 'https://museum.seoul.go.kr/www/board/NR_boardView.do?bbsCd=1159&seq=20251104111521886&sso=ok&tr_code=sweb';
const museumImageUrl = 'https://museum.seoul.go.kr/upload/ckeditor/2025/11/4/6aeccc57-e9b8-419e-acd1-d39a1c0f1e74.jpg';

function relationLabel(record: ClassroomRecord) {
  if (record.relationType === 'EXACT_SITE') return '부지 직접 연관 후보 · 일치 검토 대기';
  if (record.relationType === 'NEARBY') return '인접 장소 후보 · 위치 검토 대기';
  if (record.relationType === 'DISTRICT_CONTEXT') return '동네 배경자료 · 개별 건물과 구분';
  if (record.relationType) return `${record.relationType} · 검토 중`;
  return '자료-장소 관계 미등록';
}

function yearLabel(record: ClassroomRecord) {
  const start = record.subjectStartYear ?? record.createdYear;
  if (start === null) return '대상 시기 미확인';
  return record.subjectEndYear && record.subjectEndYear !== start
    ? `${start}–${record.subjectEndYear}년`
    : `${start}년`;
}

export default function ClassroomDemoPage() {
  const [token, setToken] = useState('');
  const [authenticated, setAuthenticated] = useState(false);
  const [result, setResult] = useState<Extract<ClassroomRecordsResult, {status: 'ok'}> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function loadRecords() {
    const response = await fetch('/api/classroom-demo/records', {cache: 'no-store'});
    const body = await response.json() as ClassroomRecordsResult & {error?: string};
    if (!response.ok || body.status !== 'ok') throw new Error(body.error || ('code' in body ? body.code : '자료를 불러오지 못했습니다.'));
    setResult(body);
    setAuthenticated(true);
  }

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(''); setResult(null);
    try {
      const response = await fetch('/api/classroom-demo/session', {
        method: 'POST', cache: 'no-store', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({token}),
      });
      const body = await response.json() as {error?: string};
      if (!response.ok) throw new Error(body.error || '수업용 인증에 실패했습니다.');
      setToken('');
      await loadRecords();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '수업용 자료를 불러오지 못했습니다.');
    } finally { setBusy(false); }
  }

  async function signOut() {
    setBusy(true);
    try { await fetch('/api/classroom-demo/session', {method: 'DELETE', cache: 'no-store'}); }
    finally { setResult(null); setAuthenticated(false); setToken(''); setError(''); setBusy(false); }
  }

  const danginPhoto = result?.records.find(record => record.recordId === 'DANGIN-C03');

  return <main className="classroom-demo">
    <header className="classroom-header">
      <a href="/" className="classroom-back">← 서울 장소 도슨트</a>
      <span>Preview · 수업 관계자 전용 시연</span>
    </header>
    <section className="classroom-intro">
      <p className="classroom-kicker">CLASSROOM DEMO / REVIEW MATERIALS</p>
      <h1>서울 역사 도슨트<br/>수업용 자료 시연</h1>
      <p>BigQuery에 수집된 자료 메타데이터와 자료-장소 연결 검토 상태를 보여줍니다. 이 화면의 자료는 검토 중이며, 공개 승인이나 역사적 사실 확정을 뜻하지 않습니다.</p>
    </section>

    {!authenticated && <section className="classroom-lock">
      <h2>수업용 인증</h2>
      <p>수업 담당자가 전달한 수업용 인증키를 입력해 주세요. 키는 서버에서 확인한 뒤 이 화면의 메모리에서 지우며, 서버는 짧은 시간의 HttpOnly 세션 쿠키만 사용합니다.</p>
      <form onSubmit={signIn}>
        <label htmlFor="classroom-token">수업용 인증키</label>
        <input id="classroom-token" type="password" autoComplete="off" value={token} onChange={event => setToken(event.target.value)} required />
        <button type="submit" disabled={busy || !token}>{busy ? '확인 중…' : '자료 열기'}</button>
      </form>
    </section>}

    {error && <p className="classroom-error" role="alert">{error}</p>}

    {authenticated && result && <>
      <section className="classroom-toolbar">
        <div><strong>수업용 검토 자료</strong><span>BigQuery 조회 위치: {result.location} · 자료 {result.records.length}건</span></div>
        <div><button type="button" onClick={() => {setBusy(true);setError('');void loadRecords().catch(cause => setError(cause instanceof Error ? cause.message : '조회 실패')).finally(() => setBusy(false));}} disabled={busy}>{busy ? '조회 중…' : '새로고침'}</button><button type="button" onClick={() => void signOut()} disabled={busy}>잠그기</button></div>
      </section>

      <section className="classroom-notice" role="note">
        <b>자료 검토 중</b>
        <span>자료가 연결된 지역·건물과 직접 일치한다고 단정하지 않습니다. 검토 상태를 바꾸거나 공개 검색에 포함하지 않습니다.</span>
      </section>

      {danginPhoto && <section className="classroom-photo-feature">
        <div className="classroom-photo-copy">
          <p className="classroom-kicker">첫 시연 자료 · {danginPhoto.recordId}</p>
          <h2>{danginPhoto.title}</h2>
          <p>{yearLabel(danginPhoto)} · {danginPhoto.institution}</p>
          <p className="classroom-muted">자료의 연결 범위는 당인리발전소 부지 내부가 아닌 당인동 일대의 배경 후보입니다. 사진 위치는 확인 전이며, 부지 직접 촬영으로 표현하지 않습니다.</p>
          <div className="classroom-links">
            <a href={museumBoardUrl} target="_blank" rel="noopener noreferrer">서울역사박물관 원문 보기 ↗</a>
            <a href={museumImageUrl} target="_blank" rel="noopener noreferrer">박물관 게시 JPG 보기 ↗</a>
          </div>
        </div>
        {result.imageEmbedEnabled
          ? <figure className="classroom-photo"><img src={museumImageUrl} alt="서울역사박물관 게시 이미지. 사진 두 장이 함께 수록되어 있으며, 오른쪽 사진이 당인리발전소 관련 사진입니다."/><figcaption>서울역사박물관 게시 이미지 전체입니다. 사진 두 장이 함께 수록되어 있고 오른쪽이 당인리발전소 관련 사진으로 소개됩니다. 독립된 사진 원본이 아닙니다.</figcaption></figure>
          : <div className="classroom-photo-placeholder"><span>이미지 미리보기 꺼짐</span><p>이미지 이용 범위를 확인하고 별도 승인하기 전까지 원문 링크만 제공합니다.</p></div>}
      </section>}

      <section className="classroom-records">
        <div className="classroom-section-heading"><div><p className="classroom-kicker">BIGQUERY CATALOG</p><h2>당인리 관련 자료 후보</h2></div><span>{result.records.length}건</span></div>
        {result.records.length === 0 ? <p className="classroom-empty">현재 조건에 맞는 자료가 없습니다.</p> : result.records.map(record => <article className="classroom-record" key={`${record.recordId}:${record.relationType}`}>
          <div className="classroom-record-top"><span>{record.recordId} · {record.recordType || '유형 미분류'}</span><span>{yearLabel(record)}</span></div>
          <h3>{record.title || '제목 미확인'}</h3>
          <p className="classroom-institution">{record.institution || '제공기관 미확인'}</p>
          <div className="classroom-badges"><span>자료: {record.reviewStatus || '상태 미확인'}</span><span>위치: {record.locationReviewStatus || '상태 미확인'}</span><span>연결: {record.linkReviewStatus || '상태 미확인'}</span></div>
          <p className="classroom-relation"><b>{relationLabel(record)}</b>{record.relationEvidence && <span>{record.relationEvidence}</span>}</p>
          {record.placeName && <p className="classroom-place">연결 후보: {record.placeName}{record.district ? ` · ${record.district}` : ''}{record.legalDong ? ` ${record.legalDong}` : ''}</p>}
          {record.recordId === 'DANGIN-C03' && <p className="classroom-rights">이미지 이용조건: {record.rightsStatus || '미확인'} · 중복 확인: {record.duplicateStatus || '미확인'}</p>}
          <a className="classroom-source" href={record.sourceUrl} target="_blank" rel="noopener noreferrer">원문 링크 열기 ↗</a>
        </article>)}
      </section>
      <p className="classroom-footnote">이 페이지는 수업용 내부 검토 기능입니다. 일반 홈페이지와 공개 MCP는 기존 승인 자료 필터를 계속 사용합니다.</p>
    </>}
  </main>;
}
