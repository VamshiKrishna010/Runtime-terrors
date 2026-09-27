import { createServer } from 'vite';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const fixture = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const server = await createServer({ root: process.cwd(), ssr: { external: ['react', 'react-dom', 'lucide-react'] }, server: { middlewareMode: true } });
try {
  const { adaptEvidence } = await server.ssrLoadModule('/src/evidenceAdapter.js');
  const { EvidenceCard, EvidenceInspector } = await server.ssrLoadModule('/src/EvidenceCenter.jsx');
  for (const item of fixture) {
    const evidence = adaptEvidence(item);
    assert.ok(evidence.preview.startsWith('http://127.0.0.1:8000/uploads/'));
    assert.equal(evidence.contentRows.at(-1).status, 'Unavailable');
    for (const component of [EvidenceCard, EvidenceInspector]) {
      const html = renderToStaticMarkup(React.createElement(component, { evidence, selected: true, review: evidence.review, onSelect() {}, onReview() {} }));
      assert.ok(html.includes(item.url));
      assert.ok(!html.includes('SIMULATED PREVIEW'));
      assert.ok(!html.includes('demo-elevator'));
      assert.ok(!html.includes('undefined'));
    }
  }
  assert.equal(adaptEvidence(fixture[0]).review, 'Reviewed');
  console.log('PASS: real API evidence renders in library and inspector; review and unavailable analysis preserved.');
} finally { await server.close(); }
