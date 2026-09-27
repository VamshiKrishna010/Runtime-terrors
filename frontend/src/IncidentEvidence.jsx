import React, { useEffect, useRef, useState } from 'react';
import { Image, X } from 'lucide-react';

export function resolveEvidenceUrl(path, api) {
  if (typeof path !== 'string' || !path.trim()) return null;
  try {
    const url = new URL(path, `${api}/`);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export default function IncidentEvidence({ incident, api }) {
  const [images, setImages] = useState([]);
  const [failed, setFailed] = useState([]);
  const [activeUrl, setActiveUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const dialogRef = useRef(null);
  const triggerRef = useRef(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    const load = async () => {
      try {
        const response = await fetch(`${api}/incidents/${incident.id}`, { signal: controller.signal });
        if (!response.ok) throw new Error('Could not load incident evidence');
        const detail = await response.json();
        const urls = (detail.reports || []).map((report) => resolveEvidenceUrl(report.image_path, api)).filter(Boolean);
        if (!controller.signal.aborted) {
          setImages([...new Set(urls)]);
          setFailed([]);
        }
      } catch (error) {
        if (!controller.signal.aborted) setError(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    load();
    return () => controller.abort();
  }, [incident, api, retry]);

  const available = images.filter((url) => !failed.includes(url));
  const main = available.includes(activeUrl) ? activeUrl : available[0];
  const failImage = (url) => {
    setFailed((current) => [...new Set([...current, url])]);
    if (dialogRef.current?.open) dialogRef.current.close();
  };

  return <section className="incidentVisualEvidence" aria-label="Incident evidence" aria-busy={loading}>
    <h3>Evidence</h3>
    {loading ? <div className="incidentEvidencePlaceholder" role="status">Loading evidence?</div>
      : error ? <div className="incidentEvidencePlaceholder" role="status"><span>Unable to load evidence.</span><button type="button" onClick={() => setRetry((value) => value + 1)}>Retry</button></div>
      : !main ? <div className="incidentEvidencePlaceholder"><Image size={25} aria-hidden="true" /><span>{images.length ? 'Visual evidence is unavailable' : 'No visual evidence attached'}</span></div>
      : <>
        <button type="button" className="incidentEvidenceMain" ref={triggerRef}
          aria-label={`Open larger evidence image for ${incident.title}`} onClick={() => dialogRef.current?.showModal()}>
          <img src={main} alt={`Uploaded evidence for ${incident.title} at ${incident.location}`} onError={() => failImage(main)} />
        </button>
        <div className="incidentEvidenceCaption"><b>Uploaded evidence</b><span>Image ? Reported with incident</span></div>
        {available.length > 1 && <div className="incidentEvidenceThumbnails" aria-label="Evidence images">
          {available.map((url, index) => <button type="button" key={url} aria-label={`Show evidence image ${index + 1}`}
            aria-pressed={main === url} onClick={() => setActiveUrl(url)}>
            <img src={url} alt={`Evidence thumbnail ${index + 1} for ${incident.title}`} onError={() => failImage(url)} />
          </button>)}
        </div>}
      </>}
    <dialog ref={dialogRef} className="incidentEvidenceDialog" aria-label={`Evidence preview for ${incident.title}`}
      onClose={() => triggerRef.current?.focus()} onClick={(event) => { if (event.target === event.currentTarget) event.currentTarget.close(); }}>
      <div className="incidentEvidenceDialogContent">
        <button type="button" className="incidentEvidenceClose" aria-label="Close evidence preview" autoFocus onClick={() => dialogRef.current.close()}><X size={20} aria-hidden="true" /></button>
        {main && <img src={main} alt={`Full evidence image for ${incident.title} at ${incident.location}`} onError={() => failImage(main)} />}
        <p>Uploaded evidence ? {incident.title}</p>
      </div>
    </dialog>
  </section>;
}
