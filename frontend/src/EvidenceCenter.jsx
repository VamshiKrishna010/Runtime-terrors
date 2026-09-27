import React, { useEffect, useMemo, useState } from 'react';
import { Image, Copy, AlertTriangle, CheckCircle2, Search, ShieldCheck, MapPin, XCircle, BrainCircuit } from 'lucide-react';
import { requestJson } from './api';
import { adaptEvidence, formatTime } from './evidenceAdapter';

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
    <dt>{label}</dt><dd><span>{value}</span>
      {status && <Status>{status}</Status>}</dd>
  </div>)}</dl>;
}

function EvidenceMedia({ evidence, thumbnail = false }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [evidence.preview]);
  if (failed || !evidence.preview) return <span className="evidenceMediaPlaceholder"><Image size={24} aria-hidden="true" />Preview unavailable</span>;
  if (evidence.type === 'Video') return thumbnail
    ? <span className="evidenceMediaPlaceholder"><Image size={24} aria-hidden="true" />Video evidence</span>
    : <video src={evidence.preview} controls preload="metadata" aria-label={evidence.previewAlt} onError={() => setFailed(true)} />;
  return <img src={evidence.preview} alt={evidence.previewAlt} onError={() => setFailed(true)} />;
}

export function EvidenceCard({ evidence, selected, onSelect, review }) {
  return <button type="button" className={`evidenceCard${selected ? ' selected' : ''}`}
    onClick={onSelect} aria-pressed={selected} aria-controls="evidence-inspector">
    <EvidenceMedia evidence={evidence} thumbnail />
    <span className="evidenceCardContent">
      <span className="evidenceCardTop"><b>EV-{evidence.id}</b><span className="evidenceTypeBadge">{evidence.type}</span><span className="evidenceReviewLabel">{review}</span></span>
      <strong>{evidence.title}</strong>
      <span className="evidenceCardLocation"><MapPin size={13} aria-hidden="true" />{evidence.location}</span>
      <time dateTime={evidence.uploadedAt}>{formatTime(evidence.uploadedAt)}</time>
      <Status>{evidence.status}</Status>
      <span className="evidenceCardBottom"><span>Evidence contribution</span><b>{evidence.score > 0 ? "+" : ""}{evidence.score} points</b></span>
      {evidence.duplicateOf && <span className="evidenceDuplicate"><Copy size={13} aria-hidden="true" />Reused from EV-{evidence.duplicateOf}</span>}
    </span>
  </button>;
}

export function MetadataPanel({ evidence }) {
  return <Panel title="Metadata / EXIF"><Details rows={evidence.metadata} /></Panel>;
}

export function ProvenancePanel({ evidence }) {
  return <Panel title="Provenance"><Status tone="warning">Uploaded evidence</Status><Details rows={evidence.provenanceRows} /></Panel>;
}

export function DuplicatePanel({ evidence }) {
  return <Panel title="Duplicate / reuse detection"><Status tone={evidence.duplicate_analysis.duplicate_count ? 'warning' : 'success'}>{evidence.duplicate_analysis.status}</Status>
    <Details rows={evidence.duplicateRows} /><p className="evidenceMuted">Similarity can indicate reuse. It does not establish intent or disprove an incident.</p></Panel>;
}

export function ConsistencyPanel({ evidence }) {
  return <><Panel title="Image-to-report consistency"><Details rows={evidence.contentRows} /></Panel>
    <Panel title="Location consistency"><Details rows={evidence.locationRows} /></Panel>
    <Panel title="Time consistency"><Details rows={evidence.timeRows} /></Panel></>;
}

export function EvidenceTimeline({ evidence }) {
  return <Panel title="Evidence timeline"><ol className="timeline evidenceTimeline">{evidence.timeline.map((event, index) =>
    <li className="timelineItem" key={`${event.timestamp}-${index}`}><div className="timelineDot" /><b>{event.title}</b><span>{formatTime(event.timestamp)}</span></li>
  )}</ol></Panel>;
}

