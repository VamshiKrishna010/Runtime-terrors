// Measurements taken in the browser from the original photo before upload.
// The server strips the file's metadata before storing it, so this is the only
// point where capture time and camera details can be read. Raw GPS is sent
// once so Convex can compare it with the reported pin; it is never stored.

export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export function validateImage(file) {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) return 'Photos must be JPEG, PNG or WebP.';
  if (file.size > MAX_IMAGE_BYTES) return 'Photos must be 10 MB or smaller.';
  return '';
}

/** Convert an EXIF "YYYY:MM:DD HH:MM:SS" (+ optional offset) to ISO 8601. */
export function exifTimestamp(value, offset) {
  const match = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(String(value || ''));
  if (!match) return undefined;
  const [, year, month, day, hour, minute, second] = match;
  const zone = /^[+-]\d{2}:\d{2}$/.test(String(offset || '')) ? offset : '';
  const iso = `${year}-${month}-${day}T${hour}:${minute}:${second}${zone}`;
  const timestamp = zone ? iso : `${iso}Z`;
  return Number.isNaN(Date.parse(timestamp)) ? undefined : iso;
}

/**
 * 64-bit perceptual hash, same construction as Python imagehash.phash:
 * grayscale -> 32x32 -> 2D DCT-II -> top-left 8x8 -> bits above the median.
 * `pixels` is a 1024-length row-major grayscale array.
 */
export function phashFromGrayscale(pixels) {
  const size = 32;
  const low = 8;
  const cos = Array.from({ length: low }, (_, k) => Array.from({ length: size }, (_, n) => Math.cos((Math.PI * k * (2 * n + 1)) / (2 * size))));
  const coefficients = [];
  for (let k = 0; k < low; k += 1) {
    for (let l = 0; l < low; l += 1) {
      let sum = 0;
      for (let n = 0; n < size; n += 1) {
        let row = 0;
        for (let m = 0; m < size; m += 1) row += pixels[n * size + m] * cos[l][m];
        sum += row * cos[k][n];
      }
      coefficients.push(4 * sum);
    }
  }
  const sorted = [...coefficients].sort((a, b) => a - b);
  const median = (sorted[31] + sorted[32]) / 2;
  let hex = '';
  for (let index = 0; index < coefficients.length; index += 4) {
    const nibble = coefficients.slice(index, index + 4).reduce((value, coefficient) => (value << 1) | (coefficient > median ? 1 : 0), 0);
    hex += nibble.toString(16);
  }
  return hex;
}

async function decodeForHash(file) {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(32, 32) : Object.assign(document.createElement('canvas'), { width: 32, height: 32 });
    const context = canvas.getContext('2d');
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, 32, 32);
    const { data } = context.getImageData(0, 0, 32, 32);
    const gray = new Array(1024);
    for (let index = 0; index < 1024; index += 1) {
      gray[index] = (data[index * 4] * 299 + data[index * 4 + 1] * 587 + data[index * 4 + 2] * 114) / 1000;
    }
    return { width: bitmap.width, height: bitmap.height, phash: phashFromGrayscale(gray) };
  } finally {
    bitmap.close?.();
  }
}

async function readExif(file) {
  try {
    const { default: exifr } = await import('exifr');
    const [tags, gps] = await Promise.all([
      exifr.parse(file, { tiff: true, exif: true, gps: false, reviveValues: false,
        pick: ['DateTimeOriginal', 'CreateDate', 'OffsetTimeOriginal', 'OffsetTime', 'Make', 'Model', 'Software'] }).catch(() => null),
      exifr.gps(file).catch(() => null),
    ]);
    const exifGps = gps && Number.isFinite(gps.latitude) && Number.isFinite(gps.longitude) ? { latitude: gps.latitude, longitude: gps.longitude } : undefined;
    const clean = (value) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, 200) : undefined);
    return {
      exifDatetime: exifTimestamp(tags?.DateTimeOriginal || tags?.CreateDate, tags?.OffsetTimeOriginal || tags?.OffsetTime),
      exifGps,
      cameraDevice: clean([tags?.Make, tags?.Model].filter((part) => typeof part === 'string').join(' ')),
      editingSoftware: clean(tags?.Software),
    };
  } catch {
    return {};
  }
}

/** All measurements, omitting anything unavailable (Convex rejects nulls). */
export async function measureImage(file) {
  const [decoded, exif] = await Promise.all([decodeForHash(file).catch(() => ({})), readExif(file)]);
  return Object.fromEntries(Object.entries({ ...decoded, ...exif }).filter(([, value]) => value !== undefined && value !== ''));
}
