import type { Doc } from "../_generated/dataModel";
import type { ScoreInput, VisualMatch } from "./scoring";

export const EMBEDDING_DIMENSION = 384;
export const CLUSTER_SIMILARITY_THRESHOLD = 0.32;
export const CLUSTER_WINDOW_MS = 2 * 60 * 60 * 1000;
export const PHASH_DUPLICATE_DISTANCE = 6;
const CORROBORATION_WINDOW_MS = 30 * 60 * 1000;
const CAPTURE_CONFLICT_MS = 24 * 60 * 60 * 1000;
const GPS_CONFLICT_METERS = 500;

type ConsistencyStatus = "consistent" | "needs_review" | "conflicting" | "unavailable";

export const normalizeLocation = (value: string) => value.trim().toLocaleLowerCase().replace(/\s+/g, " ");

export function cosineSimilarity(a: number[], b: number[]) {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index];
    const right = b[index];
    if (!Number.isFinite(left) || !Number.isFinite(right)) return 0;
    dot += left * right;
    normA += left * left;
    normB += right * right;
  }
  return normA && normB ? dot / Math.sqrt(normA * normB) : 0;
}

export function hammingDistance(left?: string, right?: string) {
  if (!left || !right || !/^[0-9a-f]{16}$/i.test(left) || !/^[0-9a-f]{16}$/i.test(right)) return null;
  let distance = 0;
  for (let index = 0; index < left.length; index += 1) {
    let bits = Number.parseInt(left[index], 16) ^ Number.parseInt(right[index], 16);
    while (bits) {
      distance += bits & 1;
      bits >>>= 1;
    }
  }
  return distance;
}

export function captureTimeConsistency(reportedAt: number, capturedAt?: string): {
  status: ConsistencyStatus;
  differenceSeconds: number | null;
  note: string;
} {
  if (!capturedAt) return { status: "unavailable", differenceSeconds: null, note: "No capture timestamp was available." };
  // A timestamp without an explicit zone cannot be compared reliably.
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(capturedAt)) {
    return { status: "needs_review", differenceSeconds: null, note: "Capture timestamp has no timezone." };
  }
  const captured = Date.parse(capturedAt);
  if (!Number.isFinite(captured)) return { status: "needs_review", differenceSeconds: null, note: "Capture timestamp could not be parsed." };
  const differenceSeconds = Math.round(Math.abs(reportedAt - captured) / 1000);
  const status: ConsistencyStatus = differenceSeconds * 1000 > CAPTURE_CONFLICT_MS ? "conflicting" : "consistent";
  return {
    status,
    differenceSeconds,
    note: status === "consistent" ? "Capture time is close to the report time." : "Capture time differs from the report by more than 24 hours.",
  };
}

type Coordinates = { latitude?: number; longitude?: number };
export function gpsConsistency(reported: Coordinates, evidence?: { latitude: number; longitude: number }): {
  status: ConsistencyStatus;
  distanceMeters?: number;
} {
  if (!evidence || reported.latitude === undefined || reported.longitude === undefined) return { status: "unavailable" };
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const lat1 = radians(reported.latitude);
  const lat2 = radians(evidence.latitude);
  const dLat = lat2 - lat1;
  const dLon = radians(evidence.longitude - reported.longitude);
  const haversine = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const distanceMeters = Math.round(2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(haversine))));
  return { status: distanceMeters <= GPS_CONFLICT_METERS ? "consistent" : "conflicting", distanceMeters };
}

export const hasMetadataConflict = (report: Pick<Doc<"reports">, "captureTimeStatus" | "gpsStatus">) =>
  report.captureTimeStatus === "conflicting" || report.gpsStatus === "conflicting";

type ScoreReport = Pick<Doc<"reports">,
  "reporterToken" | "semanticSimilarity" | "duplicateEvidence" | "createdAt" |
  "imageStorageId" | "captureTimeStatus" | "gpsStatus" | "visualMatch"
>;
type ScoreIncident = Pick<Doc<"incidents">, "confirmations" | "contradictions">;

export function scoreInputFor(incident: ScoreIncident, reports: ScoreReport[]): ScoreInput {
  const newest = reports.reduce((latest, report) => Math.max(latest, report.createdAt), Number.NEGATIVE_INFINITY);
  const nearby = reports.length < 2 ? 0 : reports.filter((report) => report.createdAt !== newest && newest - report.createdAt <= CORROBORATION_WINDOW_MS).length;
  // The first report starts an incident and has no pairwise similarity. Average
  // only later reports that were actually compared with the cluster.
  const similarities = reports.map((report) => report.semanticSimilarity).filter((value) => value > 0);
  const visual = [...reports]
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((report) => report.visualMatch)
    .find((value): value is VisualMatch => value === "yes" || value === "partial" || value === "no") ?? "unavailable";
  return {
    distinct_reporters: new Set(reports.map((report) => report.reporterToken)).size,
    semantic_agreement: similarities.length ? similarities.reduce((sum, value) => sum + value, 0) / similarities.length : 0,
    confirmations: incident.confirmations,
    contradictions: incident.contradictions,
    unique_images: reports.filter((report) => report.imageStorageId && !report.duplicateEvidence).length,
    duplicate_images: reports.filter((report) => report.imageStorageId && report.duplicateEvidence).length,
    metadata_conflicts: reports.filter(hasMetadataConflict).length,
    time_proximity: nearby >= 2 ? 1 : nearby === 1 ? 0.5 : 0,
    visual_match: visual,
  };
}
