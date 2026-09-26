import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("incidents")
      .withIndex("by_created_at")
      .order("desc")
      .collect();
  },
});

export const get = query({
  args: {
    id: v.id("incidents"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const create = mutation({
  args: {
    title: v.string(),
    category: v.string(),
    location: v.string(),
    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),
  },

  handler: async (ctx, args) => {
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

      createdAt: Date.now(),
    });

    return incidentId;
  },
});
