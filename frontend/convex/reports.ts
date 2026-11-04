import { action, internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import {
  CLUSTER_SIMILARITY_THRESHOLD,
  CLUSTER_WINDOW_MS,
  EMBEDDING_DIMENSION,
  PHASH_DUPLICATE_DISTANCE,
  captureTimeConsistency,
  cosineSimilarity,
  gpsConsistency,
  hammingDistance,
  normalizeLocation,
} from "./lib/evidence";
import { rescoreIncident } from "./lib/rescore";
import { UnsupportedImageError, stripImageMetadata } from "./lib/stripMetadata";

export const CATEGORIES = ["Network / IT", "Facilities", "Environmental", "Safety", "Other"];
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const TOKEN_PATTERN = /^[A-Za-z0-9-]{16,64}$/;
const REPORTS_PER_TOKEN_WINDOW = { count: 5, ms: 10 * 60 * 1000 };

// Measurements the browser takes from the original file before upload. They
// are review signals only; every score input is still derived server-side.
const imageMeasurements = v.object({
  phash: v.optional(v.string()),
  width: v.optional(v.number()),
  height: v.optional(v.number()),
  exifDatetime: v.optional(v.string()),
  exifGps: v.optional(v.object({ latitude: v.number(), longitude: v.number() })),
  cameraDevice: v.optional(v.string()),
  editingSoftware: v.optional(v.string()),
});

const visionResult = v.object({
  summary: v.optional(v.string()),
  authenticity: v.optional(v.object({
    classification: v.union(v.literal("likely_real"), v.literal("uncertain"), v.literal("suspicious")),
    confidence: v.number(),
    reason: v.string(),
  })),
  visualComparison: v.optional(v.object({
    match: v.union(v.literal("yes"), v.literal("partial"), v.literal("no"), v.literal("unavailable")),
    confidence: v.number(),
    reason: v.string(),
  })),
});

const submitArgs = {
  reporterToken: v.string(),
  description: v.string(),
  category: v.string(),
  location: v.string(),
  latitude: v.optional(v.number()),
  longitude: v.optional(v.number()),
  embedding: v.array(v.number()),
  imageStorageId: v.optional(v.id("_storage")),
  image: v.optional(imageMeasurements),
  vision: v.optional(visionResult),
};

const fail = (message: string): never => { throw new ConvexError(message); };
const clip = (value: string | undefined, max: number) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
};
const unit = (value: number) => (Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0);

type ImageMeasurements = {
  phash?: string;
  width?: number;
  height?: number;
  exifDatetime?: string;
  exifGps?: { latitude: number; longitude: number };
  cameraDevice?: string;
  editingSoftware?: string;
};
type VisionData = {
  summary?: string;
  authenticity?: { classification: "likely_real" | "uncertain" | "suspicious"; confidence: number; reason: string };
  visualComparison?: { match: "yes" | "partial" | "no" | "unavailable"; confidence: number; reason: string };
};
type StoredImage = { storageId: Id<"_storage">; mimeType: string; fileSize: number; sha256: string };
type InsertArgs = {
  reporterToken: string;
  description: string;
  category: string;
  location: string;
  latitude?: number;
  longitude?: number;
  embedding: number[];
  imageStorageId?: Id<"_storage">;
  image?: ImageMeasurements;
  vision?: VisionData;
  storedImage?: StoredImage;
};
type NormalizedReport = { reporterToken: string; description: string; location: string; embedding: number[] };
type DuplicateResult = { of?: Id<"reports">; distance?: number; count: number; phash?: string };

function normalizeReport(args: InsertArgs): NormalizedReport {
  const reporterToken = args.reporterToken.trim();
  const description = args.description.trim();
  const location = args.location.trim().replace(/\s+/g, " ");
  if (!TOKEN_PATTERN.test(reporterToken)) fail("Invalid reporter token. Reload the page and try again.");
  if (description.length < 10 || description.length > 4000) fail("Descriptions must be 10 to 4,000 characters.");
  if (!location || location.length > 300) fail("Locations must be 1 to 300 characters.");
  if (!CATEGORIES.includes(args.category)) fail("Unsupported category.");
  if ((args.latitude === undefined) !== (args.longitude === undefined)) fail("Provide both latitude and longitude.");
  if (args.latitude !== undefined && (Math.abs(args.latitude) > 90 || Math.abs(args.longitude!) > 180)) fail("Invalid coordinates.");
  if (args.embedding.length !== EMBEDDING_DIMENSION || !args.embedding.every(Number.isFinite)) fail("Invalid description embedding.");
  const magnitude = Math.sqrt(args.embedding.reduce((sum, value) => sum + value * value, 0));
  if (!magnitude) fail("Invalid description embedding.");
  return { reporterToken, description, location, embedding: args.embedding.map((value) => value / magnitude) };
}

