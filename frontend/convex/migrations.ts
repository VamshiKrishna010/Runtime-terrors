// One-off maintenance for data written before the privacy/scoring fixes.
// Run once per deployment, e.g.:
//   npx convex run migrations:scrubLegacyPrivacy '{"deleteUnsanitizedImages": true}'
//   npx convex run migrations:rescoreAll
// Both are internal: they cannot be called from the browser.
import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { rescoreIncident } from "./lib/rescore";

/**
 * Clears raw EXIF GPS from old reports. Old images were stored with their
 * metadata intact; they are already withheld from every public query, and
 * with deleteUnsanitizedImages they are removed from storage too.
 */
export const scrubLegacyPrivacy = internalMutation({
  args: { deleteUnsanitizedImages: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const reports = await ctx.db.query("reports").collect();
    const results = await Promise.all(reports.map(async (report) => {
      const patch: Record<string, unknown> = {};
      let gpsCleared = 0;
      let imagesDeleted = 0;
      if (report.exifGps !== undefined) {
        patch.exifGps = undefined;
        patch.hasExifGps = true;
        gpsCleared = 1;
      }
      if (args.deleteUnsanitizedImages && report.imageStorageId && !report.imageSanitized) {
        await ctx.storage.delete(report.imageStorageId);
        patch.imageStorageId = undefined;
        imagesDeleted = 1;
      }
      if (Object.keys(patch).length) await ctx.db.patch(report._id, patch);
      return { gpsCleared, imagesDeleted };
    }));
    return results.reduce((totals, result) => ({
      gpsCleared: totals.gpsCleared + result.gpsCleared,
      imagesDeleted: totals.imagesDeleted + result.imagesDeleted,
    }), { gpsCleared: 0, imagesDeleted: 0 });
  },
});

/** Recomputes every incident's score and report count with the server-side scorer. */
export const rescoreAll = internalMutation({
  args: {},
  handler: async (ctx) => {
    const incidents = await ctx.db.query("incidents").collect();
    await Promise.all(incidents.map((incident) => rescoreIncident(ctx, incident._id)));
    return { rescored: incidents.length };
  },
});
