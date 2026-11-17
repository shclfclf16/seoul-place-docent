import {requireArchiveAdmin} from '@/lib/archive-db';
import {env} from '@/lib/runtime-env';
import {getBigQueryCatalogDiagnostics} from '@/lib/bigquery/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const headers = {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'};

export async function GET(request: Request) {
  try {
    requireArchiveAdmin(request, env);
  } catch {
    return Response.json({error: '관리자 인증이 필요합니다.'}, {status: 403, headers});
  }
  const result = await getBigQueryCatalogDiagnostics();
  return Response.json(result, {status: result.status === 'ok' ? 200 : 503, headers});
}
