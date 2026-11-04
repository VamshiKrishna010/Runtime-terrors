import React, { useEffect, useRef, useState } from 'react';
import { useAction, useMutation } from 'convex/react';
import { AlertTriangle, BrainCircuit, Camera, ChevronRight, MapPin, RefreshCw, Upload } from 'lucide-react';
import { api } from '../convex/_generated/api';
import { analyzeImage } from './api';
import { getDeviceToken } from './deviceToken';
import { measureImage, validateImage } from './imageEvidence';
import { embedDescription, preloadEmbeddings } from './ml';

const CATEGORIES = ['Network / IT', 'Facilities', 'Environmental', 'Safety', 'Other'];
export const errorMessage = (error, fallback) => (typeof error?.data === 'string' ? error.data : error?.message) || fallback;

export default function ReporterFlow({ onSubmitted }) {
  const submitReport = useAction(api.reports.submit);
  const generateUploadUrl = useMutation(api.reports.generateUploadUrl);
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({ category: 'Network / IT', location: 'ITE Building', description: '' });
  const [image, setImage] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [stream, setStream] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const videoRef = useRef(null);

  useEffect(() => { preloadEmbeddings(); }, []);
  useEffect(() => () => stream?.getTracks().forEach((track) => track.stop()), [stream]);
  useEffect(() => { if (stream && videoRef.current) videoRef.current.srcObject = stream; }, [stream]);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const chooseImage = (file) => {
    if (file) {
      const problem = validateImage(file);
      if (problem) { setError(problem); return; }
    }
    setError('');
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setImage(file || null);
    setPreviewUrl(file ? URL.createObjectURL(file) : null);
  };
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const validateStep = () => {
    if (step === 1 && !form.location.trim()) return 'Add a location to continue.';
    if (step === 2 && form.description.trim().length < 10) return 'Describe what happened in at least 10 characters.';
    return '';
  };
  const next = () => { const message = validateStep(); if (message) setError(message); else { setError(''); setStep((value) => Math.min(3, value + 1)); } };
  const startCamera = async () => {
    setError('');
    try { setStream(await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })); }
    catch { setError('Camera access was unavailable. You can still attach a photo from your device.'); }
  };
  const stopCamera = () => { stream?.getTracks().forEach((track) => track.stop()); setStream(null); };
  const capture = () => {
    const video = videoRef.current;
    if (!video?.videoWidth) return setError('The camera is still starting. Try again in a moment.');
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    canvas.toBlob((blob) => { if (blob) chooseImage(new File([blob], `veripulse-${Date.now()}.jpg`, { type: 'image/jpeg' })); }, 'image/jpeg', 0.9);
    stopCamera();
  };

  const submit = async () => {
    setError(''); setBusy(true);
    const description = form.description.trim();
    try {
      setProgress('Analysing description…');
      const embedding = await embedDescription(description);
      let imageStorageId;
      let measurements;
      let vision;
      if (image) {
        setProgress('Checking photo…');
        // Vision analysis is optional: it is skipped when the service is offline.
        [measurements, vision] = await Promise.all([measureImage(image), analyzeImage(image, description)]);
        setProgress('Uploading photo…');
        const upload = await fetch(await generateUploadUrl({}), { method: 'POST', headers: { 'Content-Type': image.type }, body: image });
        if (!upload.ok) throw new Error('Evidence upload failed. Please try again.');
        imageStorageId = (await upload.json()).storageId;
      }
      setProgress('Saving report…');
      // Convex strips the photo's metadata, clusters the report and computes
      // the score server-side; nothing here can set the score.
      const result = await submitReport({
        reporterToken: getDeviceToken(),
        category: form.category,
        location: form.location.trim(),
        description,
        embedding,
        ...(imageStorageId && { imageStorageId, image: measurements }),
        ...(imageStorageId && vision && { vision }),
      });
      onSubmitted(result.incidentId);
      setForm((current) => ({ ...current, description: '' })); chooseImage(null); setStep(1);
    } catch (submitError) {
      setError(errorMessage(submitError, 'Unable to submit your report. Please try again.'));
    } finally { setBusy(false); setProgress(''); }
  };

  return <section className="panel formPanel reporterFlow">
    <div className="panelHeader"><div><p className="panelEyebrow">Community report</p><h2>Report an incident</h2></div><span className="liveBadge"><span />Live Convex sync</span></div>
    <ol className="reportSteps" aria-label="Report progress">{['Details', 'What happened', 'Evidence & review'].map((label, index) => <li key={label} className={step === index + 1 ? 'active' : step > index + 1 ? 'complete' : ''}><span>{index + 1}</span>{label}</li>)}</ol>
    {error && <div className="reportError" role="alert"><AlertTriangle size={16} />{error}</div>}
    {step === 1 && <div className="reportStep">
      <div className="fieldRow"><label>Category<select value={form.category} onChange={(event) => update('category', event.target.value)}>{CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select></label></div>
      <label>Location<div className="inputWithIcon"><MapPin size={16} /><input value={form.location} onChange={(event) => update('location', event.target.value)} placeholder="Where is this happening?" /></div></label>
      <small className="fieldHint">Reports are anonymous. This browser gets a random reporter ID so repeat reports from it count once.</small>
    </div>}
    {step === 2 && <div className="reportStep"><label>What happened?<textarea autoFocus value={form.description} onChange={(event) => update('description', event.target.value)} placeholder="Describe what you saw, when it started, and anything that could help someone verify it." /><small className="fieldHint">Avoid names, phone numbers, or other private details.</small></label></div>}
    {step === 3 && <div className="reportStep">
      <div className="cameraActions"><button type="button" className="secondary" onClick={startCamera} disabled={Boolean(stream)}><Camera size={16} />Open camera</button><label className="secondary uploadTrigger"><Upload size={16} />Choose photo<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(event) => chooseImage(event.target.files?.[0])} /></label></div>
      {stream && <div className="cameraPreview"><video ref={videoRef} autoPlay playsInline muted /><div><button type="button" className="primary" onClick={capture}><Camera size={16} />Capture photo</button><button type="button" className="secondary" onClick={stopCamera}>Cancel</button></div></div>}
      {previewUrl && <figure className="selectedEvidence"><img src={previewUrl} alt="Evidence selected for upload" /><figcaption><Camera size={14} />{image?.name}<button type="button" onClick={() => chooseImage(null)}>Remove</button></figcaption></figure>}
      <small className="fieldHint">Location and camera details are removed from photos before they are stored or shown.</small>
      <div className="reportReview"><b>{form.category}</b><span>{form.location}</span><p>{form.description}</p></div>
    </div>}
    <div className="reportNav"><button type="button" className="secondary" onClick={() => { setError(''); setStep((value) => Math.max(1, value - 1)); }} disabled={step === 1 || busy}>Back</button>{step < 3 ? <button type="button" className="primary" onClick={next}>Continue <ChevronRight size={16} /></button> : <button type="button" className="primary" disabled={busy} onClick={submit}>{busy ? <><RefreshCw className="spin" size={16} />{progress || 'Submitting…'}</> : <><BrainCircuit size={16} />Submit report</>}</button>}</div>
  </section>;
}
