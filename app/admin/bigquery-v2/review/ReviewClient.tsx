'use client';
import { useCallback, useEffect, useState } from 'react';
type C = {
    recordId: string;
    title: string;
    recordType: string;
    year: number | null;
    institution: string;
    sourceUrl: string | null;
    placeId: string;
    placeName: string;
    district: string;
    legalDong: string;
    relationType: string;
    relationScope: string;
    candidateLabel: string;
    diagnostics: {
        linkRowNumber: number;
        duplicateLinkCount: number;
        emptyPlaceId: boolean;
        auditState: string;
    };
    integrity: {
        recordRowSha256: string;
        placeRowSha256: string;
        linkRowSha256: string;
        batchSha256: string;
        linkInputRow: number;
    };
    sourceReview: Record<string, string>;
    review: any;
    reviewHistory: {
        action: string;
        reviewer_id: string;
        created_at: string;
        revision: number;
        snapshot: any;
    }[];
    mediaPermissions: Record<string, {
        sourceStatus: string;
        allowed: boolean;
        reason: string;
    }>;
};
const checks = ['human_review', 'original_source', 'rights', 'place', 'relation'];
const permissions = ['metadata', 'display', 'thumbnail', 'embed', 'storage', 'modification'];
const empty = () => Object.fromEntries(checks.map(x => [x, { status: 'PENDING', evidenceUrl: '', comment: '' }]));
const emptyPermissions = () => Object.fromEntries(permissions.map(x => [x, { status: 'UNKNOWN', evidenceUrl: '', comment: '' }]));
export default function ReviewPage() {
    const [csrf, setCsrf] = useState(''), [token, setToken] = useState(''), [reviewerId, setReviewerId] = useState(''), [items, setItems] = useState<C[]>([]), [selected, setSelected] = useState<C | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [page, setPage] = useState(1);
    const [filters, setFilters] = useState({ institution: '', recordType: '', title: '', year: '', district: '', legalDong: '', placeName: '' });
    const [queue, setQueue] = useState('PENDING'), [state, setState] = useState('PENDING'), [reviewChecks, setChecks] = useState<any>(empty()), [reviewPermissions, setPermissions] = useState<any>(emptyPermissions()), [location, setLocation] = useState({ address: '', buildingManagementNumber: '', latitude: '', longitude: '', evidenceUrl: '' }), [holdReason, setHoldReason] = useState(''), [expires, setExpires] = useState(''), [imageStatus, setImageStatus] = useState('PENDING'), [playbackStatus, setPlaybackStatus] = useState('PENDING'), [nextPage, setNextPage] = useState<number | null>(null);
    const load = useCallback(async (p = page) => { const q = new URLSearchParams({ ...filters, reviewState: queue, page: String(p), pageSize: '20' }); const r = await fetch('/api/admin/bigquery-v2/reviews?' + q, { cache: 'no-store' }); const j = await r.json() as any; if (!r.ok)
        throw Error(j.error || '자료를 불러오지 못했습니다.'); setItems(j.records); setPage(p); setNextPage(j.nextPage); setSelected(null); }, [filters, page, queue]);
    useEffect(() => { if (csrf)
        load().catch(e => setError(e.message)); }, [csrf]);
    const login = async (e: React.FormEvent) => { e.preventDefault(); setBusy(true); setError(''); try {
        const r = await fetch('/api/admin/bigquery-v2/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, reviewerId }) });
        const j = await r.json() as any;
        if (!r.ok)
            throw Error(j.error);
        setCsrf(j.csrf);
        setToken('');
    }
    catch (e) {
        setError(e instanceof Error ? e.message : '로그인 실패');
    }
    finally {
        setBusy(false);
    } };
    const select = (c: C) => { setSelected(c); const r = c.review; setState(r?.state ?? 'PENDING'); setChecks(r?.checks ?? empty()); setPermissions(r?.permissions ?? emptyPermissions()); const loc = r?.verifiedLocation ?? {}; setLocation({ address: loc.address ?? '', buildingManagementNumber: loc.buildingManagementNumber ?? '', latitude: loc.latitude ?? '', longitude: loc.longitude ?? '', evidenceUrl: loc.evidenceUrl ?? '' }); setImageStatus(loc.imageReviewStatus ?? 'PENDING'); setPlaybackStatus(loc.playbackReviewStatus ?? 'PENDING'); setHoldReason(r?.hold_reason ?? ''); setExpires(r?.expires_at ? new Date(r.expires_at).toISOString().slice(0, 10) : ''); };
    const save = async (reopen = false) => { if (!selected)
        return; setBusy(true); setError(''); try {
        const r = await fetch('/api/admin/bigquery-v2/reviews', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify({ recordId: selected.recordId, linkRowNumber: selected.integrity.linkInputRow, expectedRevision: selected.review?.revision ?? 0, expectedIntegrity: selected.integrity, imageReviewStatus: imageStatus, playbackReviewStatus: playbackStatus, state: reopen ? 'IN_REVIEW' : state, action: reopen ? 'REOPEN' : undefined, checks: reviewChecks, permissions: reviewPermissions, verifiedLocation: location, holdReason, expiresAt: expires ? new Date(expires + 'T23:59:59Z').toISOString() : null }) });
        const j = await r.json() as any;
        if (!r.ok)
            throw Error(j.error);
        await load();
        setError(`저장했습니다 · ${j.state} · revision ${j.revision}`);
    }
    catch (e) {
        setError(e instanceof Error ? e.message : '저장 실패');
    }
    finally {
        setBusy(false);
    } };
    if (!csrf)
        return <main className="mx-auto max-w-xl p-8"><h1>BigQuery 후보 검토</h1><p>Vercel Preview의 관리자 검토 전용 화면입니다.</p><form onSubmit={login} className="grid gap-3"><label>담당자 ID<input autoComplete="username" required minLength={2} maxLength={80} value={reviewerId} onChange={e => setReviewerId(e.target.value)}/></label><label>기존 관리자 토큰<input type="password" autoComplete="current-password" value={token} onChange={e => setToken(e.target.value)}/></label><button disabled={busy}>세션 시작</button></form><p role="status">{error}</p></main>;
    return <main className="mx-auto grid max-w-7xl gap-6 p-6 [&_input]:w-full [&_input]:rounded [&_input]:border [&_input]:p-2 [&_textarea]:w-full [&_textarea]:rounded [&_textarea]:border [&_textarea]:p-2 [&_select]:rounded [&_select]:border [&_select]:p-2 [&_button]:rounded [&_button]:border [&_button]:px-3 [&_button]:py-2 [&_button:disabled]:opacity-40 [&_fieldset]:grid [&_fieldset]:gap-2 [&_fieldset]:rounded [&_fieldset]:border [&_fieldset]:p-3"><header><button onClick={async () => { try { const response = await fetch('/api/admin/bigquery-v2/session', { method: 'DELETE', headers: { 'X-CSRF-Token': csrf } }); if (!response.ok) { setError('서버 세션 폐기에 실패했습니다. 다시 시도하세요.'); return; } setCsrf(''); setItems([]); setSelected(null); } catch { setError('서버 세션 폐기에 실패했습니다. 다시 시도하세요.'); } }}>로그아웃</button><h1 className='text-2xl font-semibold'>미검토 후보 자료 검토</h1><p>승인 저장소가 설정되지 않거나 마이그레이션 전이면 저장은 비활성 상태입니다. 승인 자료는 공개로 자동 내보내지 않습니다.</p></header><form className="grid grid-cols-2 gap-2 md:grid-cols-6" onSubmit={e => { e.preventDefault(); setPage(1); load(1).catch(x => setError(x.message)); }}>{Object.entries(filters).map(([k, v]) => <label key={k}>{({ institution: '기관', recordType: '자료 유형', title: '제목', year: '발행 연도', district: '자치구', legalDong: '법정동', placeName: '장소명' } as any)[k]}{k === 'recordType' ? <select value={v} onChange={e => setFilters({ ...filters, [k]: e.target.value })}><option value=''>전체</option>{Object.entries({ DOCUMENT: '문헌', NEWS: '기사', PHOTO: '사진', MAP: '지도', DRAWING: '도면', VIDEO: '영상' }).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select> : <input value={v} onChange={e => setFilters({ ...filters, [k]: e.target.value })}/>}</label>)}<label>검토 대기열<select value={queue} onChange={e => setQueue(e.target.value)}>{['PENDING', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'REVOKED', 'EXPIRED', 'ALL'].map(x => <option key={x}>{x}</option>)}</select></label><button>검색</button></form><p role="status">{error}</p><section className="grid gap-4 md:grid-cols-[1fr_1.1fr]"><div className="grid content-start gap-2">{items.map((c, i) => <button key={`${c.recordId}-${c.integrity.linkInputRow}-${i}`} onClick={() => select(c)} className="rounded border p-3 text-left"><b>{c.title}</b><div>{c.recordType} · {c.institution} · {c.year ?? '연도 미상'}</div><div>{c.district} {c.legalDong} · {c.placeName} · {c.relationScope}</div><div>{c.review?.state ?? 'PENDING'} · {c.diagnostics.auditState} · 연결중복 {c.diagnostics.duplicateLinkCount}</div></button>)}<nav><button disabled={page <= 1} onClick={() => load(page - 1).catch(e => setError(e.message))}>이전</button> {page} <button disabled={!nextPage} onClick={() => load(page + 1).catch(e => setError(e.message))}>다음</button></nav></div>{selected && <article className="grid content-start gap-3 rounded border p-4"><h2>{selected.title}</h2><p>{selected.candidateLabel} · 원본 {selected.recordId} · 장소 {selected.placeId || '공란'} · 관계 {selected.relationType} / {selected.relationScope}</p><p>진단 {selected.diagnostics.auditState} · 연결 행 {selected.diagnostics.linkRowNumber} · 중복 {selected.diagnostics.duplicateLinkCount}</p>{selected.sourceUrl ? <a href={selected.sourceUrl} target="_blank" rel="noreferrer">원문 HTTPS 링크 확인</a> : <p>원문 URL 없음</p>}<p>원본 상태(자료: {selected.sourceReview?.record ?? '미검토'}, 권리: {selected.sourceReview?.rights ?? '미검토'}, 장소: {selected.sourceReview?.place ?? '미검토'}, 연결: {selected.sourceReview?.relation ?? '미검토'})와 검토자가 기록한 상태는 별도입니다. 원본 사진·영상 및 썸네일은 표시하지 않습니다.</p><details><summary>원본 미디어 권한 상태</summary><ul>{Object.entries(selected.mediaPermissions).map(([k, v]) => <li key={k}>{k}: {v.sourceStatus} (승인: {String(v.allowed)})</li>)}</ul></details><details><summary>검토 변경 이력 ({selected.reviewHistory?.length ?? 0})</summary><ol>{(selected.reviewHistory ?? []).map((event, i) => <li key={i}>{event.created_at} · {event.action} · {event.reviewer_id} · revision {event.revision}</li>)}</ol></details><label>검토 상태<select value={state} onChange={e => setState(e.target.value)}>{['PENDING', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'REVOKED', 'EXPIRED'].map(x => <option key={x}>{x}</option>)}</select></label><p>담당자 {selected.review?.reviewer_id ?? '미지정'} · {selected.review?.updated_at ?? '검토 이력 없음'}</p><h3>다섯 검토 단계</h3>{checks.map(k => <fieldset key={k}><legend>{({ human_review: '사람 자료 검토', original_source: '원문·출처 검증', rights: '저작권·권리', place: '장소·주소·좌표', relation: '자료·장소 연결' } as any)[k]}</legend><select value={reviewChecks[k]?.status ?? 'PENDING'} onChange={e => setChecks({ ...reviewChecks, [k]: { ...reviewChecks[k], status: e.target.value } })}>{['PENDING', 'VERIFIED', 'NEEDS_REVIEW', 'REJECTED'].map(x => <option key={x}>{x}</option>)}</select><input placeholder="HTTPS 근거 URL" value={reviewChecks[k]?.evidenceUrl ?? ''} onChange={e => setChecks({ ...reviewChecks, [k]: { ...reviewChecks[k], evidenceUrl: e.target.value } })}/><textarea placeholder="검토 의견" value={reviewChecks[k]?.comment ?? ''} onChange={e => setChecks({ ...reviewChecks, [k]: { ...reviewChecks[k], comment: e.target.value } })}/><small>{reviewChecks[k]?.reviewerId ?? '미검토'} · {reviewChecks[k]?.reviewedAt ?? ''}</small></fieldset>)}<h3>독립 이용 권한</h3>{permissions.map(k => <fieldset key={k}><legend>{k}</legend><select value={reviewPermissions[k]?.status ?? 'UNKNOWN'} onChange={e => setPermissions({ ...reviewPermissions, [k]: { ...reviewPermissions[k], status: e.target.value } })}>{['UNKNOWN', 'ALLOWED', 'DENIED'].map(x => <option key={x}>{x}</option>)}</select><input placeholder="HTTPS 권리 근거" value={reviewPermissions[k]?.evidenceUrl ?? ''} onChange={e => setPermissions({ ...reviewPermissions, [k]: { ...reviewPermissions[k], evidenceUrl: e.target.value } })}/><textarea placeholder='권리 검토 의견' value={reviewPermissions[k]?.comment ?? ''} onChange={e => setPermissions({ ...reviewPermissions, [k]: { ...reviewPermissions[k], comment: e.target.value } })}/></fieldset>)}<label>이미지 내용 확인<select value={imageStatus} onChange={e => setImageStatus(e.target.value)}><option>PENDING</option><option>VERIFIED</option></select></label><label>영상 재생 확인<select value={playbackStatus} onChange={e => setPlaybackStatus(e.target.value)}><option>PENDING</option><option>VERIFIED</option></select></label><p>직접 연결 승인은 Python 조건과 동일하게 실제 주소·좌표·HTTPS 근거가 모두 필요합니다.</p><h3>위치 증빙 (원본과 별도 보관)</h3>{Object.entries(location).map(([k, v]) => <input key={k} placeholder={k} value={v} onChange={e => setLocation({ ...location, [k]: e.target.value })}/>)}<label>보류 의견<textarea value={holdReason} onChange={e => setHoldReason(e.target.value)}/></label><label>승인 만료일<input type="date" value={expires} onChange={e => setExpires(e.target.value)}/></label><button disabled={busy} onClick={() => save()}>검토 기록 저장</button>{selected.review?.state === 'REVOKED' && <button disabled={busy} onClick={() => save(true)}>철회된 기록 재검토</button>}</article>}</section></main>;
}
