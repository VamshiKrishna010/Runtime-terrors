import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { scoreInputFor } from "./evidence";
import { scoreEvidence } from "./scoring";

export async function rescoreIncident(ctx: MutationCtx, incidentId: Id<"incidents">) {
  const incident = await ctx.db.get(incidentId);
  if (!incident) return;
  const reports = await ctx.db
    .query("reports")
    .withIndex("by_incident", (query) => query.eq("incidentId", incidentId))
    .collect();
  const score = scoreEvidence(scoreInputFor(incident, reports));
  await ctx.db.patch(incidentId, {
    supportScore: score.support_score,
    evidenceLevel: score.evidence_level,
    reasons: score.reasons,
    reportCount: reports.length,
    updatedAt: Date.now(),
  });
}
