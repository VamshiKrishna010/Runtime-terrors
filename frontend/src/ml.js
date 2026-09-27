const mlServiceUrl = (import.meta.env.VITE_ML_SERVICE_URL || 'http://127.0.0.1:8001').replace(/\/$/, '');

async function mlRequest(path, payload) {
  const response = await fetch(`${mlServiceUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.detail?.message || body?.detail || 'ML analysis is unavailable.');
  return body;
}

export async function embedDescription(description) {
  const result = await mlRequest('/embed', { texts: [description] });
  return result.embeddings[0];
}

export async function scoreEvidence(input) {
  return mlRequest('/score', input);
}
