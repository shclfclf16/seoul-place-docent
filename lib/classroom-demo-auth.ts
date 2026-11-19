import {createHmac, timingSafeEqual} from 'node:crypto';

export const CLASSROOM_COOKIE = 'seoul_classroom_demo';
export const CLASSROOM_SESSION_SECONDS = 4 * 60 * 60;
const encoder = new TextEncoder();

function constantTimeEqual(left: string, right: string) {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

function signature(secret: string, payload: string) {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function classroomTokenMatches(supplied: unknown, expected: string | undefined) {
  return typeof supplied === 'string' && supplied.length >= 32 && supplied.length <= 512 &&
    !!expected && expected.length >= 32 && constantTimeEqual(supplied, expected);
}

export function createClassroomSession(secret: string, now = Date.now()) {
  const expiresAt = Math.floor(now / 1000) + CLASSROOM_SESSION_SECONDS;
  const payload = `v1.${expiresAt}`;
  return `${payload}.${signature(secret, payload)}`;
}

export function isClassroomSessionValid(cookieValue: string | undefined, secret: string | undefined, now = Date.now()) {
  if (!cookieValue || !secret || secret.length < 32) return false;
  const parts = cookieValue.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1' || !/^\d{10}$/.test(parts[1])) return false;
  const expiresAt = Number(parts[1]);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(now / 1000)) return false;
  const payload = `${parts[0]}.${parts[1]}`;
  return constantTimeEqual(parts[2], signature(secret, payload));
}

export function classroomCookieHeader(value: string, maxAge = CLASSROOM_SESSION_SECONDS) {
  return `${CLASSROOM_COOKIE}=${value}; Path=/api/classroom-demo; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
}

export function getClassroomCookie(request: Request) {
  const cookies = request.headers.get('cookie') ?? '';
  for (const pair of cookies.split(';')) {
    const separator = pair.indexOf('=');
    if (separator > 0 && pair.slice(0, separator).trim() === CLASSROOM_COOKIE) {
      return pair.slice(separator + 1).trim();
    }
  }
  return undefined;
}

export function isSameOriginRequest(request: Request) {
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(request.url).origin;
}

export function classroomDemoEnabled(settings: Record<string, string | undefined>) {
  return settings.CLASSROOM_DEMO_ENABLED === 'true' && settings.VERCEL_ENV === 'preview';
}

export function classroomPhotoEmbedEnabled(settings: Record<string, string | undefined>) {
  return classroomDemoEnabled(settings) &&
    settings.CLASSROOM_DEMO_IMAGE_EMBED_ENABLED === 'true' &&
    settings.CLASSROOM_DEMO_IMAGE_RIGHTS_APPROVED === 'true';
}

export function safeClassroomTokenLength(value: string) {
  return encoder.encode(value).length <= 512;
}
