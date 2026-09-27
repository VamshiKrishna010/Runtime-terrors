import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

import {
  ShieldCheck,
  AlertTriangle,
  Wifi,
  Camera,
  MapPin,
  CheckCircle2,
  XCircle,
  BrainCircuit,
  LayoutDashboard,
  Radio,
  Image,
  BarChart3,
  Bell,
  Users,
  Activity,
  ChevronRight,
  Upload,
  Search,
  RefreshCw,
  Clock3,
  Menu,
} from 'lucide-react';

import './styles.css';
import EvidenceCenter from './EvidenceCenter';
import Analytics from './Analytics';
import IncidentEvidence from './IncidentEvidence';
import { API, requestJson } from './api';

import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  useMapEvents,
} from 'react-leaflet';

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';


delete L.Icon.Default.prototype._getIconUrl;

  L.Icon.Default.mergeOptions({
    iconRetinaUrl:
      'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',

    iconUrl:
      'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',

    shadowUrl:
      'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  });

const UMBC_CENTER = [39.2555, -76.7112];

const BUILDING_COORDS = {
  'ITE Building': [39.2553, -76.7113],
  'Information Technology/Engineering Building': [39.2553, -76.7113],

  'Commons': [39.2561, -76.7133],
  'The Commons': [39.2561, -76.7133],

  'Library': [39.2565, -76.7128],
  'Albin O. Kuhn Library': [39.2565, -76.7128],

  'Engineering': [39.2549, -76.7119],
  'Engineering Building': [39.2549, -76.7119],

  'Admin': [39.2557, -76.7101],
  'Administration Building': [39.2557, -76.7101],
};

function getIncidentCoordinates(incident) {
  if (
    incident.latitude != null &&
    incident.longitude != null
  ) {
    return [
      Number(incident.latitude),
      Number(incident.longitude),
    ];
  }

  return BUILDING_COORDS[
    incident.location
  ] || null;
}

function createIncidentIcon(level) {
  let color = '#64748b';

  if (level === 'Low') {
    color = '#ef4444';
  }

  if (level === 'Emerging') {
    color = '#f59e0b';
  }

  if (level === 'Strong') {
    color = '#22c55e';
  }

  return L.divIcon({
    className: 'custom-map-marker',

    html: `
      <div
        style="
          width: 24px;
          height: 24px;
          border-radius: 50%;
          background: ${color};
          border: 4px solid white;
          box-shadow: 0 4px 14px rgba(15,39,64,.3);
        "
      ></div>
    `,

    iconSize: [24, 24],

    iconAnchor: [12, 12],
  });
}

function Badge({ level }) {
  const safeLevel = level || 'Low';

  return (
    <span className={`badge ${safeLevel.toLowerCase()}`}>
      <span className="badgeDot" />
      {safeLevel}
    </span>
  );
}


function MetricCard({ title, value, icon }) {
  return (
    <div className="incidentMetric">
      <div className="metricIcon">
        {icon}
      </div>

      <div>
        <span>{title}</span>
        <strong>{value}</strong>
      </div>
    </div>
  );
}

function TimelineItem({ title, text }) {
  return (
    <div className="timelineItem">
      <div className="timelineDot" />

      <div>
        <b>{title}</b>
        <span>{text}</span>
      </div>
    </div>
  );
}
function ReportMapPin({ enabled, coordinates, onPick }) {
  useMapEvents({ click: (event) => { if (enabled) onPick(event.latlng.lat, event.latlng.lng); } });
  return coordinates ? <Marker position={coordinates}><Popup>Selected report location</Popup></Marker> : null;
}

function CampusMap({
  incidents,
  onSelectIncident,
  pickingLocation,
  reportCoordinates,
  onPickLocation,
}) {
  return (
    <section className="panel mapPanel">
      <div className="panelHeader">
        <div>
          <p className="panelEyebrow">
            Campus overview
          </p>

          <h2>
            UMBC Campus Activity Map
          </h2>
        </div>

        <div className="mapLegend">
          <span>
            <i className="dot low" />
            Low
          </span>

          <span>
            <i className="dot emerging" />
            Emerging
          </span>

          <span>
            <i className="dot strong" />
            Strong
          </span>
        </div>
      </div>

      <MapContainer
        center={UMBC_CENTER}
        zoom={16}
        scrollWheelZoom={true}
        className="realCampusMap"
      >
        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <ReportMapPin enabled={pickingLocation} coordinates={reportCoordinates} onPick={onPickLocation} />
        {incidents.map((incident) => {
          const coords =
            getIncidentCoordinates(
              incident
            );

          if (!coords) {
            return null;
          }

          return (
            <Marker
              key={incident.id}
              position={coords}
              icon={createIncidentIcon(
                incident.evidence_level
              )}
              eventHandlers={{
                click: () =>
                  onSelectIncident(
                    incident
                  ),
              }}
            >
              <Popup>
                <div className="mapPopup">
                  <strong>
                    {incident.title}
                  </strong>

                  <span>
                    {incident.location}
                  </span>

                  <span>
                    Evidence:{' '}
                    {
                      incident.evidence_level
                    }
                  </span>

                  <span>
                    Support:{' '}
                    {
                      incident.support_score
                    }
                    /100
                  </span>

                  <span>
                    Reports:{' '}
                    {
                      incident.report_count
                    }
                  </span>
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>

      <div className="mapFooter">
        <div className="mapStatCard">
          <b>
            {incidents.length}
          </b>

          <span>
            Active incident clusters
          </span>
        </div>

        <div className="mapStatCard">
          <b>
            {
              incidents.filter(
                (incident) =>
                  incident.evidence_level ===
                  'Strong'
              ).length
            }
          </b>

          <span>
            Strong evidence areas
          </span>
        </div>

        <div className="mapStatCard">
          <b>
            {
              incidents.filter(
                (incident) =>
                  incident.evidence_level ===
                  'Emerging'
              ).length
            }
          </b>

          <span>
            Emerging hotspots
          </span>
        </div>
      </div>
    </section>
  );
}
function LiveIncidents({
  incidents,
  selected,
  setSelected,
  vote,
}) {
  const [search, setSearch] = useState('');
  const [levelFilter, setLevelFilter] = useState('All');
  const [sortBy, setSortBy] = useState('score');

  const filtered = useMemo(() => {
    let list = [...incidents];

    if (search.trim()) {
      const query = search.toLowerCase();

      list = list.filter((incident) => {
        const title = incident.title?.toLowerCase() || '';
        const location = incident.location?.toLowerCase() || '';

        return (
          title.includes(query) ||
          location.includes(query)
        );
      });
    }

    if (levelFilter !== 'All') {
      list = list.filter(
        (incident) =>
          incident.evidence_level === levelFilter
      );
    }

    if (sortBy === 'score') {
      list.sort(
        (a, b) =>
          (b.support_score || 0) -
          (a.support_score || 0)
      );
    }

    if (sortBy === 'reports') {
      list.sort(
        (a, b) =>
          (b.report_count || 0) -
          (a.report_count || 0)
      );
    }

    return list;
  }, [
    incidents,
    search,
    levelFilter,
    sortBy,
  ]);

  const current =
    selected &&
    incidents.find(
      (incident) => incident.id === selected.id
    );

  return (
    <div className="liveIncidentsPage">
      <div className="pageHeader">
        <div>
          <p className="eyebrow">
            Incident Operations
          </p>

          <h1>Live Incidents</h1>

          <p>
            Monitor active incident clusters and their
            supporting evidence.
          </p>
        </div>

        <div className="liveStatus">
          <span className="livePulse" />
          Live monitoring
        </div>
      </div>

      <div className="incidentToolbar">
        <div className="incidentSearch">
          <Search size={17} />

          <input
            placeholder="Search incidents or locations"
            value={search}
            onChange={(event) =>
              setSearch(event.target.value)
            }
          />
        </div>

        <select
          value={levelFilter}
          onChange={(event) =>
            setLevelFilter(event.target.value)
          }
        >
          <option>All</option>
          <option>Low</option>
          <option>Emerging</option>
          <option>Strong</option>
        </select>

        <select
          value={sortBy}
          onChange={(event) =>
            setSortBy(event.target.value)
          }
        >
          <option value="score">
            Highest support
          </option>

          <option value="reports">
            Most reports
          </option>
        </select>
      </div>

      <div className="incidentWorkspace">
        <div className="incidentListPanel">
          <div className="listHeader">
            <div>
              <h2>Incident Feed</h2>

              <span>
                {filtered.length} active clusters
              </span>
            </div>
          </div>

          {filtered.length === 0 && (
            <div className="incidentEmpty">
              <ShieldCheck size={34} />

              <b>No matching incidents</b>

              <span>
                Try changing your search or filters.
              </span>
            </div>
          )}

          <div className="incidentList">
            {filtered.map((incident) => (
              <button
                key={incident.id}
                className={
                  current?.id === incident.id
                    ? 'liveIncidentCard selected'
                    : 'liveIncidentCard'
                }
                onClick={() =>
                  setSelected(incident)
                }
              >
                <div className="liveIncidentIcon">
                  <Wifi size={19} />
                </div>

                <div className="liveIncidentContent">
                  <div className="liveIncidentTop">
                    <div>
                      <b>{incident.title}</b>

                      <span>
                        <MapPin size={12} />
                        {incident.location}
                      </span>
                    </div>

                    <Badge
                      level={
                        incident.evidence_level
                      }
                    />
                  </div>

                  <div className="liveIncidentMeta">
                    <span>
                      <Users size={13} />
                      {incident.report_count || 0}{' '}
                      reports
                    </span>

                    <span>
                      <CheckCircle2 size={13} />
                      {incident.confirmations || 0}{' '}
                      confirmations
                    </span>
                  </div>

                  <div className="liveScoreHeader">
                    <span>
                      Evidence support
                    </span>

                    <strong>
                      {incident.support_score || 0}
                      /100
                    </strong>
                  </div>

                  <div
                    className={`liveScoreBar ${(
                      incident.evidence_level ||
                      'Low'
                    ).toLowerCase()}`}
                  >
                    <i
                      style={{
                        width: `${
                          incident.support_score ||
                          0
                        }%`,
                      }}
                    />
                  </div>
                </div>

                <ChevronRight size={18} />
              </button>
            ))}
          </div>
        </div>

        <div className="incidentDetailPanel">
          {!current && (
            <div className="detailPlaceholder">
              <Radio size={40} />

              <h3>Select an incident</h3>

              <p>
                Choose an incident from the feed to
                inspect its evidence and activity.
              </p>
            </div>
          )}

          {current && (
            <>
              <div className="incidentDetailHeader">
                <div>
                  <div className="incidentDetailTitle">
                    <div className="incidentDetailIcon">
                      <Wifi size={22} />
                    </div>

                    <div>
                      <h2>
                        {current.title}
                      </h2>

                      <p>
                        <MapPin size={14} />
                        {current.location}
                      </p>
                    </div>
                  </div>
                </div>

                <Badge
                  level={
                    current.evidence_level
                  }
                />
              </div>

              <IncidentEvidence key={current.id} incident={current} api={API} />

              <div className="bigEvidenceScore">
                <div>
                  <span>
                    Evidence support score
                  </span>

                  <strong>
                    {current.support_score || 0}
                  </strong>

                  <small>/100</small>
                </div>

                <div
                  className={`evidenceRing ${(
                    current.evidence_level ||
                    'Low'
                  ).toLowerCase()}`}
                  style={{
                    '--score': `${
                      (current.support_score ||
                        0) * 3.6
                    }deg`,
                  }}
                >
                  <div>
                    {current.support_score ||
                      0}
                  </div>
                </div>
              </div>

              <div className="incidentMetricGrid">
                <MetricCard
                  title="Reports"
                  value={
                    current.report_count || 0
                  }
                  icon={
                    <Users size={18} />
                  }
                />

                <MetricCard
                  title="Confirmations"
                  value={
                    current.confirmations ||
                    0
                  }
                  icon={
                    <CheckCircle2
                      size={18}
                    />
                  }
                />

                <MetricCard
                  title="Evidence level"
                  value={
                    current.evidence_level ||
                    'Low'
                  }
                  icon={
                    <ShieldCheck
                      size={18}
                    />
                  }
                />
              </div>

              <div className="evidenceSection">
                <div className="sectionTitle">
                  <div>
                    <BrainCircuit
                      size={18}
                    />

                    <h3>
                      Why this score?
                    </h3>
                  </div>

                  <span>
                    Explainable AI
                  </span>
                </div>

                <div className="reasonList">
                  {(current.reasons || [])
                    .length > 0 ? (
                    current.reasons.map(
                      (reason, index) => (
                        <div
                          className="evidenceReason"
                          key={index}
                        >
                          <CheckCircle2
                            size={17}
                          />

                          <span>
                            {reason}
                          </span>
                        </div>
                      )
                    )
                  ) : (
                    <div className="evidenceReason muted">
                      <AlertTriangle
                        size={17}
                      />

                      <span>
                        More evidence is needed to explain
                        this incident.
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <div className="timelineSection">
                <div className="sectionTitle">
                  <div>
                    <Clock3 size={18} />

                    <h3>
                      Incident Timeline
                    </h3>
                  </div>
                </div>

                <div className="timeline">
                  <TimelineItem
                    title="Incident created"
                    text="First community report submitted."
                  />

                  <TimelineItem
                    title="Report linking"
                    text="Reports linked using location, category, time and description overlap."
                  />

                  {(current.confirmations ||
                    0) > 0 && (
                    <TimelineItem
                      title="Community confirmation"
                      text={`${current.confirmations} users confirmed this incident.`}
                    />
                  )}
                </div>
              </div>

              <div className="detailActions">
                <button
                  className="confirmButton"
                  onClick={() =>
                    vote(
                      current.id,
                      'confirm'
                    )
                  }
                >
                  <CheckCircle2
                    size={17}
                  />
                  I see this too
                </button>

                <button
                  className="contradictButton"
                  onClick={() =>
                    vote(
                      current.id,
                      'contradict'
                    )
                  }
                >
                  <XCircle size={17} />
                  Not happening here
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function NavItem({
  icon,
  label,
  active,
  onClick,
}) {
  return (
    <button
      className={
        active
          ? 'navItem active'
          : 'navItem'
      }
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function Stat({
  title,
  value,
  icon,
  tone,
  subtitle,
}) {
  return (
    <div className="stat">
      <div
        className={`statIcon ${tone}`}
      >
        {icon}
      </div>

      <div className="statContent">
        <span>{title}</span>

        <strong>{value}</strong>

        <small>{subtitle}</small>
      </div>
    </div>
  );
}

const MOCK_NOTIFICATIONS = [
  { id: 1, message: 'New incident reported near ITE', unread: true },
  { id: 2, message: 'Incident evidence level changed to Emerging', unread: true },
  { id: 3, message: '3 new community confirmations', unread: true },
];

function HeaderControls({ refresh, loading, refreshLabel = 'incidents' }) {
  const [open, setOpen] = useState(null);
  const [notice, setNotice] = useState('');
  const controlsRef = useRef(null);
  const bellRef = useRef(null);
  const profileRef = useRef(null);
  const panelRef = useRef(null);
  const refreshPending = useRef(false);
  const notifications = MOCK_NOTIFICATIONS;
  const unread = notifications.some((notification) => notification.unread);
  const role = import.meta.env.VITE_UI_ROLE;
  const branch = import.meta.env.VITE_GIT_BRANCH;

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    const closeOutside = (event) => {
      if (!controlsRef.current?.contains(event.target)) setOpen(null);
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(null);
        (open === 'notifications' ? bellRef : profileRef).current?.focus();
      }
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('focusin', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('focusin', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const handleRefresh = async () => {
    if (loading || refreshPending.current) return;
    refreshPending.current = true;
    try {
      await refresh();
    } finally {
      refreshPending.current = false;
    }
  };

  return (
    <div className="headerActions" ref={controlsRef}>
      <button type="button" className="iconButton" onClick={handleRefresh}
        disabled={loading} aria-busy={loading}
        aria-label={loading ? `Refreshing ${refreshLabel}` : `Refresh ${refreshLabel}`}>
        <RefreshCw size={18} className={loading ? 'spin' : undefined} aria-hidden="true" />
      </button>
      <div className="headerPopoverAnchor">
        <button type="button" className="iconButton notificationButton" ref={bellRef}
          aria-label={unread ? 'Notifications, unread notifications' : 'Notifications'}
          aria-expanded={open === 'notifications'} aria-controls="header-notifications"
          onClick={() => setOpen(open === 'notifications' ? null : 'notifications')}>
          <Bell size={18} aria-hidden="true" />
          {unread && <span className="notificationDot" aria-hidden="true" />}
        </button>
        {open === 'notifications' && (
          <section id="header-notifications" className="headerPopover" ref={panelRef}
            tabIndex={-1} aria-labelledby="notifications-title">
            <b id="notifications-title">Notifications</b>
            {notifications.length ? (
              <ul className="notificationList">
                {notifications.map((notification) => <li key={notification.id}>{notification.message}</li>)}
              </ul>
            ) : <p className="headerPopoverNote">No new notifications</p>}
          </section>
        )}
      </div>
      <div className="headerPopoverAnchor">
        <button type="button" className="profile" ref={profileRef}
          aria-label="Runtime Terrors profile" aria-expanded={open === 'profile'}
          aria-controls="header-profile" onClick={() => {
            setNotice('');
            setOpen(open === 'profile' ? null : 'profile');
          }}>
          <span className="avatar">RT</span>
          <span><b>Runtime Terrors</b><small>HackUMBC</small></span>
        </button>
        {open === 'profile' && (
          <section id="header-profile" className="headerPopover" ref={panelRef}
            tabIndex={-1} aria-label="Team profile">
            <p>Team: <b>Runtime Terrors</b></p>
            <p>Event: <b>HackUMBC</b></p>
            {role && <p>UI role: {role}</p>}
            {branch && <p>Branch: {branch}</p>}
            <button type="button" className="headerPopoverAction"
              onClick={() => setNotice('Settings are coming soon.')}>Settings</button>
            <button type="button" className="headerPopoverAction"
              onClick={() => setNotice('Sign out is a demo placeholder; no session was changed.')}>Sign out</button>
            <p className="headerPopoverNote" role="status">{notice}</p>
          </section>
        )}
      </div>
    </div>
  );
}

function App() {
  const analyticsRef = useRef(null);
  const [incidents, setIncidents] =
    useState([]);

  const [selected, setSelected] =
    useState(null);

  const [activeView, setActiveView] =
    useState('dashboard');

  const [form, setForm] = useState({
    reporter_token: 'demo-user-1',
    description: '',
    category: 'Network / IT',
    location: 'ITE Building',
  });

  const [apiError, setApiError] = useState('');
  const [reportNotice, setReportNotice] = useState('');
  const [pickingLocation, setPickingLocation] = useState(false);
  const votePending = useRef(false);
  const reportPending = useRef(false);
  const [fileKey, setFileKey] = useState(0);

  const [image, setImage] =
    useState(null);

  const [busy, setBusy] =
    useState(false);

  const [loading, setLoading] =
    useState(true);

  const [
    sidebarOpen,
    setSidebarOpen,
  ] = useState(false);

  const refresh = async () => {
    if (activeView === 'analytics') return analyticsRef.current?.refresh();
    try {
      setLoading(true);
      const data = await requestJson('/incidents');
      setIncidents(data);
      setSelected((current) => current ? data.find((incident) => incident.id === current.id) || null : null);
      setApiError('');
    } catch (error) {
      setApiError(error.message);
    } finally { setLoading(false); }
  };

  useEffect(() => {
    refresh();
  }, []);

  const stats = useMemo(
    () => ({
      active: incidents.length,

      emerging: incidents.filter(
        (incident) =>
          incident.evidence_level ===
          'Emerging'
      ).length,

      strong: incidents.filter(
        (incident) =>
          incident.evidence_level ===
          'Strong'
      ).length,

      confirmations:
        incidents.reduce(
          (sum, incident) =>
            sum +
            (incident.confirmations ||
              0),
          0
        ),
    }),
    [incidents]
  );

  async function submit(event) {
    event.preventDefault();
    if (reportPending.current) return;
    reportPending.current = true;
    setBusy(true);
    setApiError('');
    setReportNotice('');
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([key, value]) => { if (value != null && value !== '') fd.append(key, value); });
      if (image) fd.append('image', image);
      const result = await requestJson('/reports', { method: 'POST', body: fd });
      setForm((current) => ({ ...current, description: '', latitude: null, longitude: null }));
      setImage(null);
      setFileKey((key) => key + 1);
      setPickingLocation(false);
      await refresh();
      setSelected(result.incident);
      setReportNotice(`Report saved to incident ${result.incident.id}.`);
    } catch (error) { setApiError(error.message); }
    finally { setBusy(false); reportPending.current = false; }
  }

  async function vote(id, type) {
    if (votePending.current) return;
    votePending.current = true;
    setApiError('');
    try {
      const result = await requestJson(`/incidents/${id}/${type}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reporter_token: form.reporter_token }),
      });
      setIncidents((items) => items.map((item) => item.id === id ? result : item));
      setSelected((current) => current?.id === id ? result : current);
    } catch (error) { setApiError(error.message); }
    finally { votePending.current = false; }
  }

  return (
    <div className="app">
      <aside
        className={
          sidebarOpen
            ? 'sidebar open'
            : 'sidebar'
        }
      >
        <div className="brand">
          <div className="brandIcon">
            <ShieldCheck size={24} />
          </div>

          <div>
            <b>VeriPulse</b>
            <small>
              Trust intelligence
            </small>
          </div>
        </div>

        <nav>
          <NavItem
            icon={
              <LayoutDashboard
                size={18}
              />
            }
            label="Dashboard"
            active={
              activeView ===
              'dashboard'
            }
            onClick={() =>
              setActiveView(
                'dashboard'
              )
            }
          />

          <NavItem
            icon={
              <Radio size={18} />
            }
            label="Live Incidents"
            active={
              activeView ===
              'incidents'
            }
            onClick={() =>
              setActiveView(
                'incidents'
              )
            }
          />

          <NavItem
            icon={
              <Image size={18} />
            }
            label="Evidence"
            active={
              activeView ===
              'evidence'
            }
            onClick={() =>
              setActiveView(
                'evidence'
              )
            }
          />

          <NavItem
            icon={
              <BarChart3 size={18} />
            }
            label="Analytics"
            active={
              activeView ===
              'analytics'
            }
            onClick={() =>
              setActiveView(
                'analytics'
              )
            }
          />
        </nav>

        <div className="sidebarSpacer" />

        <div className="tip">
          <div className="tipIcon">
            <BrainCircuit
              size={18}
            />
          </div>

          <div>
            <b>Judge demo</b>

            <span>
              Submit similar reports from
              different users and watch the
              evidence score update.
            </span>
          </div>
        </div>
      </aside>

      <main>
        {apiError && <div className="apiError" role="alert">{apiError}</div>}
        {activeView ===
          'dashboard' && (
          <>
            <header className="topbar">
              <div className="headerLeft">
                <button
                  className="mobileMenu"
                  onClick={() =>
                    setSidebarOpen(
                      !sidebarOpen
                    )
                  }
                >
                  <Menu size={20} />
                </button>

                <div>
                  <p className="eyebrow">
                    VeriPulse Dashboard
                  </p>

                  <h1>
                    Campus Incident Intelligence
                  </h1>

                  <p className="headerSubtitle">
                    Evidence-backed incident
                    monitoring powered by AI.
                  </p>
                </div>
              </div>

              <HeaderControls refresh={refresh} loading={loading} />
            </header>

            <section className="stats">
              <Stat
                title="Active Incidents"
                value={stats.active}
                icon={
                  <AlertTriangle
                    size={20}
                  />
                }
                tone="danger"
                subtitle="Currently monitored"
              />

              <Stat
                title="Emerging"
                value={stats.emerging}
                icon={
                  <Activity size={20} />
                }
                tone="warning"
                subtitle="Needs more evidence"
              />

              <Stat
                title="Strong Evidence"
                value={stats.strong}
                icon={
                  <ShieldCheck
                    size={20}
                  />
                }
                tone="success"
                subtitle="Highly corroborated"
              />

              <Stat
                title="Confirmations"
                value={
                  stats.confirmations
                }
                icon={
                  <Users size={20} />
                }
                tone="info"
                subtitle="Community signals"
              />
            </section>

            <CampusMap
              pickingLocation={pickingLocation}
              reportCoordinates={form.latitude != null && form.longitude != null ? [form.latitude, form.longitude] : null}
              onPickLocation={(latitude, longitude) => {
                setForm((current) => ({ ...current, latitude, longitude }));
                setPickingLocation(false);
              }}
              incidents={incidents}
              onSelectIncident={
                setSelected
              }
            />

            <section className="dashboardGrid">
              <div className="panel feed">
                <div className="panelHeader">
                  <div>
                    <p className="panelEyebrow">
                      Real-time monitoring
                    </p>

                    <h2>
                      Live Incident Feed
                    </h2>
                  </div>

                  <div className="panelActions">
                    <span>
                      {incidents.length}{' '}
                      clusters
                    </span>

                    <button
                      onClick={refresh}
                    >
                      <RefreshCw
                        size={16}
                      />
                    </button>
                  </div>
                </div>

                <div className="searchBox">
                  <Search size={17} />

                  <input
                    type="text"
                    placeholder="Search incidents or locations"
                  />
                </div>

                {loading && (
                  <div className="empty">
                    <RefreshCw
                      className="spin"
                      size={24}
                    />
                    Loading incidents...
                  </div>
                )}

                {!loading &&
                  incidents.length ===
                    0 && (
                    <div className="empty">
                      <ShieldCheck
                        size={32}
                      />

                      <b>
                        No active incidents
                      </b>

                      <span>
                        Submit your first
                        incident report to
                        start monitoring.
                      </span>
                    </div>
                  )}

                {!loading &&
                  incidents.map(
                    (incident) => (
                      <button
                        className={`incident ${
                          selected?.id ===
                          incident.id
                            ? 'selected'
                            : ''
                        }`}
                        key={
                          incident.id
                        }
                        onClick={() =>
                          setSelected(
                            incident
                          )
                        }
                      >
                        <div className="incidentIcon">
                          <Wifi
                            size={20}
                          />
                        </div>

                        <div className="incidentContent">
                          <div className="incidentTop">
                            <div>
                              <b>
                                {
                                  incident.title
                                }
                              </b>

                              <small className="incidentLocation">
                                <MapPin
                                  size={13}
                                />
                                {
                                  incident.location
                                }
                              </small>
                            </div>

                            <Badge
                              level={
                                incident.evidence_level
                              }
                            />
                          </div>

                          <div className="incidentMeta">
                            <span>
                              <Users
                                size={13}
                              />
                              {
                                incident.report_count
                              }{' '}
                              report
                              {incident.report_count !==
                              1
                                ? 's'
                                : ''}
                            </span>

                            <span>
                              <CheckCircle2
                                size={13}
                              />
                              {
                                incident.confirmations
                              }{' '}
                              confirmations
                            </span>
                          </div>

                          <div className="scoreRow">
                            <span>
                              Evidence support
                            </span>

                            <strong>
                              {
                                incident.support_score
                              }
                              /100
                            </strong>
                          </div>

                          <div className="scorebar">
                            <i
                              style={{
                                width: `${incident.support_score}%`,
                              }}
                            />
                          </div>
                        </div>

                        <ChevronRight
                          className="incidentChevron"
                          size={18}
                        />
                      </button>
                    )
                  )}
              </div>

              <div className="panel formPanel">
                <div className="panelHeader">
                  <div>
                    <p className="panelEyebrow">
                      Community report
                    </p>

                    <h2>
                      Report an Incident
                    </h2>
                  </div>

                  <span className="liveBadge">
                    <span />
                    Live analysis
                  </span>
                </div>

                <form
                  onSubmit={submit}
                >
                  <div className="fieldRow">
                    <label>
                      Reporter token

                      <input
                        value={
                          form.reporter_token
                        }
                        onChange={(
                          event
                        ) =>
                          setForm({
                            ...form,
                            reporter_token:
                              event.target
                                .value,
                          })
                        }
                      />
                    </label>

                    <label>
                      Category

                      <select
                        value={
                          form.category
                        }
                        onChange={(
                          event
                        ) =>
                          setForm({
                            ...form,
                            category:
                              event.target
                                .value,
                          })
                        }
                      >
                        <option>
                          Network / IT
                        </option>

                        <option>
                          Facilities
                        </option>

                        <option>
                          Environmental
                        </option>

                        <option>
                          Safety
                        </option>
                        <option>Other</option>
                      </select>
                    </label>
                  </div>

                  <label>
                    Location

                    <div className="inputWithIcon">
                      <MapPin
                        size={16}
                      />

                      <input
                        value={
                          form.location
                        }
                        onChange={(
                          event
                        ) =>
                          setForm({
                            ...form,
                            location:
                              event.target
                                .value,
                          })
                        }
                      />
                    </div>
                  </label>

                  <div className="reportCoordinates">
                    <button type="button" className="secondary" aria-pressed={pickingLocation} onClick={() => setPickingLocation((value) => !value)}>
                      {pickingLocation ? 'Cancel map pin' : 'Pin report location on campus map'}
                    </button>
                    {pickingLocation && <p role="status">Click the campus map above to select this report's coordinates.</p>}
                    <div className="fieldRow">
                      <label>Latitude (optional)<input type="number" step="any" min="-90" max="90" value={form.latitude ?? ''} onChange={(event) => setForm({ ...form, latitude: event.target.value === '' ? null : Number(event.target.value) })} /></label>
                      <label>Longitude (optional)<input type="number" step="any" min="-180" max="180" value={form.longitude ?? ''} onChange={(event) => setForm({ ...form, longitude: event.target.value === '' ? null : Number(event.target.value) })} /></label>
                    </div>
                    {form.latitude != null && <button type="button" className="secondary" onClick={() => setForm({ ...form, latitude: null, longitude: null })}>Clear coordinates</button>}
                  </div>

                  <label>
                    Description

                    <textarea
                      required
                      value={
                        form.description
                      }
                      onChange={(
                        event
                      ) =>
                        setForm({
                          ...form,
                          description:
                            event.target
                              .value,
                        })
                      }
                      placeholder="Example: eduroam keeps dropping on ITE level 2"
                    />

                    <small className="fieldHint">
                      Describe what you are
                      seeing as clearly as
                      possible.
                    </small>
                  </label>

                  <label className="uploadBox">
                    <Upload size={22} />

                    <div>
                      <b>
                        Attach evidence
                      </b>

                      <span>
                        Upload an image or video (up to 10 MB) to
                        support your report.
                      </span>
                    </div>

                    <input
                      key={fileKey}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm"
                      onChange={(
                        event
                      ) =>
                        setImage(
                          event.target
                            .files?.[0] ||
                            null
                        )
                      }
                    />

                    {image && (
                      <div className="fileSelected">
                        <Camera
                          size={14}
                        />
                        {image.name}
                      </div>
                    )}
                  </label>

                  <button
                    className="primary"
                    disabled={busy}
                  >
                    {busy ? (
                      <>
                        <RefreshCw
                          className="spin"
                          size={17}
                        />
                        Analyzing
                        evidence...
                      </>
                    ) : (
                      <>
                        <BrainCircuit
                          size={17}
                        />
                        Submit & Analyze
                      </>
                    )}
                  </button>
                  {reportNotice && <p role="status" className="fieldHint">{reportNotice}</p>}
                </form>
              </div>
            </section>

            {selected && (
              <section className="panel detail">
                <div className="panelHeader">
                  <div>
                    <p className="panelEyebrow">
                      Explainable AI
                    </p>

                    <h2>
                      Why this evidence
                      level?
                    </h2>
                  </div>

                  <button
                    className="close"
                    onClick={() =>
                      setSelected(null)
                    }
                  >
                    ×
                  </button>
                </div>

                <div className="detailTop">
                  <div>
                    <h3>
                      {selected.title}
                    </h3>

                    <p>
                      <MapPin
                        size={14}
                      />
                      {
                        selected.location
                      }
                    </p>
                  </div>

                  <div className="detailScore">
                    <Badge
                      level={
                        selected.evidence_level
                      }
                    />

                    <strong>
                      {
                        selected.support_score
                      }
                    </strong>

                    <span>
                      /100 support
                    </span>
                  </div>
                </div>

                <div className="detailGrid">
                  <div className="reasonCard">
                    <h4>
                      Support signals
                    </h4>

                    <div className="reasons">
                      {(
                        selected.reasons ||
                        []
                      ).map(
                        (
                          reason,
                          index
                        ) => (
                          <div
                            key={
                              index
                            }
                          >
                            <CheckCircle2
                              size={16}
                            />
                            {reason}
                          </div>
                        )
                      )}
                    </div>
                  </div>

                  <div className="reasonCard">
                    <h4>
                      Incident activity
                    </h4>

                    <div className="activityItem">
                      <Users
                        size={17}
                      />

                      <div>
                        <b>
                          {
                            selected.report_count
                          }
                        </b>

                        <span>
                          Independent
                          reports
                        </span>
                      </div>
                    </div>

                    <div className="activityItem">
                      <CheckCircle2
                        size={17}
                      />

                      <div>
                        <b>
                          {
                            selected.confirmations
                          }
                        </b>

                        <span>
                          Community
                          confirmations
                        </span>
                      </div>
                    </div>

                    <div className="activityItem">
                      <Clock3
                        size={17}
                      />

                      <div>
                        <b>Live</b>

                        <span>
                          Evidence
                          recalculates
                          instantly
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="actions">
                  <button
                    className="confirmButton"
                    onClick={() =>
                      vote(
                        selected.id,
                        'confirm'
                      )
                    }
                  >
                    <CheckCircle2
                      size={17}
                    />
                    I see this too
                  </button>

                  <button
                    className="contradictButton"
                    onClick={() =>
                      vote(
                        selected.id,
                        'contradict'
                      )
                    }
                  >
                    <XCircle
                      size={17}
                    />
                    Not happening here
                  </button>
                </div>
              </section>
            )}
          </>
        )}

        {activeView ===
          'incidents' && (
          <LiveIncidents
            incidents={incidents}
            selected={selected}
            setSelected={
              setSelected
            }
            vote={vote}
          />
        )}

        {activeView === 'evidence' && <EvidenceCenter />}

        {activeView === 'analytics' && <Analytics
          ref={analyticsRef}
          renderHeaderControls={(analyticsLoading) => <HeaderControls refresh={refresh} loading={analyticsLoading} refreshLabel="analytics" />}
          onSelectIncident={async (id) => {
            const incident = await requestJson(`/incidents/${id}`);
            setIncidents((current) => current.some((item) => item.id === id) ? current.map((item) => item.id === id ? incident : item) : [...current, incident]);
            setSelected(incident);
            setActiveView('incidents');
          }}
        />}
      </main>
    </div>
  );
}

createRoot(
  document.getElementById('root')
).render(<App />);