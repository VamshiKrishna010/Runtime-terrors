import { mediaUrl } from './api';

export const statusLabel = (status) => ({
  consistent: 'Consistent', needs_review: 'Needs review', conflicting: 'Conflicting',
  unavailable: 'Unavailable', metadata_conflict: 'Metadata conflict', duplicate: 'Duplicate',
  unreviewed: 'Unreviewed', reviewed: 'Reviewed', flagged: 'Flagged',
}[status] || 'Unavailable');

export const formatTime = (value) => {
  if (!value) return 'Unavailable';
  // EXIF without an offset must not silently acquire the viewer's timezone.
  if (!/[zZ]|[+-]\d{2}:\d{2}$/.test(value)) return `${value.replace('T', ' ')} (timezone unavailable)`;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unavailable' : date.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York',
  }) + ' ET';
};

export function adaptEvidence(item) {
  const metadata = item.metadata || {};
  const available = (value) => value === null || value === undefined || value === '' ? 'Unavailable' : String(value);
  const row = (label, value, status) => ({ label, value: available(value), status: status ? statusLabel(status) : undefined });
  const time = item.time_consistency;
  const location = item.location_consistency;
  const duplicate = item.duplicate_analysis;
  const provenance = item.provenance;
  return {
    ...item,
    incidentId: String(item.incident_id),
    uploadedAt: item.uploaded_at,
    type: item.type === 'video' ? 'Video' : item.type === 'screenshot' ? 'Screenshot' : 'Image',
    status: statusLabel(item.status),
    score: item.support_contribution,
    preview: mediaUrl(item.url),
    previewAlt: `Uploaded evidence for ${item.title} at ${item.location}`,
    review: statusLabel(item.review_state),
    duplicateOf: duplicate.duplicate_of,
    metadataConflict: item.status === 'metadata_conflict',
    claim: item.reported_claim,
    metadata: [
      row('Camera / device', metadata.camera_device),
      row('Dimensions', metadata.width && metadata.height ? `${metadata.width} x ${metadata.height} px` : null),
      row('Capture timestamp', formatTime(metadata.capture_timestamp), time.status),
      row('Upload timestamp', formatTime(item.uploaded_at)),
      row('EXIF GPS', location.evidence_coordinates ? 'GPS metadata available' : null, location.status),
      row('Software / editing', metadata.editing_software, metadata.editing_software ? 'needs_review' : 'unavailable'),
      row('File type', item.mime_type),
      row('File size', `${(item.file_size / 1024).toFixed(1)} KB`),
      row('EXIF availability', metadata.exif_available ? 'Available' : 'Unavailable'),
    ],
    provenanceRows: [
      row('Source', provenance.source === 'gallery_upload' ? 'Gallery upload' : 'Unknown'),
      row('In-app capture', provenance.in_app_capture === null ? null : provenance.in_app_capture ? 'Yes' : 'No'),
      row('Server received', formatTime(provenance.server_received_at)),
      row('SHA-256 hash', item.sha256_hash),
      row('Report reference', provenance.reporter_id),
      row('Approximate location', location.distance_meters == null ? null : `${Math.round(location.distance_meters)} m from report coordinates`, location.status),
    ],
    duplicateRows: [
      row('Perceptual hash', item.perceptual_hash),
      row('Similar evidence', `${duplicate.duplicate_count} submission(s)`),
      row('Closest hash distance', duplicate.closest_duplicate_distance),
      row('First seen', formatTime(duplicate.first_seen_at)),
      row('Earlier evidence', duplicate.duplicate_of ? `EV-${duplicate.duplicate_of}` : 'No earlier match'),
    ],
    contentRows: [
      row('Reported claim', item.reported_claim),
      row('AI visual summary', item.content_consistency.visual_summary),
      row(
        'Visual comparison',
        item.content_consistency.status === 'yes'
          ? 'Consistent with the reported claim'
          : item.content_consistency.status === 'partial'
            ? 'Partially consistent with the reported claim'
            : item.content_consistency.status === 'no'
              ? 'Conflicts with the reported claim'
              : 'Unavailable',
        item.content_consistency.status
      ),
      row(
        'Confidence',
        item.content_consistency.score == null
          ? null
          : `${Math.round(item.content_consistency.score * 100)}%`
      ),
      row('Explanation', item.content_consistency.reason),
    ],
    locationRows: [row('Reported location', item.location), row('Report coordinates', location.reported_coordinates ? 'Provided with report' : null),
      row('EXIF GPS', location.evidence_coordinates ? 'Available in file metadata' : null),
      row('Distance from report', location.distance_meters == null ? null : `${location.distance_meters} m`), row('Result', statusLabel(location.status), location.status)],
    timeRows: [row('Report time', formatTime(time.reported_at)), row('Capture time', formatTime(time.captured_at)),
      row('Report minus capture', time.difference_seconds == null ? null : `${time.difference_seconds} seconds`), row('Result', time.note || statusLabel(time.status), time.status)],
    signals: [row('File hash', 'SHA-256 calculated from uploaded bytes'),
      row('Duplicate analysis', duplicate.status, duplicate.duplicate_count ? 'needs_review' : 'consistent'),
      row('Time consistency', time.note || statusLabel(time.status), time.status),
      row('Location consistency', statusLabel(location.status), location.status),
      row('Editing metadata', metadata.editing_software || 'No software tag available', metadata.editing_software ? 'needs_review' : 'unavailable'),
      row(
        'Visual comparison',
        item.content_consistency.status === 'yes'
          ? `Consistent (${Math.round((item.content_consistency.score ?? 0) * 100)}% confidence)`
          : item.content_consistency.status === 'partial'
            ? `Partial match (${Math.round((item.content_consistency.score ?? 0) * 100)}% confidence)`
            : item.content_consistency.status === 'no'
              ? `Conflict (${Math.round((item.content_consistency.score ?? 0) * 100)}% confidence)`
              : 'Unavailable',
        item.content_consistency.status
      ),
      row('Reporter independence', 'Pseudonymous tokens do not verify identity or independence', 'unavailable')],
  };
}
