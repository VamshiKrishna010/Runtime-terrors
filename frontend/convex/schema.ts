import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const consistencyStatus = v.union(
  v.literal("consistent"),
  v.literal("needs_review"),
  v.literal("conflicting"),
  v.literal("unavailable"),
);

export const reviewState = v.union(v.literal("unreviewed"), v.literal("reviewed"), v.literal("flagged"));

export default defineSchema({
  incidents: defineTable({
    // Legacy field from the retired SQLite sync; no longer written.
    sqliteIncidentId: v.optional(v.number()),
    title: v.string(),
    category: v.string(),
    location: v.string(),

    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),

    // Written only by the server-side scorer (lib/rescore.ts).
    supportScore: v.number(),
    evidenceLevel: v.string(),
    reasons: v.optional(v.array(v.string())),

    confirmations: v.number(),
    contradictions: v.number(),
    // Denormalised so incidents.list needs no per-incident report query.
    reportCount: v.optional(v.number()),
    updatedAt: v.optional(v.number()),

    createdAt: v.number(),
  })
    .index("by_created_at", ["createdAt"]),

  reports: defineTable({
    incidentId: v.id("incidents"),

    // Random per-device pseudonym. Never returned by a public query.
    reporterToken: v.string(),
    description: v.string(),
    category: v.string(),
    location: v.string(),

    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),

    // Convex Storage. Only images with imageSanitized === true are ever served;
    // older uploads were stored with their EXIF intact and are withheld.
    imageStorageId: v.optional(v.id("_storage")),
    imageSanitized: v.optional(v.boolean()),
    imageMimeType: v.optional(v.string()),
    imageFileSize: v.optional(v.number()),
    imageWidth: v.optional(v.number()),
    imageHeight: v.optional(v.number()),
    imageSha256: v.optional(v.string()),
    imagePhash: v.optional(v.string()),

    // Metadata read from the original file before it was stripped. Raw EXIF
    // GPS is never stored: only whether it existed and its distance from the
    // reported coordinates.
    exifDatetime: v.optional(v.string()),
    exifGps: v.optional(v.string()), // legacy; cleared by migrations:scrubLegacyPrivacy
    hasExifGps: v.optional(v.boolean()),
    exifGpsDistanceMeters: v.optional(v.number()),
    cameraDevice: v.optional(v.string()),
    editingSoftware: v.optional(v.string()),
    captureTimeStatus: v.optional(consistencyStatus),
    gpsStatus: v.optional(consistencyStatus),

    duplicateEvidence: v.boolean(),
    duplicateOf: v.optional(v.id("reports")),
    duplicateDistance: v.optional(v.number()),
    duplicateCount: v.optional(v.number()),

    // Vision model results (optional; the analysis service may be offline).
    visionAnalysis: v.optional(v.string()),
    authenticityClassification: v.optional(v.string()),
    authenticityConfidence: v.optional(v.number()),
    authenticityReason: v.optional(v.string()),
    visualMatch: v.optional(v.string()),
    visualMatchConfidence: v.optional(v.number()),
    visualMatchReason: v.optional(v.string()),

    semanticSimilarity: v.number(),
    embedding: v.optional(v.array(v.number())),

    reviewState: v.optional(reviewState),
    reviewedAt: v.optional(v.number()),

    createdAt: v.number(),
  })
    .index("by_incident", ["incidentId"])
    .index("by_reporter", ["reporterToken", "createdAt"])
    .index("by_created_at", ["createdAt"])
    .index("by_phash", ["imagePhash"])
    .index("by_sha256", ["imageSha256"]),

  // One current vote per device token per incident.
  votes: defineTable({
    incidentId: v.id("incidents"),
    voterToken: v.string(),
    action: v.union(v.literal("confirm"), v.literal("contradict")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_incident_voter", ["incidentId", "voterToken"])
    .index("by_voter", ["voterToken", "updatedAt"]),
});
