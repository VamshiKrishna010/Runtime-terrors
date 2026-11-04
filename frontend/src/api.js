// Optional vision-analysis service (backend/). Everything else talks to Convex.
//
// VITE_API_URL wins when set. Otherwise dev/Docker use the /api proxy, and the
// GitHub Pages build has no analysis service, so the vision step is skipped.
const env = import.meta.env || {}; // undefined outside Vite (node tests)
export const API = (env.VITE_API_URL ?? (env.VITE_DEPLOY_TARGET === 'github-pages' ? '' : '/api')).replace(/\/$/, '');
export const analysisAvailable = Boolean(API);

const pick = (value, keys) => (value && typeof value === 'object' ? Object.fromEntries(keys.map((key) => [key, value[key]])) : undefined);
const unit = (value) => (typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0);

/** Keep only well-formed fields, in the shape Convex's `vision` validator expects. */
export function normalizeVision(body) {
  if (!body || typeof body !== 'object') return undefined;
  const vision = {};
  if (typeof body.summary === 'string' && body.summary.trim()) vision.summary = body.summary.trim();
  const authenticity = pick(body.authenticity, ['classification', 'confidence', 'reason']);
  if (authenticity && ['likely_real', 'uncertain', 'suspicious'].includes(authenticity.classification)) {
    vision.authenticity = { classification: authenticity.classification, confidence: unit(authenticity.confidence), reason: String(authenticity.reason || '') };
  }
  const comparison = pick(body.visualComparison, ['match', 'confidence', 'reason']);
  if (comparison && ['yes', 'partial', 'no', 'unavailable'].includes(comparison.match)) {
    vision.visualComparison = { match: comparison.match, confidence: unit(comparison.confidence), reason: String(comparison.reason || '') };
  }
  return Object.keys(vision).length ? vision : undefined;
}

/**
 * Ask the vision service about a photo. Never blocks a report: any failure
 * (offline, rate limited, no API key) resolves to undefined.
 */
export async function analyzeImage(file, description, { timeoutMs = 45000 } = {}) {
  if (!analysisAvailable) return undefined;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const form = new FormData();
    form.append('image', file);
    form.append('description', description);
    const response = await fetch(`${API}/evidence/analyze`, { method: 'POST', body: form, signal: controller.signal });
    if (!response.ok) return undefined;
    return normalizeVision(await response.json());
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

export function safeUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value, globalThis.location?.href);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