async function enforceReportLimit(ctx: MutationCtx, reporterToken: string, createdAt: number) {
  const recent = await ctx.db
    .query("reports")
    .withIndex("by_reporter", (query) => query.eq("reporterToken", reporterToken).gt("createdAt", createdAt - REPORTS_PER_TOKEN_WINDOW.ms))
    .take(REPORTS_PER_TOKEN_WINDOW.count);
  if (recent.length >= REPORTS_PER_TOKEN_WINDOW.count) fail("Too many reports from this device. Please wait a few minutes.");
}

async function bestCluster(ctx: MutationCtx, args: InsertArgs, normalized: NormalizedReport, createdAt: number) {
  const candidates = await ctx.db
    .query("reports")
    .withIndex("by_created_at", (query) => query.gte("createdAt", createdAt - CLUSTER_WINDOW_MS))
    .collect();
  let incidentId: Id<"incidents"> | undefined;
  let semanticSimilarity = 0;
  const locationKey = normalizeLocation(normalized.location);
  for (const report of candidates) {
    if (!report.embedding || report.category !== args.category || normalizeLocation(report.location) !== locationKey) continue;
    const similarity = cosineSimilarity(normalized.embedding, report.embedding);
    if (similarity >= CLUSTER_SIMILARITY_THRESHOLD && similarity > semanticSimilarity) {
      incidentId = report.incidentId;
      semanticSimilarity = similarity;
    }
  }
  return { incidentId, semanticSimilarity };
}

async function resolveIncident(ctx: MutationCtx, args: InsertArgs, normalized: NormalizedReport, createdAt: number, candidate?: Id<"incidents">) {
  if (!candidate) {
    const incidentId = await ctx.db.insert("incidents", {
      title: `${args.category}: ${normalized.description.slice(0, 72)}`,
      category: args.category,
      location: normalized.location,
      latitude: args.latitude,
      longitude: args.longitude,
      supportScore: 0,
      evidenceLevel: "Low",
      confirmations: 0,
      contradictions: 0,
      reportCount: 0,
      createdAt,
    });
    return { incidentId, clustered: false };
  }
  if (args.latitude !== undefined) {
    const incident = await ctx.db.get(candidate);
    if (incident?.latitude === undefined) await ctx.db.patch(candidate, { latitude: args.latitude, longitude: args.longitude });
  }
  return { incidentId: candidate, clustered: true };
}

async function duplicateFor(ctx: MutationCtx, storedImage?: StoredImage, measurements?: ImageMeasurements): Promise<DuplicateResult> {
  if (!storedImage) return { count: 0 };
  const exact = await ctx.db.query("reports").withIndex("by_sha256", (query) => query.eq("imageSha256", storedImage.sha256)).collect();
  const phash = measurements?.phash && /^[0-9a-f]{16}$/i.test(measurements.phash) ? measurements.phash.toLowerCase() : undefined;
  const hashed = phash
    ? await ctx.db.query("reports").withIndex("by_phash", (query) => query.gte("imagePhash", "")).collect()
    : [];
  const matches = new Map<Id<"reports">, { report: Doc<"reports">; distance: number }>();
  for (const report of exact) matches.set(report._id, { report, distance: 0 });
  for (const report of hashed) {
    const distance = hammingDistance(phash, report.imagePhash);
    if (distance !== null && distance <= PHASH_DUPLICATE_DISTANCE && !matches.has(report._id)) {
      matches.set(report._id, { report, distance });
    }
  }
  const values = [...matches.values()];
  values.sort((a, b) => a.report.createdAt - b.report.createdAt);
  const earliest = values[0];
  return {
    of: earliest?.report._id,
    distance: earliest ? Math.min(...values.map((match) => match.distance)) : undefined,
    count: matches.size,
    phash,
  };
}

function validGps(image?: ImageMeasurements) {
  const gps = image?.exifGps;
  if (!gps || Math.abs(gps.latitude) > 90 || Math.abs(gps.longitude) > 180) return undefined;
  return gps;
}

function storedImageFields(storedImage: StoredImage | undefined, image: ImageMeasurements | undefined, duplicate: DuplicateResult, createdAt: number, gps: ReturnType<typeof validGps>, gpsCheck: ReturnType<typeof gpsConsistency>, exifDatetime?: string) {
  if (!storedImage) return {};
  return {
    imageStorageId: storedImage.storageId,
    imageSanitized: true,
    imageMimeType: storedImage.mimeType,
    imageFileSize: storedImage.fileSize,
    imageSha256: storedImage.sha256,
    imagePhash: duplicate.phash,
    imageWidth: Number.isInteger(image?.width) ? image!.width : undefined,
    imageHeight: Number.isInteger(image?.height) ? image!.height : undefined,
    exifDatetime,
    hasExifGps: Boolean(gps),
    exifGpsDistanceMeters: gpsCheck.distanceMeters,
    cameraDevice: clip(image?.cameraDevice, 200),
    editingSoftware: clip(image?.editingSoftware, 200),
    captureTimeStatus: captureTimeConsistency(createdAt, exifDatetime).status,
    gpsStatus: gpsCheck.status,
    duplicateOf: duplicate.of,
    duplicateDistance: duplicate.distance,
    duplicateCount: duplicate.count,
    reviewState: "unreviewed" as const,
  };
}

