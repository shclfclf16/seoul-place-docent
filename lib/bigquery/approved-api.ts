import { createHash, randomUUID } from 'node:crypto';
import { candidatePreviewEnabled } from './candidate-records';
import { readReviewSession, storedSessionValid } from './review-auth';
import { parseApprovalSearch, selectApprovedRecords, type ApprovalRead } from './approved-records';
const headers = { 'Cache-Control': 'no-store', 'CDN-Cache-Control': 'no-store', 'Vercel-CDN-Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Vary': 'Cookie' };
const json = (value: unknown, status = 200) => Response.json(value, { status, headers });
export function approvedHandler(settings: Record<string, string | undefined>, db: D1Database | undefined, read: ApprovalRead) {
    return async (req: Request) => {
        if (!candidatePreviewEnabled(settings))
            return json({ error: 'Preview 전용 기능입니다.' }, 404);
        const session = readReviewSession(req, settings);
        if (!session)
            return json({ error: '관리자 세션이 필요합니다.' }, 403);
        if (req.headers.get('origin') && req.headers.get('origin') !== new URL(req.url).origin)
            return json({ error: '허용되지 않은 요청 출처입니다.' }, 403);
        if (!db)
            return json({ error: '승인 저장소가 설정되지 않았습니다.' }, 503);
        try {
            if (!await storedSessionValid(db, session, settings.ARCHIVE_ADMIN_TOKEN!))
                return json({ error: '관리자 세션이 만료되었거나 폐기되었습니다.' }, 403);
            const input = parseApprovalSearch(new URL(req.url).searchParams);
            const digest = 'approved:' + createHash('sha256').update(session.reviewerId).digest('hex'), now = new Date().toISOString(), cutoff = new Date(Date.now() - 60000).toISOString();
            const rate = await db.batch([db.prepare('DELETE FROM bq_v2_review_rate_limits WHERE created_at<?').bind(new Date(Date.now() - 86400000).toISOString()), db.prepare('INSERT INTO bq_v2_review_rate_limits(id,reviewer_id,created_at) SELECT ?,?,? WHERE (SELECT count(*) FROM bq_v2_review_rate_limits WHERE reviewer_id=? AND created_at>=?)<3').bind(randomUUID(), digest, now, digest, cutoff)]);
            if (Number(rate[1]?.meta?.changes ?? 0) !== 1)
                return json({ error: '승인 조회는 담당자별 분당 3회까지 가능합니다.' }, 429);
            return json(await selectApprovedRecords(settings, db, input, read));
        }
        catch (error) {
            return error instanceof Error && error.message === 'APPROVAL_INPUT_INVALID' ? json({ error: '검색 조건을 확인하세요.' }, 400) : json({ error: '승인 또는 원본 재검증을 완료할 수 없습니다.' }, 503);
        }
    };
}
