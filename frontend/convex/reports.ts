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

// Get all reports belonging to one incident.
export const byIncident = query({
  args: {
    incidentId: v.id("incidents"),
  },

  handler: async (ctx, args) => {
    return await ctx.db
      .query("reports")
      .withIndex("by_incident", (q) =>
        q.eq("incidentId", args.incidentId)
      )
      .collect();
  },
});
