import { mutation, query } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { reviewState } from "./schema";
import { captureTimeConsistency } from "./lib/evidence";
import { WEIGHTS } from "./lib/scoring";

const MAX_EVIDENCE_ITEMS = 500;
const iso = (value?: number) => (value === undefined ? null : new Date(value).toISOString());
export const evidenceLabel = (id: Id<"reports"> | string) => `EV-${String(id).slice(-6).toUpperCase()}`;

function contributions(images: Doc<"reports">[]) {
  // Mirrors the incident score's image terms: +4 per unique image (first 3)
  // and -12 per reused image (first 3), allocated oldest first.
  const result = new Map<Id<"reports">, number>();
  const byIncident = new Map<Id<"incidents">, Doc<"reports">[]>();
  for (const report of images) byIncident.set(report.incidentId, [...(byIncident.get(report.incidentId) ?? []), report]);
  for (const group of byIncident.values()) {
    group.sort((a, b) => a.createdAt - b.createdAt);
    const reused = group.filter((report) => report.duplicateEvidence).slice(0, WEIGHTS.duplicateCap / WEIGHTS.duplicate);
    const unique = group.filter((report) => !report.duplicateEvidence).slice(0, WEIGHTS.imageCap / WEIGHTS.image);
    for (const report of reused) result.set(report._id, -WEIGHTS.duplicate);
    for (const report of unique) result.set(report._id, WEIGHTS.image);
  }
  return result;
}

function evidenceStatus(report: Doc<"reports">) {
  const statuses = new Set([report.captureTimeStatus, report.gpsStatus]);
  if (statuses.has("conflicting")) return "metadata_conflict";
  if (report.duplicateEvidence) return "duplicate";
  if (statuses.has("consistent") && !statuses.has("needs_review")) return "consistent";
  return "needs_review";
}

/**
 * Evidence Center data, shaped like the old FastAPI /evidence payload so the
 * existing adapter keeps working. Reporter tokens, embeddings and raw GPS are
 * never included.
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const recent = await ctx.db.query("reports").withIndex("by_created_at").order("desc").take(MAX_EVIDENCE_ITEMS * 2);
    const images = recent.filter((report) => report.imageStorageId).slice(0, MAX_EVIDENCE_ITEMS);
    const incidentIds = [...new Set(images.map((report) => report.incidentId))];
    const incidents = new Map((await Promise.all(incidentIds.map((id) => ctx.db.get(id)))).filter(Boolean).map((incident) => [incident!._id, incident!]));
    const points = contributions(images);

    return await Promise.all(images.filter((report) => incidents.has(report.incidentId)).map(async (report) => {
      const incident = incidents.get(report.incidentId)!;
      const time = captureTimeConsistency(report.createdAt, report.exifDatetime);
      const timeline = [
        { title: "Evidence uploaded", timestamp: iso(report.createdAt) },
        ...(report.imageSanitized ? [{ title: "EXIF and embedded metadata removed before storage", timestamp: iso(report.createdAt) }] : []),
        { title: "File hash generated", timestamp: iso(report.createdAt) },
        { title: "Duplicate scan completed", timestamp: iso(report.createdAt) },
        { title: "Support score recalculated", timestamp: iso(report.createdAt) },
        ...(report.reviewedAt ? [{ title: `Human review updated: ${report.reviewState}`, timestamp: iso(report.reviewedAt) }] : []),
      ];
      let duplicateStatus = "No duplicate evidence found";
      if (report.duplicateDistance === 0) duplicateStatus = "Exact duplicate detected";
      else if (report.duplicateEvidence) duplicateStatus = "Near-duplicate detected";
      return {
        id: report._id,
        label: evidenceLabel(report._id),
        report_id: report._id,
        incident_id: report.incidentId,
        title: incident.title,
        reported_claim: report.description,
        location: report.location,
        type: "image",
        url: report.imageSanitized ? await ctx.storage.getUrl(report.imageStorageId!) : null,
        mime_type: report.imageMimeType ?? null,
        file_size: report.imageFileSize ?? null,
        uploaded_at: iso(report.createdAt),
        sha256_hash: report.imageSha256 ?? null,
        perceptual_hash: report.imagePhash ?? null,
        metadata: {
          camera_device: report.cameraDevice ?? null,
          width: report.imageWidth ?? null,
          height: report.imageHeight ?? null,
          capture_timestamp: report.exifDatetime ?? null,
          editing_software: report.editingSoftware ?? null,
          exif_available: Boolean(report.exifDatetime || report.cameraDevice || report.editingSoftware || report.hasExifGps),
        },
        provenance: {
          source: "gallery_upload",
          in_app_capture: null,
          server_received_at: iso(report.createdAt),
          reporter_id: `report-${String(report._id).slice(-6)}`,
          metadata_stripped: Boolean(report.imageSanitized),
        },
        duplicate_analysis: {
          status: duplicateStatus,
          duplicate_count: report.duplicateCount ?? (report.duplicateEvidence ? 1 : 0),
          closest_duplicate_distance: report.duplicateDistance ?? null,
          duplicate_of: report.duplicateOf ? evidenceLabel(report.duplicateOf) : null,
          first_seen_at: iso(report.createdAt),
        },
        time_consistency: {
          reported_at: iso(report.createdAt),
          captured_at: report.exifDatetime ?? null,
          difference_seconds: time.differenceSeconds,
          status: report.captureTimeStatus ?? time.status,
          note: time.note,
        },
        location_consistency: {
          reported_coordinates: report.latitude !== undefined,
          evidence_coordinates: Boolean(report.hasExifGps),
          distance_meters: report.exifGpsDistanceMeters ?? null,
          status: report.gpsStatus ?? "unavailable",
        },
        content_consistency: {
          reported_claim: report.description,
          visual_summary: report.visionAnalysis ?? null,
          score: report.visualMatchConfidence ?? null,
          status: report.visualMatch ?? "unavailable",
          reason: report.visualMatchReason ?? null,
        },
        authenticity: report.authenticityClassification ? {
          classification: report.authenticityClassification,
          confidence: report.authenticityConfidence ?? null,
          reason: report.authenticityReason ?? null,
        } : null,
        status: evidenceStatus(report),
        support_contribution: points.get(report._id) ?? 0,
        review_state: report.reviewState ?? "unreviewed",
        timeline,
      };
    }));
  },
});

export const review = mutation({
  args: { id: v.id("reports"), reviewState },
  handler: async (ctx, args) => {
    const report = await ctx.db.get(args.id);
    if (!report?.imageStorageId) throw new ConvexError("Evidence not found");
    if (report.reviewState !== args.reviewState) {
      await ctx.db.patch(args.id, { reviewState: args.reviewState, reviewedAt: Date.now() });
    }
  },
});
