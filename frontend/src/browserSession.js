export const SESSION_KEY = 'veripulse.browser-session.v1';
export const APP_ACCOUNT = { name: 'Runtime Terrors', email: 'app@veripulse.local', initials: 'RT', team: 'Runtime Terrors', event: 'HackUMBC' };
export function createBrowserSession(now = Date.now()) { return { mode: 'browser', expiresAt: now + 8 * 60 * 60 * 1000 }; }
export function readBrowserSession(storage, now = Date.now()) {
  try {
    const value = JSON.parse(storage.getItem(SESSION_KEY));
    return value?.mode === 'browser' && Number.isFinite(value.expiresAt) && value.expiresAt > now ? value : null;
  } catch { return null; }
}
