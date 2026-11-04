import { query } from "./_generated/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { hasMetadataConflict } from "./lib/evidence";

const CATEGORY_ORDER = ["Network / IT", "Facilities", "Environmental", "Safety", "Other"];
const CATEGORIES = new Set(CATEGORY_ORDER);
const LEVELS = ["Low", "Emerging", "Strong"] as const;
const DAY = 24 * 60 * 60 * 1000;
const RANGES = { "24h": DAY, "7d": 7 * DAY, "30d": 30 * DAY } as const;

const iso = (value: number) => new Date(value).toISOString();
const counter = <T,>(items: T[], key: (item: T) => string) => {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return counts;
};

type Grouping = "hour" | "day" | "month";
function bucket(value: number, grouping: Grouping) {
  const date = new Date(value);
  if (grouping === "hour") return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours());
  if (grouping === "day") return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
}
function nextBucket(value: number, grouping: Grouping) {
  const date = new Date(value);
  if (grouping === "hour") return value + 60 * 60 * 1000;
  if (grouping === "day") return value + DAY;
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
}

type Incident = Doc<"incidents">;
type Report = Doc<"reports">;
type SummaryArgs = { range: keyof typeof RANGES | "all"; category?: string; evidenceLevel?: string; location?: string };

function selectIncidents(incidents: Incident[], args: SummaryArgs, inside: (timestamp: number) => boolean) {
  return incidents.filter((incident) => inside(incident.createdAt)
    && (!args.category || incident.category === args.category)
    && (!args.location || incident.location === args.location)
    && (!args.evidenceLevel || incident.evidenceLevel === args.evidenceLevel));
}

function groupingFor(range: SummaryArgs["range"], now: number, earliest: number): Grouping {
  if (range === "24h") return "hour";
  if (range === "all" && now - earliest > 90 * DAY) return "month";
  return "day";
}

function activityFor(incidents: Incident[], reports: Report[], start: number | null, now: number, earliest: number, grouping: Grouping) {
  const incidentPeriods = counter(incidents, (incident) => String(bucket(incident.createdAt, grouping)));
  const reportPeriods = counter(reports, (report) => String(bucket(report.createdAt, grouping)));
  const activity: { period: string; incidents: number; reports: number }[] = [];
  if (!incidents.length && !reports.length) return activity;
  for (let cursor = bucket(start ?? earliest, grouping), end = bucket(now, grouping); cursor <= end && activity.length < 2000; cursor = nextBucket(cursor, grouping)) {
    activity.push({ period: iso(cursor), incidents: incidentPeriods.get(String(cursor)) ?? 0, reports: reportPeriods.get(String(cursor)) ?? 0 });
  }
  return activity;
}

function evidenceHealth(evidence: Report[]) {
  const health = { unique: 0, exact_duplicates: 0, near_duplicates: 0, metadata_conflicts: 0, location_conflicts: 0, timestamp_conflicts: 0, reviewed: 0, flagged: 0 };
  for (const report of evidence) {
    if (!report.duplicateEvidence) health.unique += 1;
    else if (report.duplicateDistance === 0) health.exact_duplicates += 1;
    else health.near_duplicates += 1;
    health.timestamp_conflicts += Number(report.captureTimeStatus === "conflicting");
    health.location_conflicts += Number(report.gpsStatus === "conflicting");
    health.metadata_conflicts += Number(hasMetadataConflict(report));
    if (report.reviewState === "reviewed" || report.reviewState === "flagged") health[report.reviewState] += 1;
  }
  return health;
}

function reportingSummary(incidents: Incident[], reports: Report[]) {
  const reporters = new Map<string, Set<string>>();
  for (const report of reports) reporters.set(report.incidentId, (reporters.get(report.incidentId) ?? new Set()).add(report.reporterToken));
  return {
    distinct_reporters: new Set(reports.map((report) => report.reporterToken)).size,
    average_reports_per_incident: incidents.length ? Math.round((reports.length / incidents.length) * 100) / 100 : 0,
    multi_reporter_incidents: [...reporters.values()].filter((tokens) => tokens.size > 1).length,
    single_reporter_incidents: [...reporters.values()].filter((tokens) => tokens.size === 1).length,
  };
}