export function EvidenceInspector({ evidence, onReview, saving, reviewError }) {
  return <aside id="evidence-inspector" className="evidenceInspector" aria-label="Selected evidence detail">
    <div className="evidenceInspectorHeading"><div><p className="eyebrow">Evidence inspector</p><h2>EV-{evidence.id}</h2></div><Status>{evidence.status}</Status></div>
    <Panel title="Evidence Preview"><figure className="evidencePreview"><EvidenceMedia evidence={evidence} />
      <figcaption><span>Uploaded {evidence.type.toLowerCase()} evidence</span></figcaption></figure></Panel>
    <Panel title="Evidence information"><p className="evidenceInformationTitle">{evidence.title}</p><Details rows={[
      { label: 'Evidence type', value: evidence.type }, { label: 'Incident association', value: evidence.incidentId },
      { label: 'Report location', value: evidence.location }, { label: 'Uploaded time', value: formatTime(evidence.uploadedAt) },
    ]} /></Panel>
    <Panel title="Evidence support summary"><div className="evidenceScore"><strong>{evidence.score > 0 ? '+' : ''}{evidence.score}<small> points</small></strong><Status>{evidence.status}</Status></div>
      <progress max="4" value={Math.max(0, evidence.score)} aria-label="Positive image support contribution (up to 4 points)" />
      <p className="evidenceMuted">Actual image contribution to the incident score: up to +4 per unique image (incident cap +12), or -12 for reused evidence (cap -36). Contribution to incident support, not proof of truth.</p></Panel>
    <Panel title="Review state"><div className="evidenceReview"><Status>{evidence.review}</Status><span className="evidenceMuted">Saved to the backend</span></div>
      <div className="evidenceReviewActions"><button type="button" className="evidencePrimary" disabled={saving || evidence.review === 'Reviewed'} onClick={() => onReview('reviewed')}>Mark reviewed</button>
        <button type="button" className="evidenceFlag" disabled={saving || evidence.review === 'Flagged'} onClick={() => onReview('flagged')}>Flag for review</button></div>
      <p className="evidenceMuted" role="status">{saving ? 'Saving review...' : evidence.review === 'Unreviewed' ? 'Awaiting human review.' : `Review state: ${evidence.review.toLowerCase()}.`}</p>
      {reviewError && <p role="alert" className="apiError">{reviewError}</p>}</Panel>
    <MetadataPanel evidence={evidence} /><ProvenancePanel evidence={evidence} /><DuplicatePanel evidence={evidence} /><ConsistencyPanel evidence={evidence} />
    <Panel title="Why this evidence matters"><Details rows={evidence.signals} /></Panel><EvidenceTimeline evidence={evidence} />
  </aside>;
}

export default function EvidenceCenter() {
  const [evidence, setEvidence] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [saving, setSaving] = useState(false);
  const [reviewError, setReviewError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    requestJson('/evidence', { signal: controller.signal }).then((items) => {
      if (!controller.signal.aborted) setEvidence(items.map(adaptEvidence));
    }).catch((error) => { if (!controller.signal.aborted) setError(error.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [reload]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('All');
  const [incident, setIncident] = useState('All');
  const [type, setType] = useState('All');
  const [sort, setSort] = useState('Newest');
  const [selectedId, setSelectedId] = useState(null);

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
  useEffect(() => setReviewError(''), [selected?.id]);
  const saveReview = async (review_state) => {
    if (saving || !selected) return;
    const id = selected.id;
    setSaving(true);
    setReviewError('');
    try {
      const updated = adaptEvidence(await requestJson(`/evidence/${id}/review`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ review_state }),
      }));
      setEvidence((items) => items.map((item) => item.id === id ? updated : item));
    } catch (error) { setReviewError(error.message); }
    finally { setSaving(false); }
  };
  const reset = () => { setSearch(''); setStatus('All'); setIncident('All'); setType('All'); setSort('Newest'); };
  return <div className="evidenceCenter">
    <header className="pageHeader"><div><p className="eyebrow">Evidence Intelligence</p><h1>Evidence Center</h1>
      <p>Inspect uploaded evidence, metadata, provenance, consistency, and reuse signals.</p></div>
      <span className="evidenceAnalysisBadge"><BrainCircuit size={16} aria-hidden="true" />Evidence analysis</span></header>
    <div className="evidenceDemoNotice"><ShieldCheck size={18} aria-hidden="true" /><span>Uploaded evidence and measured file signals support human review; they do not prove truth. Visual AI comparison is not connected.</span></div>
    <div className="stats">
      <EvidenceSummaryCard title="Total Evidence" value={evidence.length} icon={Image} tone="info" subtitle="Stored report attachments" />
      <EvidenceSummaryCard title="Unique Images" value={evidence.filter((item) => item.type !== 'Video' && !item.duplicateOf).length} icon={ShieldCheck} tone="success" subtitle="Distinct images and screenshots" />
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
    {loading ? <div className="evidenceEmpty" role="status">Loading evidence...</div>
      : error ? <div className="evidenceEmpty" role="alert"><p>{error}</p><button type="button" onClick={() => setReload((value) => value + 1)}>Retry</button></div>
      : evidence.length === 0 ? <div className="evidenceEmpty"><Image size={36} aria-hidden="true" /><h2>No evidence uploaded yet</h2><p>Evidence attached to incident reports will appear here for analysis.</p></div>
      : filtered.length === 0 ? <div className="evidenceEmpty"><Search size={32} aria-hidden="true" /><h2>No matching evidence</h2><p>Try another search or clear your filters.</p><button type="button" onClick={reset}>Clear filters</button></div>
      : <div className="evidenceWorkspace"><section className="evidenceGallery" aria-label="Evidence gallery"><div className="evidenceGalleryHeading"><h2>Evidence library</h2><span role="status">{filtered.length} of {evidence.length} items</span></div>
        <p className="evidenceMuted">Select an item to inspect its signals. All times Eastern.</p>
        <div className="evidenceCards">{filtered.map((item) => <EvidenceCard key={item.id} evidence={item} selected={selected.id === item.id} onSelect={() => setSelectedId(item.id)} review={item.review} />)}</div>
      </section><EvidenceInspector evidence={selected} onReview={saveReview} saving={saving} reviewError={reviewError} /></div>}
  </div>;
}
