export const API = (import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');

export async function requestJson(path, options) {
  const response = await fetch(`${API}${path}`, options);
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = body?.detail;
    const message = typeof detail === 'string' ? detail : Array.isArray(detail)
      ? detail.map((error) => `${error.loc?.slice(1).join('.') || 'Input'}: ${error.msg}`).join('; ')
      : `Request failed (${response.status})`;
    throw new Error(message);
  }
  return body;
}

export function mediaUrl(path) {
  if (!path) return null;
  try {
    const url = new URL(path, `${API}/`);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}
