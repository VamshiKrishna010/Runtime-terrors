import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Activity, FileText, CheckCircle2, XCircle, Image, ShieldCheck, BarChart3, RefreshCw } from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, Legend, BarChart, Bar } from 'recharts';
import { requestJson } from './api';

export const DEFAULT_FILTERS = { range: 'all', category: '', evidence_level: '', location: '' };
export function analyticsQuery(filters) {
  return new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== '')).toString();
}
export function normalizeAnalytics(value) {
  if (!value || typeof value !== 'object' || !value.summary || !Number.isFinite(value.summary.active_incidents)) throw new Error('Unsupported analytics response');
  const numbers = (input, keys) => Object.fromEntries(keys.map((key) => [key, Number.isFinite(input?.[key]) ? input[key] : 0]));
  const array = (input) => Array.isArray(input) ? input.filter((item) => item && typeof item === 'object') : [];
  const community = numbers(value.community, ['confirmations', 'contradictions']);
  const denominator = community.confirmations + community.contradictions;
  return { ...value,
    summary: numbers(value.summary, ['active_incidents', 'total_reports', 'confirmations', 'contradictions', 'evidence_items', 'strong_incidents']),
    activity: array(value.activity), categories: array(value.categories), locations: array(value.locations),
    support_distribution: array(value.support_distribution),
    recent_incidents: array(value.recent_incidents).map((item) => ({ ...item, evidence_level: ['Low', 'Emerging', 'Strong'].includes(item.evidence_level) ? item.evidence_level : 'Low' })),
    available_locations: Array.isArray(value.available_locations) ? value.available_locations.filter((item) => typeof item === 'string') : [],
    evidence_levels: numbers(value.evidence_levels, ['Low', 'Emerging', 'Strong']),
    evidence_health: numbers(value.evidence_health, ['unique', 'exact_duplicates', 'near_duplicates', 'metadata_conflicts', 'location_conflicts', 'timestamp_conflicts', 'reviewed', 'flagged']),
    reporting: numbers(value.reporting, ['distinct_reporters', 'average_reports_per_incident', 'multi_reporter_incidents', 'single_reporter_incidents']),
    community: { ...community, confirmation_ratio: denominator > 0 ? community.confirmations / denominator : null },
  };
}
const CATEGORIES = ['Network / IT', 'Facilities', 'Environmental', 'Safety', 'Other'];
const formatDate = (value, short = false) => new Date(value).toLocaleString('en-US', {
  timeZone: 'UTC', month: 'short', day: 'numeric', ...(short ? {} : { year: 'numeric', hour: 'numeric', minute: '2-digit' }),
});
const percentage = (value) => `${(value * 100).toFixed(1)}%`;
const tooltipStyle = { border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text)', background: 'var(--panel)' };

function Panel({ title, children, className = '' }) {
  return <section className={`analyticsPanel ${className}`} aria-label={title}><h2>{title}</h2>{children}</section>;
}
function NoActivity({ children = 'No activity in this selection.' }) {
  return <p className="analyticsChartEmpty">{children}</p>;
}
function Values({ rows }) {
  return <dl className="analyticsValues">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}
export function AnalyticsLoading() {
  return <div className="analyticsLoading" role="status" aria-label="Loading analytics"><span>Loading analytics...</span>
    <div className="analyticsSummary">{Array.from({ length: 6 }, (_, index) => <div className="analyticsSkeleton" key={index} />)}</div>
    <div className="analyticsGrid"><div className="analyticsSkeleton chart" /><div className="analyticsSkeleton chart" /></div></div>;
}
export function AnalyticsError({ retry }) {
  return <div className="analyticsEmpty" role="alert"><BarChart3 size={32} aria-hidden="true" /><h2>Analytics unavailable</h2>
    <p>Unable to load analytics data from the backend.</p><button type="button" onClick={retry}>Retry</button></div>;
}

