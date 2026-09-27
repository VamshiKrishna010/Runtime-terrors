import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

// Generate a URL the frontend can use to upload a photo
// directly into Convex Storage.
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

// Create a report after its image has been uploaded.
export const create = mutation({
  args: {
    incidentId: v.id("incidents"),
    reporterToken: v.string(),
    description: v.string(),
    category: v.string(),
    location: v.string(),

    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),

    imageStorageId: v.optional(v.id("_storage")),

    imagePhash: v.optional(v.string()),
    exifDatetime: v.optional(v.string()),
    exifGps: v.optional(v.string()),

    duplicateEvidence: v.boolean(),
    visionAnalysis: v.optional(v.string()),
    semanticSimilarity: v.number(),
  },

  handler: async (ctx, args) => {
    return await ctx.db.insert("reports", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

// Inserts the public incident and the reporter's evidence together, so a failed
// report never leaves an empty incident in the feed.
export const createWithIncident = mutation({
  args: {
    title: v.string(),
    reporterToken: v.string(),
    description: v.string(),
    category: v.string(),
    location: v.string(),
    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),
    imageStorageId: v.optional(v.id("_storage")),
    imagePhash: v.optional(v.string()),
    exifDatetime: v.optional(v.string()),
    exifGps: v.optional(v.string()),
    visionAnalysis: v.optional(v.string()),
    authenticityClassification: v.optional(v.string()),
    authenticityConfidence: v.optional(v.number()),
    authenticityReason: v.optional(v.string()),
    visualMatch: v.optional(v.string()),
    visualMatchConfidence: v.optional(v.number()),
    visualMatchReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const createdAt = Date.now();
    const incidentId = await ctx.db.insert("incidents", {
      title: args.title,
      category: args.category,
      location: args.location,
      latitude: args.latitude,
      longitude: args.longitude,
      supportScore: 0,
      evidenceLevel: "Low",
      confirmations: 0,
      contradictions: 0,
      createdAt,
    });

    let duplicateEvidence = false;

    if (args.imagePhash) {
      const existingReports = await ctx.db.query("reports").collect();
      duplicateEvidence = existingReports.some(
        (report) => report.imagePhash === args.imagePhash
      );
    }

    const reportId = await ctx.db.insert("reports", {
      incidentId,
      reporterToken: args.reporterToken,
      description: args.description,
      category: args.category,
      location: args.location,
      latitude: args.latitude,
      longitude: args.longitude,
      imageStorageId: args.imageStorageId,
      imagePhash: args.imagePhash,
      exifDatetime: args.exifDatetime,
      exifGps: args.exifGps,
      visionAnalysis: args.visionAnalysis,
      authenticityClassification: args.authenticityClassification,
      authenticityConfidence: args.authenticityConfidence,
      authenticityReason: args.authenticityReason,
      visualMatch: args.visualMatch,
      visualMatchConfidence: args.visualMatchConfidence,
      visualMatchReason: args.visualMatchReason,
      duplicateEvidence,
      semanticSimilarity: 0,
      createdAt,
    });

    return { incidentId, reportId };
  },
});

function cosineSimilarity(left: number[], right: number[]) {
  if (left.length !== right.length || left.length === 0) return 0;
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftMagnitude += left[index] * left[index];
    rightMagnitude += right[index] * right[index];
  }
  return leftMagnitude && rightMagnitude ? dot / Math.sqrt(leftMagnitude * rightMagnitude) : 0;
}

const CLUSTER_WINDOW_MS = 2 * 60 * 60 * 1000;
const CLUSTER_SIMILARITY_THRESHOLD = 0.32;

// The browser obtains a normalized MiniLM vector, then this mutation finds the
// best recent same-location candidate and atomically adds the report to it.
export const createClustered = mutation({
  args: {
    title: v.string(),
    reporterToken: v.string(),
    description: v.string(),
    category: v.string(),
    location: v.string(),
    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),
    imageStorageId: v.optional(v.id("_storage")),
    imagePhash: v.optional(v.string()),
    exifDatetime: v.optional(v.string()),
    exifGps: v.optional(v.string()),
    visionAnalysis: v.optional(v.string()),
    embedding: v.array(v.number()),
  },
  handler: async (ctx, args) => {
    const createdAt = Date.now();
    const reports = await ctx.db.query("reports").collect();
    const location = args.location.trim().toLocaleLowerCase();
    let incidentId: Id<"incidents"> | undefined;
    let semanticSimilarity = 0;

    for (const report of reports) {
      if (!report.embedding || report.category !== args.category || report.location.trim().toLocaleLowerCase() !== location) continue;
      if (createdAt - report.createdAt > CLUSTER_WINDOW_MS) continue;
      const similarity = cosineSimilarity(args.embedding, report.embedding);
      if (similarity >= CLUSTER_SIMILARITY_THRESHOLD && similarity > semanticSimilarity) {
        incidentId = report.incidentId;
        semanticSimilarity = similarity;
      }
    }

    if (!incidentId) {
      incidentId = await ctx.db.insert("incidents", {
        title: args.title,
        category: args.category,
        location: args.location,
        latitude: args.latitude,
        longitude: args.longitude,
        supportScore: 0,
        evidenceLevel: "Low",
        confirmations: 0,
        contradictions: 0,
        createdAt,
      });
    }

    const duplicateEvidence = Boolean(args.imagePhash && reports.some((report) => report.imagePhash === args.imagePhash));
    const reportId = await ctx.db.insert("reports", {
      incidentId,
      reporterToken: args.reporterToken,
      description: args.description,
      category: args.category,
      location: args.location,
      latitude: args.latitude,
      longitude: args.longitude,
      imageStorageId: args.imageStorageId,
      imagePhash: args.imagePhash,
      exifDatetime: args.exifDatetime,
      exifGps: args.exifGps,
      visionAnalysis: args.visionAnalysis,
      duplicateEvidence,
      semanticSimilarity,
      embedding: args.embedding,
      createdAt,
    });

    const incident = await ctx.db.get(incidentId);
    if (!incident) throw new Error("Incident was not created");
    const clusteredReports = reports.filter((report) => report.incidentId === incidentId).map((report) => ({
      reporterToken: report.reporterToken,
      semanticSimilarity: report.semanticSimilarity,
      imageStorageId: report.imageStorageId,
      duplicateEvidence: report.duplicateEvidence,
      createdAt: report.createdAt,
      location: report.location,
    }));
    clusteredReports.push({
      reporterToken: args.reporterToken,
      semanticSimilarity,
      imageStorageId: args.imageStorageId,
      duplicateEvidence,
      createdAt,
      location: args.location,
    });
    const similarities = clusteredReports.map((report) => report.semanticSimilarity).filter((value) => value > 0);
    const recentReports = clusteredReports.filter((report) => createdAt - report.createdAt <= 30 * 60 * 1000).length;
    const sameLocationReports = clusteredReports.filter((report) => report.location === undefined || report.location.trim().toLocaleLowerCase() === location).length;

    return {
      incidentId,
      reportId,
      clustered: semanticSimilarity >= CLUSTER_SIMILARITY_THRESHOLD,
      semanticSimilarity,
      scoreInput: {
        distinct_reporters: new Set(clusteredReports.map((report) => report.reporterToken)).size,
        semantic_agreement: similarities.length ? similarities.reduce((sum, value) => sum + value, 0) / similarities.length : 0,
        confirmations: incident.confirmations,
        contradictions: incident.contradictions,
        unique_images: clusteredReports.filter((report) => report.imageStorageId && !report.duplicateEvidence).length,
        duplicate_images: clusteredReports.filter((report) => report.duplicateEvidence).length,
        metadata_conflicts: 0,
        location_consistency: clusteredReports.length ? sameLocationReports / clusteredReports.length : 0,
        time_proximity: Math.min(1, recentReports / 3),
        visual_match: "unavailable" as const,
      },
    };
  },
});

// Get all reports belonging to one incident.
export const byIncident = query({
  args: {
    incidentId: v.id("incidents"),
  },

  handler: async (ctx, args) => {
    const reports = await ctx.db
      .query("reports")
      .withIndex("by_incident", (q) =>
        q.eq("incidentId", args.incidentId)
      )
      .collect();

    return await Promise.all(
      reports.map(async (report) => ({
        ...report,
        imageUrl: report.imageStorageId
          ? await ctx.storage.getUrl(report.imageStorageId)
          : null,
      }))
    );
  },
});
