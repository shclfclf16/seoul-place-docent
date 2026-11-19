/** Private Preview selection. This module is deliberately absent from public MCP imports. */
import { candidatePreviewEnabled, V2_SNAPSHOT, type CandidateResult, type CandidateTarget, type candidateMetadata } from './candidate-records';
import { reviewEligible, REVIEW_ACTIONS } from './review-policy';
type Candidate = ReturnType<typeof candidateMetadata>;
export type ApprovalRead = (targets: CandidateTarget[]) => Promise<CandidateResult>;
export type ApprovalSearch = {
    limit: number;
    after: string;
    action: typeof REVIEW_ACTIONS[number];
};
type RegistryRow = {
    id: string;
    archive_sha256: string;
    record_id: string;
    record_row_sha256: string;
    place_id: string;
    place_row_sha256: string;
    link_row_sha256: string;
    link_input_row: number;
    state: string;
    checks_json: string;
    permissions_json: string;
    verified_location_json: string;
    reviewer_id: string;
    expires_at: string;
    revision: number;
    updated_at: string;
};
export function parseApprovalSearch(params: URLSearchParams): ApprovalSearch {
    for (const key of params.keys())
        if (!['limit', 'after', 'action'].includes(key) || params.getAll(key).length !== 1)
            throw Error('APPROVAL_INPUT_INVALID');
    const limit = params.get('limit') ?? '10', after = params.get('after') ?? '', action = params.get('action') ?? 'metadata';
    if (!/^[1-9]\d?$/.test(limit) || Number(limit) > 20 || (after && !/^[A-Za-z0-9_-]{1,128}$/.test(after)) || !REVIEW_ACTIONS.includes(action as any))
        throw Error('APPROVAL_INPUT_INVALID');
    return { limit: Number(limit), after, action: action as ApprovalSearch['action'] };
}
const stable = (value: any): string => JSON.stringify(value && typeof value === 'object' ? Array.isArray(value) ? value.map(v => JSON.parse(stable(v))) : Object.fromEntries(Object.keys(value).sort().map(k => [k, JSON.parse(stable(value[k]))])) : value);
function parse(row: RegistryRow) {
    const checks = JSON.parse(row.checks_json), permissions = JSON.parse(row.permissions_json), location = JSON.parse(row.verified_location_json);
    if (!checks || !permissions || !location || typeof checks !== 'object' || typeof permissions !== 'object' || typeof location !== 'object')
        throw Error('INVALID_REVIEW');
    const interchange = (items: Record<string, any>) => Object.fromEntries(Object.entries(items).map(([key, item]) => [key, { ...item, evidence_url: item?.evidenceUrl }]));
    return { checks, permissions, location, review: { state: row.state, review_id: row.id, reviewer_id: row.reviewer_id, reviewed_at: row.updated_at, expires_at: row.expires_at, record_batch_sha256: row.archive_sha256, place_batch_sha256: row.archive_sha256, link_batch_sha256: row.archive_sha256, record_row_sha256: row.record_row_sha256, place_row_sha256: row.place_row_sha256, link_row_sha256: row.link_row_sha256, checks: interchange(checks), permissions: interchange(permissions), verified_location: { ...location, evidence_url: location.evidenceUrl }, image_review_status: location.imageReviewStatus, playback_review_status: location.playbackReviewStatus } };
}
function auditMatches(row: RegistryRow, event: any, parsed: ReturnType<typeof parse>) {
    if (!event || event.action !== 'APPROVE' || event.reviewer_id !== row.reviewer_id || event.created_at !== row.updated_at || event.revision !== row.revision)
        return false;
    const snapshot = JSON.parse(event.snapshot_json), { imageReviewStatus, playbackReviewStatus, ...location } = parsed.location;
    return snapshot.state === 'APPROVED' && snapshot.expiresAt === row.expires_at && stable(snapshot.checks) === stable(parsed.checks) && stable(snapshot.permissions) === stable(parsed.permissions) && stable(snapshot.verifiedLocation) === stable(location) && (snapshot.imageReviewStatus ?? 'PENDING') === (imageReviewStatus ?? 'PENDING') && (snapshot.playbackReviewStatus ?? 'PENDING') === (playbackReviewStatus ?? 'PENDING');
}
function eligible(candidate: Candidate, row: RegistryRow, review: any, action: ApprovalSearch['action'], now: number) {
    const i = candidate.integrity;
    if (i.batchSha256 !== V2_SNAPSHOT || row.archive_sha256 !== V2_SNAPSHOT || candidate.recordId !== row.record_id || candidate.placeId !== row.place_id || i.linkInputRow !== row.link_input_row || ![i.recordRowSha256, i.placeRowSha256, i.linkRowSha256].every(x => /^[a-f0-9]{64}$/.test(x)))
        return false;
    return reviewEligible({ record_id: candidate.recordId, record_type: candidate.recordType, source_url: candidate.sourceUrl, _batch_sha256: i.batchSha256, _row_sha256: i.recordRowSha256 }, { place_id: candidate.placeId, _batch_sha256: i.placeBatchSha256, _row_sha256: i.placeRowSha256 }, { record_id: candidate.recordId, place_id: candidate.placeId, relation_type: candidate.relationType, _batch_sha256: i.linkBatchSha256, _row_sha256: i.linkRowSha256 }, review, action, now);
}
/** Reads approvals twice so a revocation/revision during the BigQuery call cannot escape. */
export async function selectApprovedRecords(settings: Record<string, string | undefined>, db: D1Database, input: ApprovalSearch, read: ApprovalRead, clock = Date.now) {
    if (!candidatePreviewEnabled(settings))
        throw Error('APPROVAL_DISABLED');
    const registry = await db.prepare('SELECT state,COUNT(*) AS linkCount,COUNT(DISTINCT record_id) AS recordCount FROM bq_v2_review_state GROUP BY state').all<{
        state: string;
        linkCount: number;
        recordCount: number;
    }>();
    const result = await db.prepare("SELECT * FROM bq_v2_review_state WHERE state='APPROVED' AND id>? ORDER BY id LIMIT ?").bind(input.after, input.limit + 1).all<RegistryRow>();
    const page = result.results.slice(0, input.limit), rejected: Record<string, number> = {}, exclude = (code: string) => { rejected[code] = (rejected[code] ?? 0) + 1; };
    const ready: {
        row: RegistryRow;
        parsed: ReturnType<typeof parse>;
    }[] = [];
    for (const row of page) {
        let parsed: ReturnType<typeof parse>;
        try {
            parsed = parse(row);
        }
        catch {
            exclude('INVALID_REVIEW');
            continue;
        }
        if (row.archive_sha256 !== V2_SNAPSHOT || !row.place_id || !Number.isSafeInteger(row.link_input_row) || row.link_input_row < 1 || ![row.record_row_sha256, row.place_row_sha256, row.link_row_sha256].every(x => /^[a-f0-9]{64}$/.test(x))) {
            exclude('INVALID_PROVENANCE');
            continue;
        }
        if (!Number.isFinite(Date.parse(row.expires_at)) || Date.parse(row.expires_at) <= clock()) {
            exclude('EXPIRED');
            continue;
        }
        const event = await db.prepare('SELECT * FROM bq_v2_review_events WHERE review_state_id=? ORDER BY revision DESC LIMIT 1').bind(row.id).first();
        try {
            if (!auditMatches(row, event, parsed)) {
                exclude('AUDIT_MISMATCH');
                continue;
            }
        }
        catch {
            exclude('INVALID_AUDIT');
            continue;
        }
        ready.push({ row, parsed });
    }
    let budget: Extract<CandidateResult, {
        status: 'ok';
    }>['budget'] | null = null, rows: Candidate[] = [];
    if (ready.length) {
        const candidates = await read(ready.map(({ row }) => ({ recordId: row.record_id, linkRowNumber: row.link_input_row })));
        if (candidates.status !== 'ok')
            throw Error('APPROVAL_SOURCE_UNAVAILABLE');
        if (candidates.nextPage !== null)
            throw Error('APPROVAL_SOURCE_AMBIGUOUS');
        rows = candidates.records;
        budget = candidates.budget;
    }
    const finalRows = ready.length ? (await db.prepare('SELECT * FROM bq_v2_review_state WHERE id IN (' + ready.map(() => '?').join(',') + ')').bind(...ready.map(x => x.row.id)).all<RegistryRow>()).results : [];
    const records = [];
    for (const { row, parsed } of ready) {
        const current = finalRows.find(x => x.id === row.id);
        if (!current || stable(current) !== stable(row)) {
            exclude('REVIEW_CHANGED');
            continue;
        }
        const matches = rows.filter(c => c.recordId === row.record_id && c.integrity.linkInputRow === row.link_input_row);
        if (matches.length !== 1) {
            exclude('SOURCE_MISSING_OR_AMBIGUOUS');
            continue;
        }
        const candidate = matches[0];
        if (!eligible(candidate, current, parsed.review, 'metadata', clock()) || !eligible(candidate, current, parsed.review, input.action, clock())) {
            exclude('INELIGIBLE');
            continue;
        }
        const actions = Object.fromEntries(REVIEW_ACTIONS.map(action => [action, eligible(candidate, current, parsed.review, action, clock())]));
        const scope = candidate.relationType === 'EXACT_SITE' ? 'VERIFIED_SITE' : candidate.relationType === 'NEARBY' ? 'NEARBY_CONTEXT' : 'DISTRICT_CONTEXT';
        records.push({ recordId: candidate.recordId, placeId: candidate.placeId, linkRowNumber: row.link_input_row, title: candidate.title, recordType: candidate.recordType, year: candidate.year, institution: candidate.institution, sourceUrl: candidate.sourceUrl, placeName: candidate.placeName, district: candidate.district, legalDong: candidate.legalDong, relationType: candidate.relationType, spatialScope: scope, directConnection: false, scopeNotice: scope === 'VERIFIED_SITE' ? '검증된 자료 장소입니다. 질의 주소와의 일치는 별도로 확인해야 합니다.' : scope === 'NEARBY_CONTEXT' ? '주변 장소의 자료입니다. 질의 건물의 직접 역사로 사용할 수 없습니다.' : '지역 배경자료입니다. 특정 건물의 직접 역사로 사용할 수 없습니다.', eligibility: { metadata: true, actions, approvedForPublicUse: false, exported: false }, evidence: { reviewId: row.id, revision: row.revision, reviewerId: row.reviewer_id, reviewedAt: row.updated_at, expiresAt: row.expires_at, checks: parsed.checks, permissions: parsed.permissions, verifiedLocation: parsed.location, integrity: candidate.integrity }, diagnostics: { duplicateLinkCount: candidate.diagnostics.duplicateLinkCount } });
    }
    return { status: 'ok', notice: '승인 자격 재검증 결과 — 비공개 Preview 전용이며 공개 승격 결과가 아닙니다.', records, selectedCount: records.length, scannedApprovedLinks: page.length, nextCursor: result.results.length > input.limit ? page.at(-1)!.id : null, registryCounts: registry.results, rejected, budget, bigQuerySkipped: !ready.length };
}
