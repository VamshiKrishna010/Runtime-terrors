import React, { useMemo, useState } from 'react';
import { Image, Copy, AlertTriangle, CheckCircle2, Search, ShieldCheck, MapPin, XCircle, BrainCircuit } from 'lucide-react';
import { mockEvidence } from './evidenceData';

const formatTime = (value) => new Date(value).toLocaleString('en-US', {
  month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York',
});
const toneFor = (status) => ['Consistent', 'Strong support', 'Reviewed', 'Strong provenance'].includes(status)
  ? 'success' : ['Conflicting', 'Metadata conflict', 'Flagged'].includes(status) ? 'danger' : 'warning';

function Status({ children, tone = toneFor(children) }) {
  const Icon = tone === 'success' ? CheckCircle2 : tone === 'danger' ? XCircle : AlertTriangle;
  return <span className={`evidenceStatus ${tone}`}><Icon size={13} aria-hidden="true" />{children}</span>;
}

export function EvidenceSummaryCard({ title, value, icon: Icon, tone, subtitle }) {
  return <div className="stat"><div className={`statIcon ${tone}`}><Icon size={20} aria-hidden="true" /></div>
    <div className="statContent"><span>{title}</span><strong>{value}</strong><small>{subtitle}</small></div></div>;
}

function Panel({ title, children }) {
  return <section className="evidencePanel"><h3>{title}</h3>{children}</section>;
}

function Details({ rows }) {
  return <dl className="evidenceDetails">{rows.map(({ label, value, status }) => <div key={label}>
    <dt>{label}</dt><dd><span>{/timestamp/i.test(label) && /^2026-/.test(value) ? formatTime(value) : value}</span>
      {status && <Status>{status}</Status>}</dd>
  </div>)}</dl>;
}

export function EvidenceCard({ evidence, selected, onSelect, review }) {
  return <button type="button" className={`evidenceCard${selected ? ' selected' : ''}`}
    onClick={onSelect} aria-pressed={selected} aria-controls="evidence-inspector">
    <img src={evidence.preview} alt={evidence.previewAlt} />
    <span className="evidenceCardContent">
      <span className="evidenceCardTop"><b>{evidence.id}</b><span className="evidenceTypeBadge">{evidence.type}</span><span className="evidenceReviewLabel">{review}</span></span>
      <strong>{evidence.title}</strong>
      <span className="evidenceCardLocation"><MapPin size={13} aria-hidden="true" />{evidence.location}</span>
      <time dateTime={evidence.uploadedAt}>{formatTime(evidence.uploadedAt)} ET</time>
      <Status>{evidence.status}</Status>
      <span className="evidenceCardBottom"><span>Evidence contribution</span><b>{evidence.score} / 25</b></span>
      {evidence.duplicateOf && <span className="evidenceDuplicate"><Copy size={13} aria-hidden="true" />Reused from {evidence.duplicateOf}</span>}
    </span>
  </button>;
}

export function MetadataPanel({ evidence }) {
  return <Panel title="Metadata / EXIF"><Details rows={evidence.metadata} /></Panel>;
}

export function ProvenancePanel({ evidence }) {
  return <Panel title="Provenance"><Status>{evidence.provenance}</Status><Details rows={[
    { label: 'Source', value: evidence.live ? 'Live capture' : 'Gallery upload' },
    { label: 'In-app capture', value: evidence.live ? 'Yes (demo)' : 'No' },
    { label: 'Server capture time', value: evidence.live ? formatTime(evidence.capturedAt) + ' ET (simulated)' : 'Unavailable; upload receipt only' },
    { label: 'File hash', value: evidence.hash },
    { label: 'Anonymous reporter ID', value: evidence.reporter },
    { label: 'Approximate location verification', value: evidence.gps, status: evidence.locationMismatch ? 'Conflicting' : evidence.type === 'Screenshot' ? 'Unavailable' : 'Consistent' },
  ]} /></Panel>;
}

