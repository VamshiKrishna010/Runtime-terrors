import assert from 'node:assert/strict';
import { createServer } from 'vite';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createDemoSession, readDemoSession, SESSION_KEY } from '../src/demoSession.js';

const values = new Map();
const storage = { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
assert.equal(readDemoSession(storage), null);
storage.setItem(SESSION_KEY, JSON.stringify(createDemoSession(100)));
assert.equal(readDemoSession(storage, 101).mode, 'demo');
assert.equal(readDemoSession(storage, 100 + 8 * 60 * 60 * 1000), null);
storage.removeItem(SESSION_KEY);
assert.equal(readDemoSession(storage), null);
storage.setItem(SESSION_KEY, '{broken');
assert.equal(readDemoSession(storage), null);
assert.equal(readDemoSession({ getItem() { throw Error('blocked'); } }), null);

const server = await createServer({ server: { middlewareMode: true }, ssr: { external: ['react', 'react-dom', 'lucide-react', 'recharts'] } });
try {
  const { normalizeAnalytics, AnalyticsContent, AnalyticsError, AnalyticsLoading, analyticsQuery } = await server.ssrLoadModule('/src/Analytics.jsx');
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
  assert.ok(analyticsQuery({ range: '7d', location: 'The Commons', category: '' }).includes('location=The+Commons'));
  const login = renderToStaticMarkup(React.createElement(LoginScreen, { onSignIn() {}, busy: false, error: '' }));
  assert.ok(login.includes('Hackathon demo mode'));
  assert.ok(login.includes('demo@veripulse.local'));
  assert.ok(!login.includes('type="password"'));
  console.log('PASS: demo session persistence/expiry/logout, login markup, analytics partial/empty/error/loading states and filter serialization.');
} finally { await server.close(); }
