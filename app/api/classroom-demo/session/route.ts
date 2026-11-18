import {randomBytes} from 'node:crypto';
import {
  CLASSROOM_SESSION_SECONDS, classroomCookieHeader, classroomDemoEnabled,
  classroomTokenMatches, createClassroomSession, isSameOriginRequest, safeClassroomTokenLength,
} from '@/lib/classroom-demo-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const headers = {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer'};

export async function POST(request: Request) {
  if (!classroomDemoEnabled(process.env)) return Response.json({error: '수업용 화면이 Preview에서 활성화되지 않았습니다.'}, {status: 404, headers});
  if (!isSameOriginRequest(request)) return Response.json({error: '같은 사이트에서 요청해 주세요.'}, {status: 403, headers});
  const expected = process.env.CLASSROOM_DEMO_TOKEN;
  if (!expected || expected.length < 32 || !safeClassroomTokenLength(expected)) {
    return Response.json({error: '수업용 인증을 사용할 수 없습니다.'}, {status: 503, headers});
  }
  const declaredLength = Number(request.headers.get('content-length') ?? 0);
  if (declaredLength > 2048) return Response.json({error: '요청이 너무 큽니다.'}, {status: 413, headers});
  let body: unknown;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).length > 2048) return Response.json({error: '요청이 너무 큽니다.'}, {status: 413, headers});
    body = JSON.parse(text);
  } catch {
    return Response.json({error: '요청 형식을 확인해 주세요.'}, {status: 400, headers});
  }
  const token = body && typeof body === 'object' && 'token' in body ? body.token : undefined;
  if (!classroomTokenMatches(token, expected)) {
    // Add a small unpredictable delay to make token guessing less useful; never log input.
    await new Promise(resolve => setTimeout(resolve, randomBytes(1)[0] % 180));
    return Response.json({error: '수업용 인증키를 확인해 주세요.'}, {status: 403, headers});
  }
  const cookie = createClassroomSession(expected);
  return Response.json({authenticated: true, expiresInSeconds: CLASSROOM_SESSION_SECONDS}, {
    status: 200,
    headers: {...headers, 'Set-Cookie': classroomCookieHeader(cookie)},
  });
}

export async function DELETE(request: Request) {
  if (!isSameOriginRequest(request)) return Response.json({error: '같은 사이트에서 요청해 주세요.'}, {status: 403, headers});
  return Response.json({authenticated: false}, {
    status: 200,
    headers: {...headers, 'Set-Cookie': classroomCookieHeader('', 0)},
  });
}

