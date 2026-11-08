import {env} from '@/lib/runtime-env';
import {mapAddress} from '@/lib/map-address';
import {errorResponse, ServiceError} from '@/lib/providers';
import {readBoundedJson} from '@/lib/bounded-json';
import {allowMcpRequest} from '@/lib/mcp-http';

/** Photo/current-location coordinates are sent in the body, not the request URL. */
export async function POST(request: Request) {
  try {
    if (!allowMcpRequest()) throw new ServiceError('LIMIT', '잠시 후 다시 조회해 주세요.', 429);
    const body = await readBoundedJson(request, 256) as {x?: unknown; y?: unknown} | null;
    if (!body || typeof body.x !== 'number' || typeof body.y !== 'number') {
      throw new ServiceError('MAP_POINT', '위도와 경도를 확인해 주세요.', 400);
    }
    return Response.json(await mapAddress(body.x, body.y, env), {headers: {'Cache-Control': 'no-store'}});
  } catch (error) {return errorResponse(error);}
}
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    if (!params.get('x')?.trim() || !params.get('y')?.trim()) throw new ServiceError('MAP_POINT', '지도에서 위치를 먼저 선택해 주세요.', 400);
    return Response.json(await mapAddress(Number(params.get('x')), Number(params.get('y')), env), {headers: {'Cache-Control': 'no-store'}});
  } catch (error) {return errorResponse(error);}
}
