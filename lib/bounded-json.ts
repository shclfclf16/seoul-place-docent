import {ServiceError} from './providers';

/** Limit streamed bodies before buffering them, including requests without Content-Length. */
export async function readBoundedJson(request: Request, maxBytes: number): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) {
    throw new ServiceError('TYPE', 'JSON 요청이 필요합니다.', 415);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new ServiceError('INPUT', '요청 내용을 확인해 주세요.', 400);
  let size = 0, text = '';
  const decoder = new TextDecoder();
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maxBytes) {await reader.cancel(); throw new ServiceError('SIZE', '요청이 너무 큽니다.', 413);}
      text += decoder.decode(part.value, {stream: true});
    }
    text += decoder.decode();
  } finally {reader.releaseLock();}
  try {return JSON.parse(text);} catch {throw new ServiceError('INPUT', '요청 형식을 확인해 주세요.', 400);}
}
