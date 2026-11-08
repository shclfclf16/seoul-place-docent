/** JPEG EXIF GPS is read locally. Coordinates use x=longitude, y=latitude. */
export const MAX_PHOTO_BYTES = 20 * 1024 * 1024;
export type PhotoPoint = {x: number; y: number};

function tiffGps(view: DataView, start: number, end: number): PhotoPoint | null {
  const little = view.getUint16(start) === 0x4949;
  if (!little && view.getUint16(start) !== 0x4d4d) return null;
  const check = (offset: number, size: number) => {
    if (offset < start || offset + size > end) throw new Error('Invalid EXIF offset');
  };
  const u16 = (offset: number) => {check(offset, 2); return view.getUint16(offset, little);};
  const u32 = (offset: number) => {check(offset, 4); return view.getUint32(offset, little);};
  if (u16(start + 2) !== 42) return null;
  const ifd = start + u32(start + 4);
  const count = u16(ifd);
  if (count > 1024) return null;
  check(ifd + 2, count * 12);
  let gps = 0;
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (u16(entry) === 0x8825 && u16(entry + 2) === 4 && u32(entry + 4) === 1) {
      gps = start + u32(entry + 8);
    }
  }
  if (!gps) return null;
  const gpsCount = u16(gps);
  if (gpsCount > 64) return null;
  check(gps + 2, gpsCount * 12);
  let latitude: number[] | undefined, longitude: number[] | undefined;
  let northSouth = '', eastWest = '';
  for (let i = 0; i < gpsCount; i++) {
    const entry = gps + 2 + i * 12;
    const tag = u16(entry), type = u16(entry + 2), length = u32(entry + 4);
    if ((tag === 1 || tag === 3) && type === 2 && length === 2) {
      const direction = String.fromCharCode(view.getUint8(entry + 8));
      if (tag === 1) northSouth = direction;
      else eastWest = direction;
    }
    if ((tag === 2 || tag === 4) && type === 5 && length === 3) {
      const offset = start + u32(entry + 8);
      check(offset, 24);
      const values = [];
      for (let j = 0; j < 3; j++) {
        const denominator = u32(offset + j * 8 + 4);
        if (!denominator) return null;
        values.push(u32(offset + j * 8) / denominator);
      }
      if (tag === 2) latitude = values;
      else longitude = values;
    }
  }
  if (!latitude || !longitude || !['N', 'S'].includes(northSouth) || !['E', 'W'].includes(eastWest)) return null;
  if ([latitude, longitude].some(parts => parts[1] >= 60 || parts[2] >= 60)) return null;
  const degrees = (parts: number[]) => parts[0] + parts[1] / 60 + parts[2] / 3600;
  const y = degrees(latitude) * (northSouth === 'S' ? -1 : 1);
  const x = degrees(longitude) * (eastWest === 'W' ? -1 : 1);
  return Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) <= 180 && Math.abs(y) <= 90 ? {x, y} : null;
}

export function readPhotoGps(buffer: ArrayBuffer): PhotoPoint | null {
  try {
    const view = new DataView(buffer);
    if (view.byteLength < 4 || view.byteLength > MAX_PHOTO_BYTES || view.getUint16(0) !== 0xffd8) return null;
    let position = 2;
    while (position + 1 < view.byteLength) {
      if (view.getUint8(position++) !== 0xff) return null;
      while (position < view.byteLength && view.getUint8(position) === 0xff) position++;
      if (position >= view.byteLength) return null;
      const marker = view.getUint8(position++);
      if (marker === 0xda || marker === 0xd9) return null;
      if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
      const size = view.getUint16(position);
      const end = position + size;
      if (size < 2 || end > view.byteLength) return null;
      if (marker === 0xe1 && size >= 16 && view.getUint32(position + 2) === 0x45786966 && view.getUint16(position + 6) === 0) {
        const point = tiffGps(view, position + 8, end);
        if (point) return point;
      }
      position = end;
    }
    return null;
  } catch {return null;}
}

export function photoFileIssue(file: {size: number; type: string; name: string}): 'size' | 'format' | null {
  if (!file.size || file.size > MAX_PHOTO_BYTES) return 'size';
  if (file.type ? !['image/jpeg', 'image/jpg'].includes(file.type.toLowerCase()) : !/\.jpe?g$/i.test(file.name)) return 'format';
  return null;
}
