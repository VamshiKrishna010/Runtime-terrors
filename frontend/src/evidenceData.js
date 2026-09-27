// Demo records only. Replace the EvidenceCenter `evidence` prop with API records later.
const stamp = (time) => `2026-09-26T${time}:00-04:00`;
const row = (label, value, status = 'Consistent') => ({ label, value, status });

function preview(scene) {
  const scenes = {
    wifi: '<rect x="90" y="45" width="460" height="230" rx="12" fill="white"/><path d="M240 125 Q320 55 400 125 M265 155 Q320 105 375 155 M295 185 Q320 160 345 185" fill="none" stroke="#6b7c93" stroke-width="12"/><circle cx="320" cy="210" r="8" fill="#6b7c93"/><text x="320" y="252" text-anchor="middle" fill="#10233c" font-size="18">Unable to connect to eduroam</text>',
    flood: '<path d="M0 120L160 65 250 120 430 60 640 115V320H0Z" fill="#ccd8df"/><path d="M210 120H430L560 320H80Z" fill="#f3f5f7"/><ellipse cx="320" cy="225" rx="170" ry="52" fill="#9dbfd4"/><path d="M180 225H290M320 245H450M290 205H400" stroke="#eaf2ff" stroke-width="5"/>',
    elevator: '<rect x="155" y="35" width="330" height="285" rx="6" fill="#8c9ba9"/><rect x="178" y="60" width="284" height="260" fill="#d7dfe7"/><path d="M320 60V320" stroke="#6b7c93" stroke-width="3"/><rect x="235" y="142" width="170" height="65" rx="4" fill="white"/><text x="320" y="170" text-anchor="middle" fill="#10233c" font-size="15">OUT OF SERVICE</text><text x="320" y="192" text-anchor="middle" fill="#6b7c93" font-size="12">Please use the stairs</text>',
  };
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360"><rect width="640" height="360" fill="#eaf0f5"/>${scenes[scene]}<rect y="320" width="640" height="40" fill="#10233c"/><text x="320" y="346" text-anchor="middle" fill="white" font-family="sans-serif" font-size="15">SIMULATED PREVIEW ? DEMO EVIDENCE</text></svg>`)}`;
}

function record(config) {
  const conflict = config.status === 'Metadata conflict';
  const mismatch = config.id === 'EV-006';
  const screenshot = config.type === 'Screenshot';
  const video = config.type === 'Video';
  const live = !!config.live;
  const uploadedAt = stamp(config.time);
  const capturedAt = conflict ? '2026-06-26T19:42:00-04:00' : stamp(config.capture);
  const gps = screenshot ? 'Unavailable' : mismatch ? 'Approx. 1.8 km from Commons' : `Near ${config.location}`;
  return {
    ...config, uploadedAt, capturedAt, reportAt: uploadedAt,
    preview: preview(config.scene), previewAlt: `Illustrated demo preview: ${config.claim}`,
    metadataConflict: conflict, locationMismatch: mismatch,
    imageKey: config.duplicateOf || config.id,
    reporter: `anon-${config.id.slice(-3)}-demo`,
    metadata: [
      row('Camera / device', screenshot ? 'Browser screenshot' : 'Apple iPhone 15'),
      row('Dimensions', screenshot ? '1440 ? 900 px' : video ? '1920 ? 1080 px' : '4032 ? 3024 px'),
      row('Capture timestamp', capturedAt, conflict ? 'Conflicting' : 'Consistent'),
      row('Upload timestamp', uploadedAt),
      row('GPS', gps, screenshot ? 'Unavailable' : mismatch ? 'Conflicting' : 'Consistent'),
      row('Software / editing', conflict ? 'Adobe Photoshop' : screenshot ? 'Browser export' : 'iOS Camera', conflict ? 'Review' : 'Consistent'),
      row('File type', video ? 'video/mp4' : screenshot ? 'image/png' : 'image/jpeg'),
      row('File size', video ? '8.2 MB' : screenshot ? '420 KB' : '2.4 MB'),
      row('EXIF availability', screenshot ? 'No EXIF in this screenshot' : video ? 'Partial container metadata' : 'Available', screenshot ? 'Unavailable' : video ? 'Review' : 'Consistent'),
    ],
    provenance: live ? 'Strong provenance' : screenshot ? 'Uploaded evidence' : 'Partial provenance',
    hash: `demo-sha256-${config.duplicateOf || config.id}-7c92a1 (illustrative)`,
    gps, distance: screenshot ? 'Unavailable' : mismatch ? '1.8 km' : '62 m',
    timeDifference: conflict ? '92 days earlier' : '3 minutes earlier',
    signals: [
      row('Image matches report', 'Visible content is consistent with the reported claim'),
      row('Timestamp consistent', conflict ? 'Capture predates report by 92 days' : 'Captured 3 minutes before report', conflict ? 'Conflicting' : 'Consistent'),
      row('Location consistent', gps, screenshot ? 'Unavailable' : mismatch ? 'Conflicting' : 'Consistent'),
      row('Metadata available', screenshot ? 'EXIF unavailable' : 'Capture fields available', screenshot ? 'Unavailable' : 'Consistent'),
      row(config.duplicateOf ? 'Duplicate image' : 'Unique image', config.duplicateOf ? `Similar to ${config.duplicateOf}; no independent image support` : 'No match in demo collection', config.duplicateOf ? 'Review' : 'Consistent'),
      row('Independent reporter', 'Anonymous ID alone cannot establish independence', 'Review'),
      row('Live capture provenance', live ? 'In-app capture recorded' : 'Gallery upload; capture chain unavailable', live ? 'Consistent' : 'Unavailable'),
      row('Community corroboration', '3 mock confirmations; not proof of the claim'),
      ...(conflict ? [row('Metadata conflict / old timestamp', 'Capture time conflicts with current report', 'Conflicting'), row('Editing metadata present', 'Adobe Photoshop tag requires context', 'Review')] : []),
      ...(mismatch ? [row('Location mismatch', 'GPS is outside the claimed incident area', 'Conflicting')] : []),
    ],
  };
}