/**
 * Analytics over the live Convex data (same response shape the Analytics page
 * used to fetch from the SQLite backend). The range selects incidents created
 * in the window, plus their reports and uploads in that window. Votes and
 * scores are current totals. All buckets are UTC.
 */
export const summary = query({
  args: {
    range: v.union(v.literal("24h"), v.literal("7d"), v.literal("30d"), v.literal("all")),
    category: v.optional(v.string()),
    evidenceLevel: v.optional(v.string()),
    location: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const start = args.range === "all" ? null : now - RANGES[args.range];
    const inside = (timestamp: number) => (start === null || timestamp >= start) && timestamp <= now;

    const incidents = await ctx.db.query("incidents").collect();
    const reports = await ctx.db.query("reports").collect();

    const selected = selectIncidents(incidents, args, inside);
    const ids = new Set(selected.map((incident) => incident._id));
    const selectedReports = reports.filter((report) => ids.has(report.incidentId) && inside(report.createdAt));
    const evidence = selectedReports.filter((report) => report.imageStorageId);

    const confirmations = selected.reduce((sum, incident) => sum + incident.confirmations, 0);
    const contradictions = selected.reduce((sum, incident) => sum + incident.contradictions, 0);
    const levels = Object.fromEntries(LEVELS.map((level) => [level, selected.filter((incident) => incident.evidenceLevel === level).length]));
    const categoryCounts = counter(selected, (incident) => incident.category);
    const incidentLocations = counter(selected, (incident) => incident.location);
    const reportLocations = counter(selectedReports, (report) => report.location);
    const locations = [...new Set([...incidentLocations.keys(), ...reportLocations.keys()])]
      .map((location) => ({ location, incidents: incidentLocations.get(location) ?? 0, reports: reportLocations.get(location) ?? 0 }))
      .sort((a, b) => b.reports - a.reports || b.incidents - a.incidents || a.location.localeCompare(b.location));

    const earliest = Math.min(now, ...selected.map((incident) => incident.createdAt), ...selectedReports.map((report) => report.createdAt));
    const grouping = groupingFor(args.range, now, earliest);
    const activity = activityFor(selected, selectedReports, start, now, earliest, grouping);
    const health = evidenceHealth(evidence);
    const scopedCounts = counter(selectedReports, (report) => report.incidentId);
    const distribution = ["0-24", "25-49", "50-74", "75-100"].map((range) => ({ range, count: 0 }));
    for (const incident of selected) distribution[Math.min(Math.floor(incident.supportScore / 25), 3)].count += 1;
    const recent = [...selected]
      .sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt))
      .slice(0, 8)
      .map((incident: Doc<"incidents">) => ({
        id: incident._id,
        title: incident.title,
        category: incident.category,
        location: incident.location,
        evidence_level: incident.evidenceLevel,
        support_score: incident.supportScore,
        confirmations: incident.confirmations,
        updated_at: iso(incident.updatedAt ?? incident.createdAt),
        report_count: scopedCounts.get(incident._id) ?? 0,
      }));

    return {
      summary: {
        active_incidents: selected.length,
        total_reports: selectedReports.length,
        confirmations,
        contradictions,
        evidence_items: evidence.length,
        strong_incidents: levels.Strong,
      },
      activity,
      activity_grouping: grouping,
      timezone: "UTC",
      generated_at: iso(now),
      available_locations: [...new Set(incidents.map((incident) => incident.location))].sort((a, b) => a.localeCompare(b)),
      evidence_levels: levels,
      categories: [...CATEGORY_ORDER, ...[...categoryCounts.keys()].filter((name) => !CATEGORIES.has(name)).sort((a, b) => a.localeCompare(b))]
        .map((category) => ({ category, incidents: categoryCounts.get(category) ?? 0 })),
      locations: locations.slice(0, 8),
      community: {
        confirmations,
        contradictions,
        confirmation_ratio: confirmations + contradictions ? confirmations / (confirmations + contradictions) : null,
      },
      evidence_health: health,
      // Counts only; tokens themselves never leave the server.
      reporting: reportingSummary(selected, selectedReports),
      support_distribution: distribution,
      recent_incidents: recent,
    };
  },
});
