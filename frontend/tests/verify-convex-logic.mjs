// Pure Convex logic: canonical scorer, score inputs, metadata stripping, pHash.
// Node runs the TypeScript sources directly (type stripping).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scoreEvidence } from '../convex/lib/scoring.ts';
import { captureTimeConsistency, gpsConsistency, hammingDistance, scoreInputFor } from '../convex/lib/evidence.ts';
import { stripImageMetadata, UnsupportedImageError } from '../convex/lib/stripMetadata.ts';
import { exifTimestamp, phashFromGrayscale } from '../src/imageEvidence.js';
import { normalizeVision } from '../src/api.js';
import { getDeviceToken } from '../src/deviceToken.js';

const fixture = (name) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
const includes = (bytes, text) => Buffer.from(bytes).includes(Buffer.from(text));

// 1. One scorer: the Convex scorer must reproduce the shared cases that the
//    Python ml_service scorer is also tested against.
const { cases } = JSON.parse(readFileSync(new URL('../../shared/scoring_cases.json', import.meta.url), 'utf8'));
for (const testCase of cases) assert.deepEqual(scoreEvidence(testCase.input), testCase.expected, testCase.name);

// 2. Score inputs are derived from stored data only.
const incident = { confirmations: 2, contradictions: 1 };
const base = { reporterToken: 'a', semanticSimilarity: 0, duplicateEvidence: false, createdAt: 0 };
const single = scoreInputFor(incident, [{ ...base }]);
assert.equal(single.time_proximity, 0, 'a lone report gets no timing credit');
assert.equal('location_consistency' in single, false, 'no free location points');
assert.equal(single.confirmations, 2);
const minute = 60_000;
const cluster = scoreInputFor(incident, [
  { ...base, createdAt: 0, imageStorageId: 's1', visualMatch: 'no' },
  { ...base, reporterToken: 'b', createdAt: 10 * minute, semanticSimilarity: 0.6, imageStorageId: 's2', duplicateEvidence: true, captureTimeStatus: 'conflicting' },
  { ...base, reporterToken: 'b', createdAt: 20 * minute, semanticSimilarity: 0.8, visualMatch: 'partial' },
]);
assert.equal(cluster.distinct_reporters, 2, 'same token counts once');
assert.equal(cluster.time_proximity, 1);
assert.ok(Math.abs(cluster.semantic_agreement - 0.7) < 1e-9);
assert.equal(cluster.unique_images, 1);
assert.equal(cluster.duplicate_images, 1);
assert.equal(cluster.metadata_conflicts, 1);
assert.equal(cluster.visual_match, 'partial', 'latest available visual result');
assert.equal(scoreInputFor(incident, [{ ...base, createdAt: 0 }, { ...base, createdAt: 45 * minute }]).time_proximity, 0, 'outside 30 minutes');

// 3. Consistency checks and near-duplicate distance.
assert.equal(hammingDistance('843b46956ed9275a', '843b46956ed9275a'), 0);
assert.equal(hammingDistance('0000000000000000', '000000000000000f'), 4);
assert.equal(hammingDistance('abc', '0000000000000000'), null);
const reported = Date.parse('2026-09-27T06:00:00Z');
assert.equal(captureTimeConsistency(reported, '2026-09-27T01:50:00-04:00').status, 'consistent');
assert.equal(captureTimeConsistency(reported, '2026-09-20T01:50:00-04:00').status, 'conflicting');
assert.equal(captureTimeConsistency(reported, '2026-09-27T01:50:00').status, 'needs_review');
assert.equal(captureTimeConsistency(reported).status, 'unavailable');
assert.equal(gpsConsistency({ latitude: 39.2555, longitude: -76.7112 }, { latitude: 39.2555, longitude: -76.7112 }).status, 'consistent');
assert.equal(gpsConsistency({ latitude: 39.2555, longitude: -76.7112 }, { latitude: 39.3, longitude: -76.7 }).status, 'conflicting');
assert.equal(gpsConsistency({}, { latitude: 1, longitude: 1 }).status, 'unavailable');

// 4. Server-side metadata stripping removes EXIF/GPS/text but keeps the image.
for (const [name, type] of [['gps.jpg', 'image/jpeg'], ['gps.png', 'image/png'], ['gps.webp', 'image/webp']]) {
  const original = fixture(name);
  assert.ok(includes(original, 'TestCam'), `${name} fixture carries metadata`);
  const { bytes, mimeType } = stripImageMetadata(original);
  assert.equal(mimeType, type);
  for (const marker of ['TestCam', 'Model X', 'Editor 1.0', 'Exif', 'secret location']) assert.ok(!includes(bytes, marker), `${name}: ${marker} removed`);
  assert.ok(bytes.length < original.length);
}
const jpeg = stripImageMetadata(fixture('gps.jpg')).bytes;
assert.deepEqual([...jpeg.subarray(0, 2), ...jpeg.subarray(-2)], [0xff, 0xd8, 0xff, 0xd9]);
assert.throws(() => stripImageMetadata(new TextEncoder().encode('GIF89a....')), UnsupportedImageError);

// 5. Browser pHash matches Python imagehash.phash; EXIF timestamps parse safely.
const reference = JSON.parse(readFileSync(new URL('./fixtures/phash_reference.json', import.meta.url), 'utf8'));
assert.equal(phashFromGrayscale(reference.pixels), reference.phash);
assert.equal(exifTimestamp('2026:09:27 01:50:00', '-04:00'), '2026-09-27T01:50:00-04:00');
assert.equal(exifTimestamp('2026:09:27 01:50:00'), '2026-09-27T01:50:00');
assert.equal(exifTimestamp('garbage'), undefined);

// 6. Vision output is filtered to the shape Convex accepts.
assert.deepEqual(normalizeVision({ status: 'ok', summary: ' Wet floor ', authenticity: { classification: 'fake', confidence: 1 }, visualComparison: { match: 'yes', confidence: 3, reason: 'x', extra: 1 } }),
  { summary: 'Wet floor', visualComparison: { match: 'yes', confidence: 1, reason: 'x' } });
assert.equal(normalizeVision({ status: 'unavailable', summary: null }), undefined);

// 7. Each browser gets its own random reporter token (no shared default).
const store = new Map();
const storage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
const token = getDeviceToken(storage);
assert.match(token, /^[A-Za-z0-9-]{16,64}$/);
assert.equal(getDeviceToken(storage), token);
assert.notEqual(getDeviceToken({ getItem: () => null, setItem() {} }), token);

console.log(`PASS: ${cases.length} shared scoring cases, score inputs, consistency checks, metadata stripping (JPEG/PNG/WebP), pHash parity, vision filtering, device tokens.`);
