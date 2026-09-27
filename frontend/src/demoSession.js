export const SESSION_KEY = 'veripulse.demo-session.v1';
export const DEMO_ACCOUNT = { name: 'Runtime Terrors', email: 'demo@veripulse.local', initials: 'RT', team: 'Runtime Terrors', event: 'HackUMBC' };
export function createDemoSession(now = Date.now()) { return { mode: 'demo', expiresAt: now + 8 * 60 * 60 * 1000 }; }
export function readDemoSession(storage, now = Date.now()) {
  try {
    const value = JSON.parse(storage.getItem(SESSION_KEY));
    return value?.mode === 'demo' && Number.isFinite(value.expiresAt) && value.expiresAt > now ? value : null;
  } catch { return null; }
}
