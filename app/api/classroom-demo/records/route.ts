import {classroomDemoEnabled, getClassroomCookie, isClassroomSessionValid} from '@/lib/classroom-demo-auth';
import {getClassroomDemoRecords} from '@/lib/bigquery/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const headers = {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer'};

export async function GET(request: Request) {
  if (!classroomDemoEnabled(process.env)) return Response.json({error: '수업용 화면이 Preview에서 활성화되지 않았습니다.'}, {status: 404, headers});
  const secret = process.env.CLASSROOM_DEMO_TOKEN;
  if (!secret || !isClassroomSessionValid(getClassroomCookie(request), secret)) {
    return Response.json({error: '수업용 인증이 필요합니다.'}, {status: 403, headers});
  }
  const result = await getClassroomDemoRecords();
  return Response.json(result, {status: result.status === 'ok' ? 200 : 503, headers});
}