export function DuplicatePanel({ evidence, collection }) {
  const source = collection.find((item) => item.id === evidence.duplicateOf);
  const matches = collection.filter((item) => item.id !== evidence.id && item.imageKey === evidence.imageKey);
  const duplicate = matches.length > 0;
  const first = source || evidence;
  return <Panel title="Duplicate / reuse detection"><Status tone={duplicate ? 'warning' : 'success'}>
    {duplicate ? 'Near-duplicate detected' : 'No duplicate evidence found'}</Status>
    <Details rows={[
      { label: 'Perceptual hash status', value: duplicate ? 'Similar image match (demo)' : 'No match in demo collection' },
      { label: 'Similar evidence count', value: `${matches.length} similar submission${matches.length === 1 ? '' : 's'}` },
      { label: 'Duplicate distance', value: duplicate ? 'Perceptual hash distance: 3' : 'Not applicable' },
      { label: 'First-seen timestamp', value: first.uploadedAt },
      { label: 'Duplicate source', value: source ? `${source.id}: ${source.title}` : duplicate ? `This record is the first submission; related: ${matches.map((item) => item.id).join(', ')}` : 'None in demo collection' },
    ]} />
    <p className="evidenceMuted">Similarity can indicate reuse. It does not establish intent or disprove an incident.</p>
  </Panel>;
}

export function ConsistencyPanel({ evidence }) {
  return <>
    <Panel title="Image-to-report consistency"><Details rows={[
      { label: 'Reported claim', value: evidence.claim },
      { label: 'AI visual summary (simulated)', value: evidence.visualSummary },
      { label: 'Consistency result', value: 'Content consistent with report', status: 'Consistent' },
      { label: 'Support value', value: `${evidence.score} / 25 overall contribution (illustrative; not a truth probability)` },
    ]} /><p className="evidenceMuted">Visual agreement alone does not verify the time, location, or provenance.</p></Panel>
    <Panel title="Location consistency"><Details rows={[
      { label: 'Reported location', value: evidence.location },
      { label: 'EXIF GPS', value: evidence.gps },
      { label: 'Browser / report proximity', value: evidence.type === 'Screenshot' ? 'Browser location not provided' : 'Browser report approximately 40 m from claimed location (demo)' },
      { label: 'Distance from claimed incident', value: evidence.distance },
      { label: 'Result', value: evidence.locationMismatch ? 'Location mismatch' : evidence.type === 'Screenshot' ? 'Insufficient location metadata' : 'Location consistent', status: evidence.locationMismatch ? 'Conflicting' : evidence.type === 'Screenshot' ? 'Unavailable' : 'Consistent' },
    ]} /></Panel>
    <Panel title="Time consistency"><Details rows={[
      { label: 'Report time', value: formatTime(evidence.reportAt) + ' ET' },
      { label: 'Capture time', value: formatTime(evidence.capturedAt) + ' ET' },
      { label: 'Time difference', value: evidence.timeDifference },
      { label: 'Result', value: evidence.metadataConflict ? 'Timestamp conflict' : 'Timestamp consistent', status: evidence.metadataConflict ? 'Conflicting' : 'Consistent' },
    ]} /></Panel>
  </>;
}

export function EvidenceTimeline({ evidence }) {
  const steps = ['Evidence uploaded', evidence.type === 'Screenshot' ? 'EXIF extraction: no EXIF available' : 'EXIF / metadata extracted', 'Image hash generated', 'Duplicate scan completed', 'AI visual comparison completed', 'Evidence linked to incident', 'Support score updated'];
  return <Panel title="Evidence timeline"><ol className="timeline evidenceTimeline">{steps.map((step, index) =>
    <li className="timelineItem" key={step}><div className="timelineDot" /><b>{step}</b>
      <span>{formatTime(new Date(new Date(evidence.uploadedAt).getTime() + index * 60000))} ET</span><span className="evidenceTimelineNote">Simulated event</span></li>
  )}</ol></Panel>;
}

