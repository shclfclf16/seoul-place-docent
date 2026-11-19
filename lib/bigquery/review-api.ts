import { candidatePreviewEnabled, type CandidateSearch, type CandidateResult, V2_SNAPSHOT, parseCandidateSearch } from '@/lib/bigquery/candidate-records';
import { readReviewSession, csrfValid, storedSessionValid } from '@/lib/bigquery/review-auth';
import { approvalBlock } from '@/lib/bigquery/review-policy';
import { createHash } from 'node:crypto';
export function reviewHandlers(settings: Record<string, string | undefined>, db: D1Database | undefined, read: (input: CandidateSearch) => Promise<CandidateResult>) {
    const headers = { 'Cache-Control': 'no-store', 'CDN-Cache-Control': 'no-store', 'Vercel-CDN-Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer' };
    const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
    const CHECKS = ['human_review', 'original_source', 'rights', 'place', 'relation'] as const;
    const PERMISSIONS = ['metadata', 'display', 'thumbnail', 'embed', 'storage', 'modification'] as const;
    const states = ['PENDING', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'REVOKED', 'EXPIRED'] as const;
    function https(v: unknown): v is string { if (typeof v !== 'string' || v.length > 2048)
        return false; try {
        const u = new URL(v);
        return u.protocol === 'https:' && !u.username && !u.password;
    }
    catch {
        return false;
    } }
    function bounded(v: unknown, max = 1000) { return typeof v === 'string' && v.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v); }
    async function rateLimit(db: D1Database, reviewer: string) {
        const now = new Date().toISOString(), cutoff = new Date(Date.now() - 60000).toISOString(), daily = new Date(Date.now() - 86400000).toISOString();
        const statements = [db.prepare('DELETE FROM bq_v2_review_rate_limits WHERE created_at<?').bind(daily), db.prepare('INSERT INTO bq_v2_review_rate_limits(id,reviewer_id,created_at) SELECT ?,?,? WHERE (SELECT count(*) FROM bq_v2_review_rate_limits WHERE reviewer_id=? AND created_at>=?)<12').bind(crypto.randomUUID(), createHash('sha256').update(reviewer).digest('hex'), now, createHash('sha256').update(reviewer).digest('hex'), cutoff)];
        const results = await db.batch(statements) as unknown as {
            meta?: {
                changes?: number;
            };
        }[];
        if (Number(results[1]?.meta?.changes ?? 0) !== 1)
            throw Error('REVIEW_RATE_LIMIT');
    }
    async function ready(req: Request) { if (!candidatePreviewEnabled(settings))
        return { error: json({ error: 'Preview 전용 기능입니다.' }, 404) }; const session = readReviewSession(req, settings); if (!session)
        return { error: json({ error: '관리자 세션이 필요합니다.' }, 403) }; if (req.method !== 'GET' && !csrfValid(req, session))
        return { error: json({ error: '요청 위조 검증에 실패했습니다.' }, 403) }; if (!db)
        return { error: json({ error: '영구 검토 저장소가 설정되지 않았습니다.' }, 503) }; try {
        if (!await storedSessionValid(db, session, settings.ARCHIVE_ADMIN_TOKEN!))
            return { error: json({ error: '세션이 만료되었거나 폐기되었습니다.' }, 403) };
    }
    catch {
        return { error: json({ error: '세션 저장소를 확인할 수 없습니다.' }, 503) };
    } return { session, db }; }
    async function schema(db: D1Database) { await db.prepare('SELECT id FROM bq_v2_review_state LIMIT 0').all(); }
    function values(candidate: any, body: any, actor: string, now: string) {
        const checks = body?.checks, permissions = body?.permissions, location = body?.verifiedLocation ?? {};
        if (!checks || !permissions || !bounded(body?.holdReason ?? '', 2000))
            throw Error('REVIEW_INPUT_INVALID');
        const cleanChecks: Record<string, unknown> = {};
        for (const key of CHECKS) {
            const item = checks[key];
            if (!item || !['PENDING', 'VERIFIED', 'REJECTED', 'NEEDS_REVIEW'].includes(item.status) || !bounded(item.comment ?? '', 2000) || (item.status === 'VERIFIED' && !https(item.evidenceUrl)))
                throw Error('REVIEW_INPUT_INVALID');
            cleanChecks[key] = { status: item.status, comment: item.comment ?? '', evidenceUrl: https(item.evidenceUrl) ? item.evidenceUrl : null, reviewerId: actor, reviewedAt: now };
        }
        const cleanPermissions: Record<string, unknown> = {};
        for (const key of PERMISSIONS) {
            const item = permissions[key];
            if (!item || !['UNKNOWN', 'ALLOWED', 'DENIED'].includes(item.status) || !bounded(item.comment ?? '', 1000) || (item.status === 'ALLOWED' && !https(item.evidenceUrl)))
                throw Error('REVIEW_INPUT_INVALID');
            cleanPermissions[key] = { status: item.status, comment: item.comment ?? '', evidenceUrl: https(item.evidenceUrl) ? item.evidenceUrl : null, reviewerId: actor, reviewedAt: now };
        }
        let verifiedLocation: Record<string, unknown> = {};
        if (location && Object.values(location).some(v => v !== '' && v !== null && v !== undefined)) {
            if (!bounded(location.address ?? '', 300) || !bounded(location.buildingManagementNumber ?? '', 80) || !https(location.evidenceUrl))
                throw Error('REVIEW_INPUT_INVALID');
            let lat = null, lon = null;
            if (location.latitude !== '' && location.latitude != null) {
                if (location.longitude === '' || location.longitude == null)
                    throw Error('REVIEW_INPUT_INVALID');
                lat = Number(location.latitude);
                lon = Number(location.longitude);
                if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180)
                    throw Error('REVIEW_INPUT_INVALID');
            }
            if (lat === null && location.longitude !== '' && location.longitude != null)
                throw Error('REVIEW_INPUT_INVALID');
            verifiedLocation = { address: location.address ?? '', buildingManagementNumber: location.buildingManagementNumber ?? '', latitude: lat, longitude: lon, evidenceUrl: location.evidenceUrl };
        }
        const mediaStatus = (v: unknown) => v === 'VERIFIED' ? 'VERIFIED' : 'PENDING';
        return { checks: cleanChecks, permissions: cleanPermissions, verifiedLocation, holdReason: body.holdReason ?? '', imageReviewStatus: mediaStatus(body.imageReviewStatus), playbackReviewStatus: mediaStatus(body.playbackReviewStatus) };
    }
    async function GET(req: Request) {
        const access = await ready(req);
        if (access.error)
            return access.error;
        const { db, session } = access;
        try {
            await schema(db);
            await rateLimit(db, session.reviewerId);
            const params = new URL(req.url).searchParams;
            const queue = params.get('reviewState') ?? 'PENDING';
            if (!['PENDING', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'REVOKED', 'EXPIRED', 'ALL'].includes(queue))
                return json({ error: '검토 대기열 조건을 확인하세요.' }, 400);
            params.delete('reviewState');
            const input = parseCandidateSearch(params);
            const result = await read(input);
            if (result.status !== 'ok')
                return json({ error: '후보 자료 조회를 사용할 수 없습니다.', status: result.status }, 503);
            const items = await Promise.all(result.records.map(async (candidate) => { const key = candidate.integrity; const bind = [key.batchSha256, candidate.recordId, candidate.integrity.recordRowSha256, candidate.placeId, candidate.integrity.placeRowSha256, candidate.integrity.linkRowSha256, candidate.integrity.linkInputRow]; const stored = await db.prepare(`SELECT id,state,checks_json,permissions_json,verified_location_json,hold_reason,reviewer_id,expires_at,revision,updated_at FROM bq_v2_review_state WHERE archive_sha256=? AND record_id=? AND record_row_sha256=? AND place_id=? AND place_row_sha256=? AND link_row_sha256=? AND link_input_row=?`).bind(...bind).first<any>(); let review = null; if (stored) {
                let state = stored.state;
                if (state === 'APPROVED' && (!stored.expires_at || !Number.isFinite(Date.parse(stored.expires_at)) || Date.parse(stored.expires_at) <= Date.now()))
                    state = 'EXPIRED';
                review = { ...stored, state, checks: JSON.parse(stored.checks_json), permissions: JSON.parse(stored.permissions_json), verifiedLocation: JSON.parse(stored.verified_location_json) };
                delete review.checks_json;
                delete review.permissions_json;
                delete review.verified_location_json;
            } const events = stored ? await db.prepare('SELECT action,snapshot_json,reviewer_id,created_at,revision FROM bq_v2_review_events WHERE review_state_id=? ORDER BY revision DESC LIMIT 20').bind(stored.id).all<any>() : { results: [] }; return { ...candidate, sourceReview: candidate.review, review, reviewHistory: (events.results ?? []).map(event => ({ ...event, snapshot: JSON.parse(event.snapshot_json) })) }; }));
            return json({ ...result, records: queue === 'ALL' ? items : items.filter(item => (item.review?.state ?? 'PENDING') === queue) });
        }
        catch (e) {
            if (e instanceof Error && e.message === 'CANDIDATE_INPUT_INVALID')
                return json({ error: '검색 조건을 확인하세요.' }, 400);
            return e instanceof Error && e.message === 'REVIEW_RATE_LIMIT' ? json({ error: '잠시 후 다시 시도해 주세요.' }, 429) : json({ error: '검토 저장소 마이그레이션이 없거나 조회할 수 없습니다.' }, 503);
        }
    }
    async function POST(req: Request) {
        const access = await ready(req);
        if (access.error)
            return access.error;
        const { db, session } = access;
        try {
            await schema(db);
            await rateLimit(db, session.reviewerId);
            const raw = await req.text();
            if (raw.length > 20000)
                return json({ error: '요청이 너무 큽니다.' }, 413);
            let body;
            try {
                body = JSON.parse(raw);
            }
            catch {
                return json({ error: 'JSON 형식을 확인하세요.' }, 400);
            }
            if (!body || typeof body !== 'object' || !states.includes(body.state))
                return json({ error: '검토 상태를 확인하세요.' }, 400);
            if (!bounded(body.recordId, 120) || !Number.isInteger(body.linkRowNumber) || body.linkRowNumber < 0 || body.linkRowNumber > 200000 || !Number.isInteger(body.expectedRevision) || body.expectedRevision < 0)
                return json({ error: '대상 또는 버전을 확인하세요.' }, 400);
            const input: CandidateSearch = { institution: '', recordType: '', district: '', legalDong: '', placeName: '', title: '', recordId: body.recordId, linkRowNumber: String(body.linkRowNumber), page: 1, pageSize: 2 };
            const candidateResult = await read(input);
            if (candidateResult.status !== 'ok' || candidateResult.records.length !== 1)
                return json({ error: '현재 원본 후보 행을 확인할 수 없습니다.' }, 409);
            const c = candidateResult.records[0], i = c.integrity;
            const prior = await db.prepare('SELECT id,revision,state,checks_json,permissions_json FROM bq_v2_review_state WHERE archive_sha256=? AND record_id=? AND record_row_sha256=? AND place_id=? AND place_row_sha256=? AND link_row_sha256=? AND link_input_row=?').bind(i.batchSha256, c.recordId, i.recordRowSha256, c.placeId, i.placeRowSha256, i.linkRowSha256, i.linkInputRow).first<any>();
            if ((prior?.revision ?? 0) !== body.expectedRevision)
                return json({ error: '다른 검토자가 먼저 변경했습니다. 다시 불러오세요.' }, 409);
            if (!Object.entries(i).every(([key, value]) => body.expectedIntegrity?.[key] === value))
                return json({ error: '조회 이후 원본 해시가 변경되었습니다. 다시 불러오세요.' }, 409);
            if (i.batchSha256 !== V2_SNAPSHOT || !/^[a-f0-9]{64}$/.test(i.recordRowSha256) || (i.linkInputRow > 0 && (i.linkBatchSha256 !== i.batchSha256 || !/^[a-f0-9]{64}$/.test(i.linkRowSha256))) || (c.placeId && (i.placeBatchSha256 !== i.batchSha256 || !/^[a-f0-9]{64}$/.test(i.placeRowSha256))))
                return json({ error: '원본 스냅샷의 해시를 확인할 수 없습니다.' }, 409);
            const value = values(c, body, session.reviewerId, new Date().toISOString());
            let next = body.state as string;
            if (prior) {
                for (const [name, column] of [['checks', 'checks_json'], ['permissions', 'permissions_json']] as const) {
                    const old = JSON.parse(prior[column]);
                    const current = value[name] as Record<string, any>;
                    for (const key of Object.keys(current)) {
                        const a = current[key], b = old[key];
                        if (b && a.status === b.status && a.evidenceUrl === b.evidenceUrl && a.comment === b.comment)
                            current[key] = b;
                    }
                }
            }
            if (next === 'APPROVED') {
                const blocked = approvalBlock(c, value, body.expiresAt);
                if (blocked)
                    return json({ error: blocked }, 400);
            }
            const priorState = prior?.state ?? 'PENDING';
            if (body.action === 'REOPEN' && (priorState !== 'REVOKED' || !['PENDING', 'IN_REVIEW'].includes(next)))
                return json({ error: '철회된 기록만 보류/검토 상태로 재검토할 수 있습니다.' }, 409);
            if (priorState === 'REVOKED' && next !== 'REVOKED' && body.action !== 'REOPEN')
                return json({ error: '철회된 승인은 명시적 재검토 후에만 다시 심사할 수 있습니다.' }, 409);
            const now = new Date().toISOString(), id = prior?.id ?? createHash('sha256').update(JSON.stringify([i.batchSha256, c.recordId, i.recordRowSha256, c.placeId, i.placeRowSha256, i.linkRowSha256, i.linkInputRow])).digest('hex'), revision = (prior?.revision ?? 0) + 1, expires = next === 'APPROVED' ? body.expiresAt : null, snapshot = { state: next, ...value, expiresAt: expires };
            const action = body.action === 'REOPEN' ? 'REOPEN' : next === 'APPROVED' ? 'APPROVE' : next === 'REJECTED' ? 'REJECT' : next === 'REVOKED' ? 'REVOKE' : next === 'PENDING' ? 'HOLD' : next === 'IN_REVIEW' ? 'START' : 'SAVE';
            const stateJson = JSON.stringify(value.checks), permissionJson = JSON.stringify(value.permissions), locationJson = JSON.stringify({ ...value.verifiedLocation, imageReviewStatus: value.imageReviewStatus, playbackReviewStatus: value.playbackReviewStatus });
            const upsert = db.prepare(`INSERT INTO bq_v2_review_state(id,archive_sha256,record_id,record_row_sha256,place_id,place_row_sha256,link_row_sha256,link_input_row,state,checks_json,permissions_json,verified_location_json,hold_reason,reviewer_id,expires_at,revision,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(archive_sha256,record_id,record_row_sha256,place_id,place_row_sha256,link_row_sha256,link_input_row) DO UPDATE SET state=excluded.state,checks_json=excluded.checks_json,permissions_json=excluded.permissions_json,verified_location_json=excluded.verified_location_json,hold_reason=excluded.hold_reason,reviewer_id=excluded.reviewer_id,expires_at=excluded.expires_at,revision=excluded.revision,updated_at=excluded.updated_at`).bind(id, i.batchSha256, c.recordId, i.recordRowSha256, c.placeId, i.placeRowSha256, i.linkRowSha256, i.linkInputRow, next, stateJson, permissionJson, locationJson, value.holdReason, session.reviewerId, expires, revision, now);
            const event = db.prepare('INSERT INTO bq_v2_review_events(id,review_state_id,revision,action,snapshot_json,reviewer_id,created_at) VALUES(?,?,?,?,?,?,?)').bind(crypto.randomUUID(), id, revision, action, JSON.stringify(snapshot), session.reviewerId, now);
            await db.batch([upsert, event]);
            return json({ saved: true, state: next, revision, expiresAt: expires });
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : '';
            if (msg === 'REVIEW_INPUT_INVALID')
                return json({ error: '검토 항목 입력을 확인하세요.' }, 400);
            if (/UNIQUE constraint failed/.test(msg))
                return json({ error: '동시 변경이 감지되었습니다. 다시 불러오세요.' }, 409);
            if (msg === 'REVIEW_RATE_LIMIT')
                return json({ error: '잠시 후 다시 시도해 주세요.' }, 429);
            return json({ error: '검토 저장소를 사용할 수 없거나 마이그레이션이 필요합니다.' }, 503);
        }
    }
    return { GET, POST };
}
