/** Private eligibility only. No publication or media fetch is performed here. */
export const REVIEW_CHECKS = ['human_review', 'original_source', 'rights', 'place', 'relation'] as const;
export const REVIEW_ACTIONS = ['metadata', 'display', 'thumbnail', 'embed', 'storage', 'modification'] as const;
export function evidenceUrl(value: unknown): value is string {
    if (typeof value !== 'string' || value.length > 2048)
        return false;
    try {
        const u = new URL(value);
        return u.protocol === 'https:' && !!u.hostname && !u.username && !u.password;
    }
    catch {
        return false;
    }
}
/** Mirrors approval_gate.py, using its snake_case offline interchange schema. */
export function reviewEligible(record: any, place: any, link: any, review: any, action = 'metadata', now = Date.now()): boolean {
    if (!REVIEW_ACTIONS.includes(action as any) || review?.state !== 'APPROVED' || !review.reviewer_id || !review.review_id)
        return false;
    const dated = (v: unknown) => typeof v === 'string' && /(Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v));
    if (!dated(review.reviewed_at) || !dated(review.expires_at) || Date.parse(review.reviewed_at) > now || Date.parse(review.expires_at) <= now)
        return false;
    if (!record.record_id || !place.place_id || link.record_id !== record.record_id || link.place_id !== place.place_id || !evidenceUrl(record.source_url))
        return false;
    for (const [name, row] of [['record', record], ['place', place], ['link', link]] as const) {
        for (const key of ['_batch_sha256', '_row_sha256'])
            if (!row[key] || review[name + key] !== row[key])
                return false;
    }
    if (new Set([record._batch_sha256, place._batch_sha256, link._batch_sha256]).size !== 1)
        return false;
    if (REVIEW_CHECKS.some(k => review.checks?.[k]?.status !== 'VERIFIED' || !evidenceUrl(review.checks?.[k]?.evidence_url)))
        return false;
    if (link.relation_type === 'EXACT_SITE') {
        const loc = review.verified_location ?? {};
        if (!loc.address || !evidenceUrl(loc.evidence_url) || loc.latitude == null || loc.longitude == null || loc.latitude === '' || loc.longitude === '')
            return false;
        const lat = Number(loc.latitude), lon = Number(loc.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180)
            return false;
    }
    else if (!['NEARBY', 'DISTRICT_CONTEXT'].includes(link.relation_type))
        return false;
    const p = review.permissions?.[action];
    if (p?.status !== 'ALLOWED' || !evidenceUrl(p.evidence_url))
        return false;
    if (action === 'embed' && (record.record_type !== 'VIDEO' || review.playback_review_status !== 'VERIFIED'))
        return false;
    if (['display', 'thumbnail'].includes(action) && ['PHOTO', 'MAP', 'DRAWING'].includes(record.record_type) && review.image_review_status !== 'VERIFIED')
        return false;
    return true;
}
export function approvalBlock(candidate: any, value: any, expiresAt: unknown, now = Date.now()): string | null {
    const i = candidate.integrity ?? {}, checks = value.checks ?? {}, permissions = value.permissions ?? {}, location = value.verifiedLocation ?? {};
    if (REVIEW_CHECKS.some(k => checks[k]?.status !== 'VERIFIED' || !evidenceUrl(checks[k]?.evidenceUrl)) || permissions.metadata?.status !== 'ALLOWED' || !evidenceUrl(permissions.metadata?.evidenceUrl) || !evidenceUrl(candidate.sourceUrl))
        return '다섯 검토와 metadata 권리·HTTPS 원문 근거가 모두 필요합니다.';
    if (!candidate.placeId || !['EXACT_SITE', 'NEARBY', 'DISTRICT_CONTEXT'].includes(candidate.relationType))
        return '불확실/미연결 자료는 승인할 수 없습니다.';
    if (candidate.relationType === 'EXACT_SITE' && (!location.address || !evidenceUrl(location.evidenceUrl) || location.latitude == null || location.longitude == null))
        return '직접 연결은 Python 승인 조건과 동일하게 검증된 주소·좌표·HTTPS 위치 근거가 필요합니다.';
    if (typeof expiresAt !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/.test(expiresAt) || !Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= now || Date.parse(expiresAt) > now + 180 * 86400000)
        return '승인 만료일은 180일 이내로 설정하세요.';
    for (const k of REVIEW_ACTIONS)
        if (permissions[k]?.status === 'ALLOWED') {
            if (!evidenceUrl(permissions[k].evidenceUrl))
                return '허용 권리마다 HTTPS 근거가 필요합니다.';
            if (k === 'embed' && (candidate.recordType !== 'VIDEO' || value.playbackReviewStatus !== 'VERIFIED'))
                return '영상 임베드는 별도의 재생 검증이 필요합니다.';
            if (['display', 'thumbnail'].includes(k) && ['PHOTO', 'MAP', 'DRAWING'].includes(candidate.recordType) && value.imageReviewStatus !== 'VERIFIED')
                return '사진·지도·도면 표시는 별도의 이미지 검증이 필요합니다.';
        }
    if (![i.recordRowSha256, i.placeRowSha256, i.linkRowSha256].every(v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)) || i.batchSha256 !== i.placeBatchSha256 || i.batchSha256 !== i.linkBatchSha256)
        return '원본 행 해시가 일치해야 승인할 수 있습니다.';
    return null;
}