export function AnalyticsContent({ data, onSelectIncident, navigationError }) {
  const cards = [
    ['Active Incidents', data.summary.active_incidents, 'Current incident clusters', Activity, 'info'],
    ['Total Reports', data.summary.total_reports, 'Submitted community reports', FileText, 'info'],
    ['Confirmations', data.summary.confirmations, 'Current community confirmations', CheckCircle2, 'success'],
    ['Contradictions', data.summary.contradictions, 'Current community contradictions', XCircle, 'danger'],
    ['Evidence Items', data.summary.evidence_items, 'Uploaded evidence records', Image, 'info'],
    ['Strong Evidence Incidents', data.summary.strong_incidents, 'Accumulated supporting signals', ShieldCheck, 'success'],
  ];
  const total = data.summary.active_incidents;
  const community = data.community;
  const responseData = [{ name: 'Confirmations', count: community.confirmations }, { name: 'Contradictions', count: community.contradictions }];
  const maxLocation = Math.max(1, ...data.locations.map((row) => row.reports));
  return <>
    <div className="analyticsSummary">{cards.map(([label, value, subtitle, Icon, tone]) => <div className="stat" key={label}>
      <div className={`statIcon ${tone}`}><Icon size={20} aria-hidden="true" /></div><div className="statContent"><span>{label}</span><strong>{value}</strong><small>{subtitle}</small></div>
    </div>)}</div>
    {!total && !data.summary.total_reports ? <div className="analyticsEmpty"><BarChart3 size={36} aria-hidden="true" /><h2>No analytics yet</h2>
      <p>Analytics will appear as campus reports and evidence are submitted.</p><p>Try resetting filters if you expected existing activity.</p></div> : <>
    <div className="analyticsGrid">
      <Panel title="Incident Activity"><p className="analyticsNote">Reports and new clusters by {data.activity_grouping}. All times UTC.</p>
        {data.activity.length ? <><div className="analyticsChart"><ResponsiveContainer width="100%" height="100%">
          <LineChart data={data.activity} accessibilityLayer margin={{ top: 10, right: 15, left: -20, bottom: 5 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" /><XAxis dataKey="period" minTickGap={35} tickFormatter={(value) => data.activity_grouping === 'hour' ? new Date(value).toISOString().slice(11, 16) : formatDate(value, true)} tick={{ fontSize: 11 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} /><Tooltip contentStyle={tooltipStyle} labelFormatter={(value) => `${formatDate(value)} UTC`} /><Legend />
            <Line type="linear" dataKey="reports" name="Reports" stroke="var(--primary)" strokeWidth={2} dot={data.activity.length < 3} isAnimationActive={false} />
            <Line type="linear" dataKey="incidents" name="Incident clusters" stroke="var(--sidebar-soft)" strokeWidth={2} strokeDasharray="5 3" dot={data.activity.length < 3} isAnimationActive={false} />
          </LineChart></ResponsiveContainer></div>
          <details className="analyticsData"><summary>View activity values</summary><div className="analyticsTableScroll"><table><thead><tr><th>Period (UTC)</th><th>Reports</th><th>Incident clusters</th></tr></thead><tbody>{data.activity.map((row) => <tr key={row.period}><td>{formatDate(row.period)}</td><td>{row.reports}</td><td>{row.incidents}</td></tr>)}</tbody></table></div></details></> : <NoActivity />}
      </Panel>
      <Panel title="Evidence Strength"><div className="analyticsStrengthBar" aria-hidden="true">{Object.entries(data.evidence_levels).map(([level, count]) => <span key={level} className={level.toLowerCase()} style={{ width: `${total ? count / total * 100 : 0}%` }} />)}</div>
        <Values rows={Object.entries(data.evidence_levels).map(([level, count]) => [level, `${count} incidents (${percentage(total ? count / total : 0)})`])} />
        <p className="analyticsNote">Evidence level reflects accumulated supporting signals, not verified truth.</p>
      </Panel>
      <Panel title="Incidents by Category"><div className="analyticsChart"><ResponsiveContainer width="100%" height="100%">
        <BarChart data={data.categories} layout="vertical" accessibilityLayer margin={{ left: 15, right: 20 }}><CartesianGrid stroke="var(--border)" horizontal={false} />
          <XAxis type="number" allowDecimals={false} /><YAxis dataKey="category" type="category" width={105} tick={{ fontSize: 11 }} />
          <Tooltip contentStyle={tooltipStyle} /><Bar dataKey="incidents" name="Incidents" fill="var(--primary)" radius={[0, 4, 4, 0]} isAnimationActive={false} /></BarChart>
      </ResponsiveContainer></div><Values rows={data.categories.map((row) => [row.category, row.incidents])} /></Panel>
      <Panel title="Most Reported Locations">{data.locations.length ? <div className="analyticsLocations">{data.locations.map((row) => <div key={row.location}>
        <div className="analyticsLocationHeading"><b>{row.location}</b><span>{row.incidents} incidents / {row.reports} reports</span></div>
        <div className="analyticsLocationTrack" aria-hidden="true"><span style={{ width: `${row.reports / maxLocation * 100}%` }} /></div>
      </div>)}</div> : <NoActivity>No reported locations in this selection.</NoActivity>}</Panel>
      <Panel title="Community Response"><p className="analyticsNote">Community response signal: current votes for selected incident clusters.</p>
        {community.confirmation_ratio === null ? <NoActivity>No community responses yet.</NoActivity> : <div className="analyticsChart compact"><ResponsiveContainer width="100%" height="100%"><BarChart data={responseData} accessibilityLayer>
          <CartesianGrid stroke="var(--border)" vertical={false} /><XAxis dataKey="name" tick={{ fontSize: 11 }} /><YAxis allowDecimals={false} /><Tooltip contentStyle={tooltipStyle} /><Bar dataKey="count" name="Responses" fill="var(--primary)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart></ResponsiveContainer></div>}
        <Values rows={[["Confirmations", community.confirmations], ['Contradictions', community.contradictions], ['Confirmation ratio', community.confirmation_ratio === null ? 'Not available (no responses)' : percentage(community.confirmation_ratio)]]} />
        <p className="analyticsNote">Responses are supporting or contradicting signals, not proof.</p>
      </Panel>
      <Panel title="Evidence Health"><Values rows={[
        ['Unique evidence', data.evidence_health.unique], ['Exact duplicates', data.evidence_health.exact_duplicates], ['Near-duplicates', data.evidence_health.near_duplicates],
        ['Metadata conflicts', data.evidence_health.metadata_conflicts], ['Location conflicts', data.evidence_health.location_conflicts], ['Timestamp conflicts', data.evidence_health.timestamp_conflicts],
        ['Reviewed', data.evidence_health.reviewed], ['Flagged', data.evidence_health.flagged],
      ]} /><p className="analyticsNote">Duplicates count reused submissions, excluding originals. Conflict counts can overlap. Missing metadata is not a conflict.</p></Panel>
      <Panel title="Reporting Activity"><Values rows={[
        ['Distinct pseudonymous reporters', data.reporting.distinct_reporters], ['Average reports per incident', data.reporting.average_reports_per_incident],
        ['Incidents with multiple reporter tokens', data.reporting.multi_reporter_incidents], ['Incidents with one reporter token', data.reporting.single_reporter_incidents],
      ]} /><p className="analyticsNote">Distinct tokens do not establish independent people or verified identities. Clusters with no reports are excluded from reporter-count groups.</p></Panel>
      <Panel title="Support Score Distribution"><div className="analyticsChart compact"><ResponsiveContainer width="100%" height="100%"><BarChart data={data.support_distribution} accessibilityLayer>
        <CartesianGrid stroke="var(--border)" vertical={false} /><XAxis dataKey="range" /><YAxis allowDecimals={false} /><Tooltip contentStyle={tooltipStyle} /><Bar dataKey="count" name="Incidents" fill="var(--primary)" isAnimationActive={false} radius={[4, 4, 0, 0]} />
      </BarChart></ResponsiveContainer></div><Values rows={data.support_distribution.map((row) => [row.range, row.count])} />
        <p className="analyticsNote">Support scores summarize evidence and community signals. They do not determine factual truth. Ranges use cutoffs at 25, 50 and 75.</p></Panel>
    </div>
    <Panel title="Recent Incident Activity">{navigationError && <p role="alert" className="apiError">{navigationError}</p>}
      <div className="analyticsTableScroll"><table><caption className="analyticsNote">Select an incident title to open Live Incidents.</caption><thead><tr>{['Incident', 'Category', 'Location', 'Reports', 'Evidence level', 'Support', 'Confirmations', 'Updated (UTC)'].map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>{data.recent_incidents.map((item) => <tr key={item.id}><td><button type="button" className="analyticsIncidentLink" onClick={() => onSelectIncident(item.id)}>{item.title}</button></td><td>{item.category}</td><td>{item.location}</td><td>{item.report_count}</td><td><span className={`badge ${item.evidence_level.toLowerCase()}`}>{item.evidence_level}</span></td><td>{item.support_score}/100</td><td>{item.confirmations}</td><td>{formatDate(item.updated_at)}</td></tr>)}</tbody>
      </table></div>
    </Panel></>}
  </>;
}

const Analytics = forwardRef(function Analytics({ renderHeaderControls, onSelectIncident }, ref) {
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [data, setData] = useState(null);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [navigationError, setNavigationError] = useState('');
  const controllerRef = useRef(null);
  const load = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true); setError(false);
    try {
      const result = normalizeAnalytics(await requestJson(`/analytics/summary?${analyticsQuery(filters)}`, { signal: controller.signal }));
      if (!controller.signal.aborted) { setData(result); setLocations(result.available_locations); }
    } catch (error) { if (!controller.signal.aborted) setError(true); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }, [filters]);
  useImperativeHandle(ref, () => ({ refresh: load }), [load]);
  useEffect(() => { load(); return () => controllerRef.current?.abort(); }, [load]);
  const change = (key, value) => setFilters((current) => ({ ...current, [key]: value }));
  const selectIncident = async (id) => {
    setNavigationError('');
    try { await onSelectIncident(id); }
    catch (error) { setNavigationError(`Unable to open incident: ${error.message}`); }
  };
  return <div className="analyticsPage">
    <header className="pageHeader"><div><p className="eyebrow">Operational Intelligence</p><h1>Analytics</h1><p>Understand incident patterns, evidence quality, reporting activity, and community response across campus.</p></div>
      <div className="analyticsHeaderActions"><span className={`analyticsLiveStatus${error ? ' error' : ''}`}><Activity size={14} aria-hidden="true" />{error ? 'Unavailable' : loading ? 'Loading data' : 'Live data'}</span>{renderHeaderControls?.(loading)}</div>
    </header>
    <div className="analyticsFilters">
      <label>Time range<select value={filters.range} onChange={(event) => change('range', event.target.value)}><option value="24h">Last 24 hours</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="all">All time</option></select></label>
      <label>Category<select value={filters.category} onChange={(event) => change('category', event.target.value)}><option value="">All categories</option>{CATEGORIES.map((value) => <option key={value}>{value}</option>)}</select></label>
      <label>Evidence level<select value={filters.evidence_level} onChange={(event) => change('evidence_level', event.target.value)}><option value="">All</option>{['Low', 'Emerging', 'Strong'].map((value) => <option key={value}>{value}</option>)}</select></label>
      <label>Location<select value={filters.location} onChange={(event) => change('location', event.target.value)}><option value="">All locations</option>{locations.map((value) => <option key={value}>{value}</option>)}</select></label>
      <button type="button" onClick={() => setFilters({ ...DEFAULT_FILTERS })}>Reset filters</button>
    </div>
    <p className="analyticsScope">Analytics uses the FastAPI SQLite dataset; Convex-only reports are not included. Time range selects clusters created in the window and their reports/uploads in that window. Votes, support and review states are current totals for those clusters. Active means current clusters; no resolved status is tracked.</p>
    {loading ? <AnalyticsLoading /> : error ? <AnalyticsError retry={load} /> : data && <AnalyticsContent data={data} onSelectIncident={selectIncident} navigationError={navigationError} />}
  </div>;
});
export default Analytics;
