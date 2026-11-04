export class UnsupportedImageError extends Error {
  constructor(message = "Only JPEG, PNG and WebP photos are supported.") {
    super(message);
    this.name = "UnsupportedImageError";
  }
}

const ascii = (bytes: Uint8Array, start: number, length: number) =>
  String.fromCharCode(...bytes.subarray(start, start + length));
const u32be = (bytes: Uint8Array, offset: number) =>
  ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
const u32le = (bytes: Uint8Array, offset: number) =>
  (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
const writeU32le = (target: Uint8Array, offset: number, value: number) => {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
  target[offset + 2] = (value >>> 16) & 0xff;
  target[offset + 3] = (value >>> 24) & 0xff;
};
const join = (parts: Uint8Array[]) => {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
};

function stripJpeg(bytes: Uint8Array) {
  const parts = [bytes.slice(0, 2)];
  let offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) throw new UnsupportedImageError("The JPEG file is malformed.");
    let markerOffset = offset;
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd9) {
      parts.push(bytes.slice(markerOffset, offset));
      return join(parts);
    }
    if (marker === 0xda) {
      parts.push(bytes.slice(markerOffset));
      return join(parts);
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      parts.push(bytes.slice(markerOffset, offset));
      continue;
    }
    if (offset + 2 > bytes.length) throw new UnsupportedImageError("The JPEG file is truncated.");
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    const end = offset + length;
    if (length < 2 || end > bytes.length) throw new UnsupportedImageError("The JPEG file is malformed.");
    const metadata = (marker >= 0xe0 && marker <= 0xef) || marker === 0xfe;
    if (!metadata) parts.push(bytes.slice(markerOffset, end));
    offset = end;
  }
  throw new UnsupportedImageError("The JPEG file has no image data.");
}

function stripPng(bytes: Uint8Array) {
  const parts = [bytes.slice(0, 8)];
  let offset = 8;
  let ended = false;
  while (offset + 12 <= bytes.length) {
    const length = u32be(bytes, offset);
    const end = offset + 12 + length;
    if (end > bytes.length) throw new UnsupportedImageError("The PNG file is truncated.");
    const type = ascii(bytes, offset + 4, 4);
    // Uppercase first character marks a critical chunk. tRNS affects pixels.
    if ((bytes[offset + 4] & 0x20) === 0 || type === "tRNS") parts.push(bytes.slice(offset, end));
    offset = end;
    if (type === "IEND") {
      ended = true;
      break;
    }
  }
  if (!ended) throw new UnsupportedImageError("The PNG file has no IEND chunk.");
  return join(parts);
}

function stripWebp(bytes: Uint8Array) {
  const chunks: Uint8Array[] = [];
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const size = u32le(bytes, offset + 4);
    const paddedEnd = offset + 8 + size + (size & 1);
    if (paddedEnd > bytes.length) throw new UnsupportedImageError("The WebP file is truncated.");
    const type = ascii(bytes, offset, 4);
    if (type !== "EXIF" && type !== "XMP " && type !== "ICCP") {
      const chunk = bytes.slice(offset, paddedEnd);
      if (type === "VP8X" && size >= 1) chunk[8] &= ~(0x20 | 0x08 | 0x04);
      chunks.push(chunk);
    }
    offset = paddedEnd;
  }
  if (!chunks.some((chunk) => ["VP8 ", "VP8L", "VP8X"].includes(ascii(chunk, 0, 4)))) {
    throw new UnsupportedImageError("The WebP file has no image data.");
  }
  const body = join(chunks);
  const result = new Uint8Array(12 + body.length);
  result.set(bytes.slice(0, 12), 0);
  writeU32le(result, 4, result.length - 8);
  result.set(body, 12);
  return result;
}

export function stripImageMetadata(bytes: Uint8Array): { bytes: Uint8Array<ArrayBuffer>; mimeType: string } {
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    return { bytes: new Uint8Array(stripJpeg(bytes)), mimeType: "image/jpeg" };
  }
  if (bytes.length >= 8 && bytes.slice(0, 8).every((value, index) => value === [137, 80, 78, 71, 13, 10, 26, 10][index])) {
    return { bytes: new Uint8Array(stripPng(bytes)), mimeType: "image/png" };
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    return { bytes: new Uint8Array(stripWebp(bytes)), mimeType: "image/webp" };
  }
  throw new UnsupportedImageError();
}
