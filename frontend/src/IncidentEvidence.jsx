import React, { useRef, useState } from 'react';
import { useQuery } from 'convex/react';
import { Image, X } from 'lucide-react';
import { api } from '../convex/_generated/api';

export default function IncidentEvidence({ incident }) {
  const reports = useQuery(api.reports.byIncident, { incidentId: incident.id });
  const [activeUrl, setActiveUrl] = useState(null);
  const [failed, setFailed] = useState([]);
  const dialogRef = useRef(null);
  const triggerRef = useRef(null);

  if (reports === undefined) {
    return <section className="incidentVisualEvidence" aria-busy="true"><h3>Evidence</h3><div className="incidentEvidencePlaceholder" role="status">Loading evidence…</div></section>;
  }

  const images = reports.map((report) => report.imageUrl).filter(Boolean);
  const available = images.filter((url) => !failed.includes(url));
  const main = available.includes(activeUrl) ? activeUrl : available[0];
  const failImage = (url) => setFailed((current) => [...new Set([...current, url])]);

  return <section className="incidentVisualEvidence" aria-label="Incident evidence">
    <h3>Evidence</h3>
    {!main ? <div className="incidentEvidencePlaceholder"><Image size={25} aria-hidden="true" /><span>No visual evidence attached</span></div>
      : <>
        <button type="button" className="incidentEvidenceMain" ref={triggerRef}
          aria-label={`Open larger evidence image for ${incident.title}`} onClick={() => dialogRef.current?.showModal()}>
          <img src={main} alt={`Uploaded evidence for ${incident.title} at ${incident.location}`} onError={() => failImage(main)} />
        </button>
        <div className="incidentEvidenceCaption"><b>Uploaded evidence</b><span>{reports.length} report{reports.length === 1 ? '' : 's'} in this incident</span></div>
        {available.length > 1 && <div className="incidentEvidenceThumbnails" aria-label="Evidence images">
          {available.map((url, index) => <button type="button" key={url} aria-label={`Show evidence image ${index + 1}`}
            aria-pressed={main === url} onClick={() => setActiveUrl(url)}><img src={url} alt={`Evidence thumbnail ${index + 1} for ${incident.title}`} onError={() => failImage(url)} /></button>)}
        </div>}
      </>}
    <dialog ref={dialogRef} className="incidentEvidenceDialog" aria-label={`Evidence preview for ${incident.title}`}
      onClose={() => triggerRef.current?.focus()} onClick={(event) => { if (event.target === event.currentTarget) event.currentTarget.close(); }}>
      <div className="incidentEvidenceDialogContent">
        <button type="button" className="incidentEvidenceClose" aria-label="Close evidence preview" autoFocus onClick={() => dialogRef.current.close()}><X size={20} aria-hidden="true" /></button>
        {main && <img src={main} alt={`Full evidence image for ${incident.title} at ${incident.location}`} onError={() => failImage(main)} />}
        <p>Community supplied evidence · {incident.title}</p>
      </div>
    </dialog>
  </section>;
}