/** Short-lived URL the browser uploads the original photo to. */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => await ctx.storage.generateUploadUrl(),
});

/**
 * Public entry point for a report. The uploaded original is replaced with a
 * metadata-stripped copy before anything can serve it, then the report is
 * clustered and the incident rescored atomically on the server.
 */
export const submit = action({
  args: submitArgs,
  handler: async (ctx, args): Promise<{ incidentId: Id<"incidents">; reportId: Id<"reports">; clustered: boolean }> => {
    let storedImage: { storageId: Id<"_storage">; mimeType: string; fileSize: number; sha256: string } | undefined;

    if (args.imageStorageId) {
      const original = await ctx.storage.get(args.imageStorageId);
      if (!original) fail("The uploaded photo could not be found. Please try again.");
      try {
        if (original!.size > MAX_IMAGE_BYTES) fail("Photos must be 10 MB or smaller.");
        const { bytes, mimeType } = stripImageMetadata(new Uint8Array(await original!.arrayBuffer()));
        const digest = await crypto.subtle.digest("SHA-256", bytes);
        const sha256 = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
        const storageId = await ctx.storage.store(new Blob([bytes], { type: mimeType }));
        storedImage = { storageId, mimeType, fileSize: bytes.length, sha256 };
      } catch (error) {
        if (error instanceof UnsupportedImageError) fail(error.message);
        throw error;
      } finally {
        // The original (with EXIF) never outlives this action.
        await ctx.storage.delete(args.imageStorageId);
      }
    }

    const { imageStorageId: _original, ...report } = args;
    try {
      return await ctx.runMutation(internal.reports.insertClustered, {
        ...report,
        ...(storedImage && { storedImage }),
      });
    } catch (error) {
      if (storedImage) await ctx.storage.delete(storedImage.storageId);
      throw error;
    }
  },
});

export const insertClustered = internalMutation({
  args: {
    ...submitArgs,
    storedImage: v.optional(v.object({
      storageId: v.id("_storage"),
      mimeType: v.string(),
      fileSize: v.number(),
      sha256: v.string(),
    })),
  },
  handler: async (ctx, args) => {
    const createdAt = Date.now();
    const normalized = normalizeReport(args);
    await enforceReportLimit(ctx, normalized.reporterToken, createdAt);
    const candidate = await bestCluster(ctx, args, normalized, createdAt);
    const { incidentId, clustered } = await resolveIncident(ctx, args, normalized, createdAt, candidate.incidentId);
    const image = args.storedImage ? args.image : undefined;
    const duplicate = await duplicateFor(ctx, args.storedImage, image);
    const gps = validGps(image);
    const gpsCheck = gpsConsistency(args, gps);
    const exifDatetime = clip(image?.exifDatetime, 40);
    const vision = args.storedImage ? args.vision : undefined;

    const reportId = await ctx.db.insert("reports", {
      incidentId,
      reporterToken: normalized.reporterToken,
      description: normalized.description,
      category: args.category,
      location: normalized.location,
      latitude: args.latitude,
      longitude: args.longitude,
      ...storedImageFields(args.storedImage, image, duplicate, createdAt, gps, gpsCheck, exifDatetime),
      duplicateEvidence: Boolean(duplicate.of),
      visionAnalysis: clip(vision?.summary, 2000),
      authenticityClassification: vision?.authenticity?.classification,
      authenticityConfidence: vision?.authenticity ? unit(vision.authenticity.confidence) : undefined,
      authenticityReason: clip(vision?.authenticity?.reason, 1000),
      visualMatch: vision?.visualComparison?.match,
      visualMatchConfidence: vision?.visualComparison ? unit(vision.visualComparison.confidence) : undefined,
      visualMatchReason: clip(vision?.visualComparison?.reason, 1000),
      semanticSimilarity: unit(candidate.semanticSimilarity),
      embedding: normalized.embedding,
      createdAt,
    });

    await rescoreIncident(ctx, incidentId);
    return { incidentId, reportId, clustered };
  },
});

/**
 * Public, privacy-safe view of an incident's reports. Never exposes reporter
 * tokens, embeddings or EXIF fields, and never serves an unsanitised image.
 */
export const byIncident = query({
  args: { incidentId: v.id("incidents") },
  handler: async (ctx, args) => {
    const reports = await ctx.db
      .query("reports")
      .withIndex("by_incident", (q) => q.eq("incidentId", args.incidentId))
      .collect();
    return await Promise.all(reports.map(async (report) => ({
      _id: report._id,
      createdAt: report.createdAt,
      description: report.description,
      duplicateEvidence: report.duplicateEvidence,
      visualMatch: report.visualMatch,
      imageUrl: report.imageStorageId && report.imageSanitized ? await ctx.storage.getUrl(report.imageStorageId) : null,
      imageWithheld: Boolean(report.imageStorageId && !report.imageSanitized),
    })));
  },
});
