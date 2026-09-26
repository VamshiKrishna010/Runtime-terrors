import React, {useEffect, useMemo, useState} from 'react';
import { createRoot } from 'react-dom/client';
import { ShieldCheck, AlertTriangle, Wifi, Camera, MapPin, CheckCircle2, XCircle, BrainCircuit } from 'lucide-react';
import './styles.css';

const API='http://localhost:8000';

function Badge({level}) {
  return <span className={`badge ${level.toLowerCase()}`}>{level} Evidence</span>
}

function App(){
  const [incidents,setIncidents]=useState([]);
  const [selected,setSelected]=useState(null);
  const [form,setForm]=useState({reporter_token:'demo-user-1',description:'',category:'Network / IT',location:'ITE Building'});
  const [image,setImage]=useState(null);
  const [busy,setBusy]=useState(false);

  const refresh=async()=>{
    const r=await fetch(`${API}/incidents`); const data=await r.json(); setIncidents(data);
    if(selected){ const hit=data.find(x=>x.id===selected.id); if(hit) setSelected(hit); }
  };
  useEffect(()=>{refresh();},[]);

  const stats=useMemo(()=>({
    active:incidents.length,
    emerging:incidents.filter(i=>i.evidence_level==='Emerging').length,
    strong:incidents.filter(i=>i.evidence_level==='Strong').length,
    confirmations:incidents.reduce((a,b)=>a+b.confirmations,0)
  }),[incidents]);

  async function submit(e){
    e.preventDefault(); setBusy(true);
    const fd=new FormData(); Object.entries(form).forEach(([k,v])=>fd.append(k,v)); if(image)fd.append('image',image);
    await fetch(`${API}/reports`,{method:'POST',body:fd});
    setForm({...form,description:''}); setImage(null); await refresh(); setBusy(false);
  }

  async function vote(id,type){
    await fetch(`${API}/incidents/${id}/${type}`,{method:'POST'}); await refresh();
    if(selected?.id===id){ const r=await fetch(`${API}/incidents/${id}`); setSelected(await r.json()); }
  }

  return <div className="app">
    <aside>
      <div className="brand"><ShieldCheck size={28}/><div><b>VeriPulse</b><small>AI trust intelligence</small></div></div>
      <nav><a className="active">Dashboard</a><a>Live Incidents</a><a>Evidence</a><a>Analytics</a></nav>
      <div className="tip"><BrainCircuit size={20}/><b>Judge demo</b><span>Submit paraphrased reports from different reporter tokens and watch the support score change.</span></div>
    </aside>
    <main>
      <header><div><h1>Campus Incident Intelligence</h1><p>Evidence-backed, explainable incident clusters.</p></div></header>
      <section className="stats">
        <Stat title="Active Incidents" value={stats.active}/><Stat title="Emerging" value={stats.emerging}/><Stat title="Strong Evidence" value={stats.strong}/><Stat title="Confirmations" value={stats.confirmations}/>
      </section>
      <section className="grid">
        <div className="panel feed">
          <div className="panelTitle"><h2>Live Incident Feed</h2><span>{incidents.length} clusters</span></div>
          {incidents.length===0 && <div className="empty">No reports yet. Submit your first incident.</div>}
          {incidents.map(i=><button className="incident" key={i.id} onClick={()=>setSelected(i)}>
            <div className="icon"><Wifi size={20}/></div><div className="grow"><div className="incidentTop"><b>{i.title}</b><Badge level={i.evidence_level}/></div><small><MapPin size={13}/>{i.location} · {i.report_count} report(s)</small><div className="scorebar"><i style={{width:`${i.support_score}%`}}></i></div><div className="scoretext">Support score {i.support_score}/100</div></div>
          </button>)}
        </div>
        <div className="panel formPanel">
          <div className="panelTitle"><h2>Report an Incident</h2><span>Live demo input</span></div>
          <form onSubmit={submit}>
            <label>Reporter token<input value={form.reporter_token} onChange={e=>setForm({...form,reporter_token:e.target.value})}/></label>
            <label>Category<select value={form.category} onChange={e=>setForm({...form,category:e.target.value})}><option>Network / IT</option><option>Facilities</option><option>Environmental</option><option>Safety</option></select></label>
            <label>Location<input value={form.location} onChange={e=>setForm({...form,location:e.target.value})}/></label>
            <label>Description<textarea required value={form.description} onChange={e=>setForm({...form,description:e.target.value})} placeholder="e.g. eduroam keeps dropping on ITE level 2"/></label>
            <label className="file"><Camera size={18}/> Attach evidence<input type="file" accept="image/*" onChange={e=>setImage(e.target.files?.[0]||null)}/><span>{image?.name||'No file selected'}</span></label>
            <button className="primary" disabled={busy}>{busy?'Analyzing...':'Submit & Analyze'}</button>
          </form>
        </div>
      </section>
      {selected && <section className="panel detail">
        <div className="panelTitle"><h2>Why this evidence level?</h2><button className="close" onClick={()=>setSelected(null)}>×</button></div>
        <div className="detailTop"><div><h3>{selected.title}</h3><p>{selected.location}</p></div><div><Badge level={selected.evidence_level}/><strong>{selected.support_score}/100</strong></div></div>
        <div className="reasons">{(selected.reasons||[]).map((r,idx)=><div key={idx}><CheckCircle2 size={16}/>{r}</div>)}</div>
        <div className="actions"><button onClick={()=>vote(selected.id,'confirm')}><CheckCircle2 size={17}/> I see this too</button><button onClick={()=>vote(selected.id,'contradict')}><XCircle size={17}/> Not happening here</button></div>
      </section>}
    </main>
  </div>
}

function Stat({title,value}){return <div className="stat"><span>{title}</span><strong>{value}</strong></div>}
createRoot(document.getElementById('root')).render(<App/>);
