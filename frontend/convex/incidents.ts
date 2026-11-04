import { mutation, query } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { rescoreIncident } from "./lib/rescore";

const TOKEN_PATTERN = /^[A-Za-z0-9-]{16,64}$/;
const VOTES_PER_TOKEN_MINUTE = 20;

export const list = query({
  args: {},
  handler: async (ctx) => {
    const incidents = await ctx.db
      .query("incidents")
      .withIndex("by_created_at")
      .order("desc")
      .collect();
    // reportCount is maintained by rescoreIncident; no per-incident queries.
    return incidents.map(({ sqliteIncidentId: _legacy, ...incident }) => ({
      ...incident,
      reportCount: incident.reportCount ?? 0,
    }));
  },
});

export const get = query({
  args: { id: v.id("incidents") },
  handler: async (ctx, args) => await ctx.db.get(args.id),
});

/**
 * One current vote per device token per incident. Repeating the same vote is a
 * no-op, switching reverses the earlier one, and the incident is rescored
 * immediately.
 */
export const vote = mutation({
  args: {
    id: v.id("incidents"),
    type: v.union(v.literal("confirm"), v.literal("contradict")),
    voterToken: v.string(),
  },
  handler: async (ctx, args) => {
    const voterToken = args.voterToken.trim();
    if (!TOKEN_PATTERN.test(voterToken)) throw new ConvexError("Invalid voter token. Reload the page and try again.");
    const incident = await ctx.db.get(args.id);
    if (!incident) throw new ConvexError("Incident not found");

    const now = Date.now();
    const recent = await ctx.db
      .query("votes")
      .withIndex("by_voter", (q) => q.eq("voterToken", voterToken).gt("updatedAt", now - 60_000))
      .take(VOTES_PER_TOKEN_MINUTE);
    if (recent.length >= VOTES_PER_TOKEN_MINUTE) throw new ConvexError("Too many votes from this device. Please wait a minute.");

    const previous = await ctx.db
      .query("votes")
      .withIndex("by_incident_voter", (q) => q.eq("incidentId", args.id).eq("voterToken", voterToken))
      .unique();
    if (previous?.action === args.type) return { changed: false };

    let { confirmations, contradictions } = incident;
    if (previous) {
      if (previous.action === "confirm") confirmations = Math.max(0, confirmations - 1);
      else contradictions = Math.max(0, contradictions - 1);
      await ctx.db.patch(previous._id, { action: args.type, updatedAt: now });
    } else {
      await ctx.db.insert("votes", { incidentId: args.id, voterToken, action: args.type, createdAt: now, updatedAt: now });
    }
    if (args.type === "confirm") confirmations += 1;
    else contradictions += 1;

    await ctx.db.patch(args.id, { confirmations, contradictions });
    await rescoreIncident(ctx, args.id);
    return { changed: true };
  },
});

/** The current device's votes, so the UI can show which button is active. */
export const myVotes = query({
  args: { voterToken: v.string() },
  handler: async (ctx, args) => {
    if (!TOKEN_PATTERN.test(args.voterToken)) return {};
    const votes = await ctx.db
      .query("votes")
      .withIndex("by_voter", (q) => q.eq("voterToken", args.voterToken))
      .collect();
    return Object.fromEntries(votes.map((vote) => [vote.incidentId, vote.action]));
  },
});