export const mockEvidence = [
  record({ id: 'EV-001', incidentId: 'demo-wifi', title: 'Wi-Fi outage in ITE', location: 'ITE Building', type: 'Screenshot', status: 'Consistent', score: 16, time: '20:10', capture: '20:07', scene: 'wifi', claim: 'eduroam is unavailable in ITE', visualSummary: 'A network connection error is visible. A screenshot alone cannot establish the extent of an outage.' }),
  record({ id: 'EV-002', incidentId: 'demo-flood', title: 'Flooded Library walkway', location: 'Library walkway', type: 'Image', status: 'Strong support', score: 23, time: '20:15', capture: '20:12', scene: 'flood', live: true, claim: 'Flooding near Library walkway', visualSummary: 'Water accumulation is visible on a pedestrian walkway.' }),
  record({ id: 'EV-003', incidentId: 'demo-elevator', title: 'Broken elevator in Commons', location: 'Commons', type: 'Image', status: 'Consistent', score: 18, time: '20:20', capture: '20:17', scene: 'elevator', claim: 'Commons elevator is out of service', visualSummary: 'Elevator doors display an out-of-service notice.' }),
  record({ id: 'EV-004', incidentId: 'demo-flood', title: 'Library walkway resubmission', location: 'Library walkway', type: 'Image', status: 'Duplicate', score: 3, time: '20:25', capture: '20:22', scene: 'flood', duplicateOf: 'EV-002', claim: 'Flooding near Library walkway', visualSummary: 'The walkway scene resembles an earlier submission; it adds limited independent support.' }),
  record({ id: 'EV-005', incidentId: 'demo-flood', title: 'Walkway photo with old timestamp', location: 'Library walkway', type: 'Image', status: 'Metadata conflict', score: 6, time: '20:30', capture: '20:27', scene: 'flood', claim: 'Current flooding near Library walkway', visualSummary: 'Water is visible, but visual content cannot establish when this scene was captured.' }),
  record({ id: 'EV-006', incidentId: 'demo-elevator', title: 'Elevator clip: location needs review', location: 'Commons', type: 'Video', status: 'Needs review', score: 9, time: '20:35', capture: '20:32', scene: 'elevator', claim: 'Commons elevator is out of service', visualSummary: 'A sample frame shows an elevator notice, but the reported location conflicts with attached coordinates.' }),
];
