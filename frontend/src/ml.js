// MiniLM sentence embeddings for clustering.
//
// If VITE_ML_SERVICE_URL is set (Docker Compose sets it to /ml), the Python
// ml_service computes them. Otherwise the same model runs in the browser, so
// the static GitHub Pages build needs no server to accept reports. Both use
// sentence-transformers/all-MiniLM-L6-v2 with mean pooling + L2 normalisation.

const mlServiceUrl = (import.meta.env.VITE_ML_SERVICE_URL || '').replace(/\/$/, '');
const BROWSER_MODEL = 'Xenova/all-MiniLM-L6-v2';
let extractorPromise = null;

async function embedWithService(text) {
  const response = await fetch(`${mlServiceUrl}/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ texts: [text] }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.detail?.message || body?.detail || 'The embedding service is unavailable.');
  return body.embeddings[0];
}

async function embedInBrowser(text) {
  extractorPromise ||= import('@huggingface/transformers')
    .then(({ pipeline }) => pipeline('feature-extraction', BROWSER_MODEL))
    .catch((error) => { extractorPromise = null; throw error; });
  const extractor = await extractorPromise;
  const output = await extractor(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

/** Start downloading the in-browser model early (e.g. when the form opens). */
export function preloadEmbeddings() {
  if (!mlServiceUrl) embedInBrowser('warm up').catch(() => {});
}

export async function embedDescription(description) {
  try {
    return mlServiceUrl ? await embedWithService(description) : await embedInBrowser(description);
  } catch (error) {
    throw new Error(`Could not analyse the description (${error.message || 'embedding unavailable'}). Please try again.`);
  }
}