export function EvidenceInspector({ evidence, collection, review, onReview }) {
  const label = evidence.score >= 20 ? 'Strong support' : evidence.score >= 12 ? 'Moderate support' : 'Needs review';
  return <aside id="evidence-inspector" className="evidenceInspector" aria-label="Selected evidence detail">
    <div className="evidenceInspectorHeading"><div><p className="eyebrow">Evidence inspector</p><h2>{evidence.id}</h2></div><Status>{evidence.status}</Status></div>
    <Panel title="Evidence Preview">
      <figure className="evidencePreview"><img src={evidence.preview} alt={evidence.previewAlt} />
        <figcaption><span className="evidenceSimulationBadge">SIMULATED PREVIEW</span><span>Demo evidence</span>
          <span className="evidencePreviewDescription">{evidence.type === 'Video' ? 'Illustrated video sample frame' : 'Illustrated evidence preview'}, not an uploaded file</span></figcaption>
      </figure>
    </Panel>
    <Panel title="Evidence information"><p className="evidenceInformationTitle">{evidence.title}</p><Details rows={[
      { label: 'Evidence type', value: evidence.type },
      { label: 'Incident association', value: evidence.incidentId },
      { label: 'Report location', value: evidence.location },
      { label: 'Uploaded time', value: formatTime(evidence.uploadedAt) + ' ET' },
    ]} /></Panel>
    <Panel title="Evidence support summary"><div className="evidenceScore"><strong>{evidence.score}<small> / 25</small></strong><Status tone={evidence.score >= 12 ? 'success' : 'warning'}>{label}</Status></div>
      <progress max="25" value={evidence.score} aria-label="Evidence support contribution" />
      <p className="evidenceMuted">Contribution to incident support, not proof of truth. Metadata can be absent or altered; signals need human context.</p>
    </Panel>
    <Panel title="Review state"><div className="evidenceReview"><Status>{review}</Status><span className="evidenceMuted">Local to this page session</span></div>
      <div className="evidenceReviewActions"><button type="button" className="evidencePrimary" disabled={review === 'Reviewed'} onClick={() => onReview('Reviewed')}>Mark reviewed</button>
        <button type="button" className="evidenceFlag" disabled={review === 'Flagged'} onClick={() => onReview('Flagged')}>Flag for review</button></div>
      <p className="evidenceMuted" role="status">{review === 'Unreviewed' ? 'Awaiting human review.' : `${evidence.id} marked ${review.toLowerCase()}. No server changes were made.`}</p>
    </Panel>
    <MetadataPanel evidence={evidence} /><ProvenancePanel evidence={evidence} />
    <DuplicatePanel evidence={evidence} collection={collection} /><ConsistencyPanel evidence={evidence} />
    <Panel title="Why this evidence matters"><Details rows={evidence.signals} /></Panel>
    <EvidenceTimeline evidence={evidence} />
  </aside>;
}

