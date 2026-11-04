export type VisualMatch = "yes" | "partial" | "no" | "unavailable";

export type ScoreInput = {
  distinct_reporters: number;
  semantic_agreement: number;
  confirmations?: number;
  contradictions?: number;
  unique_images?: number;
  duplicate_images?: number;
  metadata_conflicts?: number;
  time_proximity?: number | null;
  visual_match?: VisualMatch;
};

export const WEIGHTS = {
  reporter: 12,
  reporterCap: 36,
  semantic: 30,
  confirmation: 5,
  confirmationCap: 20,
  image: 4,
  imageCap: 12,
  duplicate: 12,
  duplicateCap: 36,
  metadata: 8,
  metadataCap: 24,
  contradiction: 7,
  contradictionCap: 28,
  time: 10,
  visual: { yes: 8, partial: 4, no: -4, unavailable: 0 } satisfies Record<VisualMatch, number>,
  strongAt: 65,
  emergingAt: 35,
} as const;

const count = (value: number | undefined) => Math.max(0, Math.trunc(Number.isFinite(value) ? value! : 0));
const unit = (value: number | null | undefined) => Number.isFinite(value) ? Math.max(0, Math.min(1, value!)) : 0;
const plural = (value: number, noun: string) => `${value} ${noun}${value === 1 ? "" : "s"}`;

export function scoreEvidence(input: ScoreInput) {
  const reporters = count(input.distinct_reporters);
  const confirmationsCount = count(input.confirmations);
  const contradictionsCount = count(input.contradictions);
  const uniqueCount = count(input.unique_images);
  const duplicateCount = count(input.duplicate_images);
  const conflictCount = count(input.metadata_conflicts);
  const agreement = unit(input.semantic_agreement);
  const visualMatch: VisualMatch = input.visual_match && input.visual_match in WEIGHTS.visual
    ? input.visual_match
    : "unavailable";

  const diversity = Math.min(reporters * WEIGHTS.reporter, WEIGHTS.reporterCap);
  const semantic = Math.round(agreement * WEIGHTS.semantic);
  const confirmations = Math.min(confirmationsCount * WEIGHTS.confirmation, WEIGHTS.confirmationCap);
  const images = Math.min(uniqueCount * WEIGHTS.image, WEIGHTS.imageCap);
  const duplicates = Math.min(duplicateCount * WEIGHTS.duplicate, WEIGHTS.duplicateCap);
  const metadata = Math.min(conflictCount * WEIGHTS.metadata, WEIGHTS.metadataCap);
  const contradictions = Math.min(contradictionsCount * WEIGHTS.contradiction, WEIGHTS.contradictionCap);
  const timing = Math.round(unit(input.time_proximity) * WEIGHTS.time);
  const visual = WEIGHTS.visual[visualMatch];
  const supportScore = Math.max(0, Math.min(100,
    diversity + semantic + confirmations + images + timing + visual - duplicates - metadata - contradictions));

  const reasons = [
    `${plural(reporters, "distinct reporter token")} (+${diversity})`,
    `Semantic agreement ${Math.round(agreement * 100)}% (+${semantic})`,
  ];
  if (timing) reasons.push(`Corroborating reports within 30 minutes (+${timing})`);
  if (confirmationsCount) reasons.push(`${plural(confirmationsCount, "community confirmation")} (+${confirmations})`);
  if (uniqueCount) reasons.push(`${plural(uniqueCount, "unique image")} (+${images})`);
  if (visual) reasons.push(`Visual match ${visualMatch} (${visual > 0 ? "+" : ""}${visual})`);
  if (duplicates) reasons.push(`${plural(duplicateCount, "reused image")} (-${duplicates})`);
  if (metadata) reasons.push(`${plural(conflictCount, "metadata conflict")} (-${metadata})`);
  if (contradictions) reasons.push(`${plural(contradictionsCount, "community contradiction")} (-${contradictions})`);

  let evidenceLevel = "Low";
  if (supportScore >= WEIGHTS.strongAt) evidenceLevel = "Strong";
  else if (supportScore >= WEIGHTS.emergingAt) evidenceLevel = "Emerging";
  return {
    support_score: supportScore,
    evidence_level: evidenceLevel,
    reasons,
  };
}
