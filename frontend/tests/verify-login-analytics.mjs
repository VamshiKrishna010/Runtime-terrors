import assert from 'node:assert/strict';
import { createServer } from 'vite';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createBrowserSession, readBrowserSession, SESSION_KEY } from '../src/browserSession.js';

const values = new Map();
const storage = { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
assert.equal(readBrowserSession(storage), null);
storage.setItem(SESSION_KEY, JSON.stringify(createBrowserSession(100)));
assert.equal(readBrowserSession(storage, 101).mode, 'browser');
assert.equal(readBrowserSession(storage, 100 + 8 * 60 * 60 * 1000), null);
storage.removeItem(SESSION_KEY);
assert.equal(readBrowserSession(storage), null);
storage.setItem(SESSION_KEY, '{broken');
assert.equal(readBrowserSession(storage), null);
assert.equal(readBrowserSession({ getItem() { throw Error('blocked'); } }), null);

const server = await createServer({ server: { middlewareMode: true }, ssr: { external: ['react', 'react-dom', 'lucide-react', 'recharts', 'convex', 'convex/react'] } });
try {
  const { normalizeAnalytics, AnalyticsContent, AnalyticsError, AnalyticsLoading, analyticsArgs } = await server.ssrLoadModule('/src/Analytics.jsx');
  const { LoginScreen } = await server.ssrLoadModule('/src/AuthGate.jsx');
  for (const value of [null, [], {}, { total_incidents: 1 }]) assert.throws(() => normalizeAnalytics(value));
  const empty = normalizeAnalytics({ summary: { active_incidents: 0 } });
  assert.deepEqual(empty.available_locations, []);
  assert.equal(empty.community.confirmation_ratio, null);
  assert.ok(renderToStaticMarkup(React.createElement(AnalyticsContent, { data: empty })).includes('No analytics yet'));
  const partial = normalizeAnalytics({ summary: { active_incidents: 1 }, recent_incidents: [null, { id: 1, title: 'Example incident', updated_at: '2026-09-27T00:00:00Z' }] });
  const populated = renderToStaticMarkup(React.createElement(AnalyticsContent, { data: partial, onSelectIncident() {} }));
  assert.ok(populated.includes('Recent Incident Activity'));
  assert.ok(!populated.includes('NaN'));
  assert.ok(renderToStaticMarkup(React.createElement(AnalyticsError, { retry() {} })).includes('Analytics unavailable'));
  assert.ok(renderToStaticMarkup(React.createElement(AnalyticsLoading)).includes('Loading analytics'));
  assert.deepEqual(analyticsArgs({ range: '7d', location: 'The Commons', category: '', evidence_level: 'Strong' }), { range: '7d', location: 'The Commons', evidenceLevel: 'Strong' });
  const { incidentNotifications } = await server.ssrLoadModule('/src/HeaderControls.jsx');
  const now = Date.parse('2026-09-27T12:00:00Z');
  const notes = incidentNotifications([
    { _id: 'a', title: 'Old', location: 'ITE', createdAt: now - 3 * 86400000, reportCount: 1, confirmations: 0, contradictions: 0 },
    { _id: 'b', title: 'Wi-Fi down', location: 'ITE', createdAt: now - 1000, reportCount: 1, confirmations: 0, contradictions: 0 },
    { _id: 'c', title: 'Leak', location: 'Library', createdAt: now - 5000, updatedAt: now - 10, reportCount: 3, confirmations: 2, contradictions: 0, evidenceLevel: 'Strong', supportScore: 70 },
  ], now);
  assert.deepEqual(notes.map((note) => note.id), ['c', 'b'], 'recent real incidents only, newest first');
  assert.ok(notes[0].message.includes('Strong (70/100, 3 reports)'));
  assert.ok(notes[1].message.startsWith('New incident reported at ITE'));
  const login = renderToStaticMarkup(React.createElement(LoginScreen, { onSignIn() {}, busy: false, error: '' }));
  assert.ok(login.includes('Browser access'));
  assert.ok(login.includes('app@veripulse.local'));
  assert.ok(!login.includes('type="password"'));
  console.log('PASS: browser session persistence/expiry/logout, login markup, analytics partial/empty/error/loading states filter serialization and live notifications.');
} finally { await server.close(); }
