import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

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

    const reportId = await ctx.db.insert("reports", {
      incidentId,
      reporterToken: args.reporterToken,
      description: args.description,
      category: args.category,
      location: args.location,
      latitude: args.latitude,
      longitude: args.longitude,
      imageStorageId: args.imageStorageId,
      duplicateEvidence: false,
      semanticSimilarity: 0,
      createdAt,
    });

    return { incidentId, reportId };
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
