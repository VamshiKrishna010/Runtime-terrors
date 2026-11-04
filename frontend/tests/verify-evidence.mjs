// Renders a Convex evidence.list item through the adapter, card and inspector.
import { createServer } from 'vite';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import assert from 'node:assert/strict';

const item = {
  id: 'k57abc123def456', label: 'EV-DEF456', report_id: 'k57abc123def456', incident_id: 'j97incident0001',
  title: 'Facilities: water leaking near library entrance', reported_claim: 'Water leaking near the library entrance',
  location: 'Library', type: 'image', url: 'https://example-123.convex.cloud/api/storage/abc',
  mime_type: 'image/jpeg', file_size: 2048, uploaded_at: '2026-09-27T06:00:00.000Z',
  sha256_hash: 'a'.repeat(64), perceptual_hash: '843b46956ed9275a',
  metadata: { camera_device: 'TestCam Model X', width: 40, height: 30, capture_timestamp: '2026-09-27T01:50:00-04:00', editing_software: null, exif_available: true },
  provenance: { source: 'gallery_upload', in_app_capture: null, server_received_at: '2026-09-27T06:00:00.000Z', reporter_id: 'report-def456', metadata_stripped: true },
  duplicate_analysis: { status: 'No duplicate evidence found', duplicate_count: 0, closest_duplicate_distance: null, duplicate_of: null, first_seen_at: '2026-09-27T06:00:00.000Z' },
  time_consistency: { reported_at: '2026-09-27T06:00:00.000Z', captured_at: '2026-09-27T01:50:00-04:00', difference_seconds: 600, status: 'consistent' },
  location_consistency: { reported_coordinates: false, evidence_coordinates: true, distance_meters: null, status: 'unavailable' },
  content_consistency: { reported_claim: 'Water leaking', visual_summary: null, score: null, status: 'unavailable', reason: null },
  authenticity: { classification: 'likely_real', confidence: 0.8, reason: 'Natural lighting' },
  status: 'consistent', support_contribution: 4, review_state: 'reviewed',
  timeline: [{ title: 'Evidence uploaded', timestamp: '2026-09-27T06:00:00.000Z' }],
};

const server = await createServer({ root: process.cwd(), logLevel: 'error', ssr: { external: ['react', 'react-dom', 'lucide-react', 'convex'] }, server: { middlewareMode: true } });
try {
  const { adaptEvidence } = await server.ssrLoadModule('/src/evidenceAdapter.js');
  const { EvidenceCard, EvidenceInspector } = await server.ssrLoadModule('/src/EvidenceCenter.jsx');
  const evidence = adaptEvidence(item);
  assert.equal(evidence.preview, item.url);
  assert.equal(evidence.review, 'Reviewed');
  assert.equal(evidence.contentRows.find((row) => row.label === 'Visual comparison').status, 'Unavailable');
  for (const component of [EvidenceCard, EvidenceInspector]) {
    const html = renderToStaticMarkup(React.createElement(component, { evidence, selected: true, review: evidence.review, onSelect() {}, onReview() {} }));
    assert.ok(html.includes(item.url));
    assert.ok(html.includes('EV-DEF456'));
    assert.ok(!html.includes('undefined'));
    assert.ok(!html.includes('NaN'));
  }
  const inspector = renderToStaticMarkup(React.createElement(EvidenceInspector, { evidence, onReview() {} }));
  assert.ok(inspector.includes('EXIF/XMP removed before storage'));
  assert.ok(inspector.includes('likely real'));
  // A legacy item without a servable URL renders a placeholder, not a broken image.
  const legacy = adaptEvidence({ ...item, url: null, file_size: null, provenance: { ...item.provenance, metadata_stripped: false } });
  assert.equal(legacy.preview, null);
  assert.ok(renderToStaticMarkup(React.createElement(EvidenceCard, { evidence: legacy, review: legacy.review, onSelect() {} })).includes('Preview unavailable'));
  console.log('PASS: Convex evidence renders in library and inspector; stripped-metadata provenance, authenticity and legacy placeholders shown.');
} finally { await server.close(); }
