import {readBoundedJson} from '@/lib/bounded-json';
import {env} from '@/lib/runtime-env';
import {getFullDocentStory} from '@/lib/docent-data';
import {preparePlaceAnswer} from '@/lib/place-answer';
import {placeMedia} from '@/lib/place-media';
import {errorResponse, ServiceError, verifyAddress} from '@/lib/providers';
import {allowMcpRequest} from '@/lib/mcp-http';

export async function POST(request: Request) {
  try {
    if (!allowMcpRequest()) throw new ServiceError('LIMIT', '잠시 후 다시 조회해 주세요.', 429);
    const body = await readBoundedJson(request, 8000) as {token?: unknown} | null;
    if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.token !== 'string' || body.token.length > 6000 || !body.token) {
      throw new ServiceError('INPUT', '선택한 주소가 필요합니다.', 400);
    }
    const address = await verifyAddress(body.token, env);
    const story = getFullDocentStory(address.sggNm, address.emdNm);
    const packet = preparePlaceAnswer({address, story});
    return Response.json({...packet, media: await placeMedia(story)}, {
      headers: {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'},
    });
  } catch (error) {return errorResponse(error);}
}
