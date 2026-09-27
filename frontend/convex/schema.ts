import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  incidents: defineTable({
    sqliteIncidentId: v.optional(v.number()),
    title: v.string(),
    category: v.string(),
    location: v.string(),

    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),

    supportScore: v.number(),
    evidenceLevel: v.string(),

    confirmations: v.number(),
    contradictions: v.number(),
    reasons: v.optional(v.array(v.string())),
    updatedAt: v.optional(v.number()),

    createdAt: v.number(),
})
  .index("by_created_at", ["createdAt"])
  .index("by_sqlite_id", ["sqliteIncidentId"]),

  reports: defineTable({
    incidentId: v.id("incidents"),

    reporterToken: v.string(),
    description: v.string(),
    category: v.string(),
    location: v.string(),

    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),

    // Convex Storage
    imageStorageId: v.optional(v.id("_storage")),

    // Evidence analysis
    imagePhash: v.optional(v.string()),
    exifDatetime: v.optional(v.string()),
    exifGps: v.optional(v.string()),
    duplicateEvidence: v.boolean(),

    // Groq Vision result
    visionAnalysis: v.optional(v.string()),

    // Qwen visual authenticity assessment
    authenticityClassification: v.optional(v.string()),
    authenticityConfidence: v.optional(v.number()),
    authenticityReason: v.optional(v.string()),

    // Image-to-report visual comparison
    visualMatch: v.optional(v.string()),
    visualMatchConfidence: v.optional(v.number()),
    visualMatchReason: v.optional(v.string()),

    semanticSimilarity: v.number(),
    embedding: v.optional(v.array(v.number())),

    createdAt: v.number(),
  })
    .index("by_incident", ["incidentId"])
    .index("by_reporter", ["reporterToken"])
    .index("by_created_at", ["createdAt"]),
});