export default function EvidenceCenter({ evidence = mockEvidence }) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('All');
  const [incident, setIncident] = useState('All');
  const [type, setType] = useState('All');
  const [sort, setSort] = useState('Newest');
  const [selectedId, setSelectedId] = useState(null);
  const [reviews, setReviews] = useState({});
  const incidentOptions = [...new Map(evidence.map((item) => [item.incidentId, item.incidentId])).values()];
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const needsReview = (item) => ['Needs review', 'Metadata conflict'].includes(item.status);
    return evidence.filter((item) => (!query || `${item.id} ${item.title} ${item.location} ${item.claim}`.toLowerCase().includes(query))
      && (status === 'All' || item.status === status) && (incident === 'All' || item.incidentId === incident) && (type === 'All' || item.type === type))
      .sort((a, b) => (sort === 'Highest support' ? b.score - a.score : sort === 'Needs review' ? Number(needsReview(b)) - Number(needsReview(a)) : sort === 'Duplicate first' ? Number(!!b.duplicateOf) - Number(!!a.duplicateOf) : 0)
        || new Date(b.uploadedAt) - new Date(a.uploadedAt));
  }, [evidence, search, status, incident, type, sort]);
  const selected = filtered.find((item) => item.id === selectedId) || filtered[0];
  const reset = () => { setSearch(''); setStatus('All'); setIncident('All'); setType('All'); setSort('Newest'); };
  return <div className="evidenceCenter">
    <header className="pageHeader"><div><p className="eyebrow">Evidence Intelligence</p><h1>Evidence Center</h1>
      <p>Inspect uploaded evidence, metadata, provenance, consistency, and reuse signals.</p></div>
      <span className="evidenceAnalysisBadge"><BrainCircuit size={16} aria-hidden="true" />AI-assisted analysis</span></header>
    <div className="evidenceDemoNotice"><ShieldCheck size={18} aria-hidden="true" /><span>Demo workspace: Simulated evidence and analysis, separate from live incidents. AI-assisted signals support human review; they do not prove truth.</span></div>
    <div className="stats">
      <EvidenceSummaryCard title="Total Evidence" value={evidence.length} icon={Image} tone="info" subtitle="All demo submissions" />
      <EvidenceSummaryCard title="Unique Images" value={new Set(evidence.filter((item) => item.type !== 'Video').map((item) => item.imageKey)).size} icon={ShieldCheck} tone="success" subtitle="Distinct images and screenshots" />
      <EvidenceSummaryCard title="Duplicate / Reused" value={evidence.filter((item) => item.duplicateOf).length} icon={Copy} tone="warning" subtitle="Repeated submissions" />
      <EvidenceSummaryCard title="Metadata Conflicts" value={evidence.filter((item) => item.metadataConflict).length} icon={AlertTriangle} tone="danger" subtitle="Require closer inspection" />
    </div>
    <div className="evidenceFilters">
      <label className="evidenceSearch">Search evidence<span><Search size={16} aria-hidden="true" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Title, location, or evidence ID" /></span></label>
      <label>Evidence status<select value={status} onChange={(event) => setStatus(event.target.value)}>{['All', 'Strong support', 'Consistent', 'Needs review', 'Duplicate', 'Metadata conflict'].map((value) => <option key={value}>{value}</option>)}</select></label>
      <label>Incident<select value={incident} onChange={(event) => setIncident(event.target.value)}><option value="All">All incidents</option>{incidentOptions.map((value) => <option key={value} value={value}>{evidence.find((item) => item.incidentId === value).title}</option>)}</select></label>
      <label>Evidence type<select value={type} onChange={(event) => setType(event.target.value)}>{['All', 'Image', 'Video', 'Screenshot'].map((value) => <option key={value}>{value}</option>)}</select></label>
      <label>Sort by<select value={sort} onChange={(event) => setSort(event.target.value)}>{['Newest', 'Highest support', 'Needs review', 'Duplicate first'].map((value) => <option key={value}>{value}</option>)}</select></label>
    </div>
    {evidence.length === 0 ? <div className="evidenceEmpty"><Image size={36} aria-hidden="true" /><h2>No evidence uploaded yet</h2><p>Evidence attached to incident reports will appear here for analysis.</p></div>
      : filtered.length === 0 ? <div className="evidenceEmpty"><Search size={32} aria-hidden="true" /><h2>No matching evidence</h2><p>Try another search or clear your filters.</p><button type="button" onClick={reset}>Clear filters</button></div>
      : <div className="evidenceWorkspace"><section className="evidenceGallery" aria-label="Evidence gallery"><div className="evidenceGalleryHeading"><h2>Evidence library</h2><span role="status">{filtered.length} of {evidence.length} items</span></div>
        <p className="evidenceMuted">Select an item to inspect its signals. All times Eastern.</p>
        <div className="evidenceCards">{filtered.map((item) => <EvidenceCard key={item.id} evidence={item} selected={selected.id === item.id} onSelect={() => setSelectedId(item.id)} review={reviews[item.id] || 'Unreviewed'} />)}</div>
      </section><EvidenceInspector evidence={selected} collection={evidence} review={reviews[selected.id] || 'Unreviewed'} onReview={(value) => setReviews((current) => ({ ...current, [selected.id]: value }))} /></div>}
  </div>;
}
