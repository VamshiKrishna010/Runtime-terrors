// A random, per-browser pseudonym used to count distinct reporters and to
// dedupe votes. It is not an identity and is never shown to other users.
const KEY = 'veripulse.device-token.v1';
const PATTERN = /^[A-Za-z0-9-]{16,64}$/;
let memoryToken = null;

function randomToken() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function getDeviceToken(storage = globalThis.localStorage) {
  try {
    const stored = storage?.getItem(KEY);
    if (stored && PATTERN.test(stored)) return stored;
    const token = randomToken();
    storage?.setItem(KEY, token);
    return token;
  } catch {
    // Storage blocked (private mode): keep one token for this page session.
    memoryToken ||= randomToken();
    return memoryToken;
  }
}
