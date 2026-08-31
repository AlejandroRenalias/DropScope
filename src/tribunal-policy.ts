import { z } from "zod";

const id = z.string().min(1);
const direction = z.enum(["SUPPORTS", "OPPOSES", "NEUTRAL"]);
const reliability = z.enum(["HIGH", "MEDIUM", "LOW", "UNKNOWN"]);

const riskReason = z.object({ code: id, evidenceIds: z.array(id) }).strict();
const riskDecision = z.object({
  decisionId: id,
  candidateId: id,
  outcome: z.enum(["ALLOWED", "RESTRICTED", "MANUAL_REVIEW", "REJECTED"]),
  reasons: z.array(riskReason),
}).strict();
const claimProjection = z.object({ claimId: id, candidateId: id, decisive: z.boolean(), tentative: z.boolean() }).strict();
const evidenceProjection = z.object({
  evidenceId: id, candidateId: id, claimId: id, independenceGroupId: id,
  direction, reliabilityClass: reliability, strength: z.number().int().min(-5).max(5),
}).strict().superRefine((e, ctx) => {
  const valid = (e.direction === "SUPPORTS" && e.strength > 0)
    || (e.direction === "OPPOSES" && e.strength < 0)
    || (e.direction === "NEUTRAL" && e.strength === 0);
  if (!valid) ctx.addIssue({ code: "custom", message: "Evidence direction must match the sign of its strength.", path: ["strength"] });
});

export const tribunalProjectionSchema = z.object({
  tribunalId: id, candidateId: id, policyVersion: id,
  riskDecision, claims: z.array(claimProjection), evidence: z.array(evidenceProjection),
}).strict().superRefine((input, ctx) => {
  const unique = (values: string[], path: string) => { const seen = new Set<string>(); values.forEach((v, i) => { if (seen.has(v)) ctx.addIssue({ code: "custom", message: `Duplicate ${path}: ${v}.`, path: [path, i] }); seen.add(v); }); };
  unique(input.claims.map(c => c.claimId), "claims");
  unique(input.evidence.map(e => e.evidenceId), "evidence");
  if (input.riskDecision.candidateId !== input.candidateId) ctx.addIssue({ code: "custom", message: "Risk decision belongs to a different candidate.", path: ["riskDecision", "candidateId"] });
  const claimIds = new Set(input.claims.map(c => c.claimId));
  input.claims.forEach((c, i) => { if (c.candidateId !== input.candidateId) ctx.addIssue({ code: "custom", message: "Claim belongs to a different candidate.", path: ["claims", i, "candidateId"] }); });
  input.evidence.forEach((e, i) => {
    if (e.candidateId !== input.candidateId) ctx.addIssue({ code: "custom", message: "Evidence belongs to a different candidate.", path: ["evidence", i, "candidateId"] });
    if (!claimIds.has(e.claimId)) ctx.addIssue({ code: "custom", message: `Evidence references unknown claim: ${e.claimId}.`, path: ["evidence", i, "claimId"] });
  });
  unique(input.riskDecision.reasons.map(r => r.code), "riskReasons");
  input.riskDecision.reasons.forEach((r, i) => unique(r.evidenceIds, `riskReasons.${i}.evidenceIds`));
});
export type TribunalProjection = z.infer<typeof tribunalProjectionSchema>;

export type TribunalRecommendation = "CONTINUE_RESEARCH" | "CAUTION" | "STOP";
export const tribunalReasonSchema = z.object({
  code: id,
  explanation: z.string().min(1),
  claimIds: z.array(id),
  evidenceIds: z.array(id),
  riskDecisionId: id.nullable(),
  riskReasonCodes: z.array(id),
}).strict();
export const tribunalResultSchema = z.object({
  tribunalId: id,
  candidateId: id,
  recommendation: z.enum(["CONTINUE_RESEARCH", "CAUTION", "STOP"]),
  ventureClaimIds: z.array(id),
  ruinClaimIds: z.array(id),
  reasons: z.array(tribunalReasonSchema),
  decidedByPolicyVersion: id,
}).strict();
export type TribunalReason = z.infer<typeof tribunalReasonSchema>;
export type TribunalResult = z.infer<typeof tribunalResultSchema>;

const weights = { HIGH: 1, MEDIUM: 0.7, LOW: 0.4, UNKNOWN: 0 } as const;
const cmp = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const sortedUnique = (values: string[]) => [...new Set(values)].sort(cmp);
const weighted = (e: TribunalProjection["evidence"][number]) => e.strength * weights[e.reliabilityClass];

function representatives(items: TribunalProjection["evidence"]) {
  const groups = new Map<string, typeof items>();
  for (const item of items) groups.set(item.independenceGroupId, [...(groups.get(item.independenceGroupId) ?? []), item]);
  return [...groups.values()].map(group => [...group].sort((a, b) => {
    const magnitude = Math.abs(weighted(b)) - Math.abs(weighted(a));
    if (magnitude) return magnitude;
    if (a.direction === "OPPOSES" && b.direction !== "OPPOSES") return -1;
    if (b.direction === "OPPOSES" && a.direction !== "OPPOSES") return 1;
    return cmp(a.evidenceId, b.evidenceId);
  })[0]);
}

const explanations: Record<string, string> = {
  TRIBUNAL_RISK_GATE_REJECTED: "The prior conservative research filter excludes the candidate.",
  TRIBUNAL_MATERIAL_CONFLICT: "Material contrary evidence remains visible to the research decision.",
  TRIBUNAL_RISK_GATE_LIMITATION: "The gate leaves the candidate unresolved and separately reported; it cannot enter the main ranking.",
  TRIBUNAL_UNCALIBRATED_SINGLE_GROUP_SUPPORT: "A decisive pro case has insufficient independent support without a tentative label.",
  TRIBUNAL_NO_SUPPORTED_DECISIVE_CASE: "No decisive claim has unopposed, contributing supporting evidence.",
  TRIBUNAL_SUPPORTED_DECISIVE_CASE: "At least one decisive claim has unopposed, contributing supporting evidence.",
};
const rank: Record<string, number> = { TRIBUNAL_RISK_GATE_REJECTED: 1, TRIBUNAL_MATERIAL_CONFLICT: 2, TRIBUNAL_RISK_GATE_LIMITATION: 3, TRIBUNAL_UNCALIBRATED_SINGLE_GROUP_SUPPORT: 5, TRIBUNAL_NO_SUPPORTED_DECISIVE_CASE: 6, TRIBUNAL_SUPPORTED_DECISIVE_CASE: 7 };

export function evaluateTribunal(input: TribunalProjection): TribunalResult {
  const p = tribunalProjectionSchema.parse(input);
  if (p.policyVersion.length === 0) throw new Error("Policy version must be non-empty.");
  const byClaim = new Map<string, ReturnType<typeof representatives>>();
  for (const claim of p.claims) byClaim.set(claim.claimId, representatives(p.evidence.filter(e => e.claimId === claim.claimId && e.reliabilityClass !== "UNKNOWN")));
  const facts = p.claims.map(claim => {
    const reps = byClaim.get(claim.claimId)!;
    const supports = reps.filter(e => e.direction === "SUPPORTS");
    const opposes = reps.filter(e => e.direction === "OPPOSES");
    // A supported decisive claim remains the Venture case even when contrary
    // evidence also exists; the conflict separately downgrades the recommendation.
    return { claim, reps, supports, opposes, venture: claim.decisive && supports.length > 0, conflict: claim.decisive && supports.length > 0 && opposes.length > 0, single: claim.decisive && !claim.tentative && supports.length === 1 };
  });
  const venture = facts.filter(f => f.venture);
  const ruin = facts.filter(f => f.claim.decisive && (f.opposes.length > 0 || f.conflict || f.single));
  const orderClaims = (items: typeof facts, side: "venture" | "ruin") => items.sort((a, b) => {
    const ar = side === "venture" ? a.supports : (a.opposes.length ? a.opposes : a.supports);
    const br = side === "venture" ? b.supports : (b.opposes.length ? b.opposes : b.supports);
    return br.length - ar.length || (br.reduce((s, e) => s + Math.abs(weighted(e)), 0) - ar.reduce((s, e) => s + Math.abs(weighted(e)), 0)) || cmp(a.claim.claimId, b.claim.claimId);
  });
  const reasons: TribunalReason[] = [];
  const add = (code: string, claimIds: string[], evidenceIds: string[], risk = false) => reasons.push({ code, explanation: explanations[code], claimIds: sortedUnique(claimIds), evidenceIds: sortedUnique(evidenceIds), riskDecisionId: risk ? p.riskDecision.decisionId : null, riskReasonCodes: risk ? p.riskDecision.reasons.map(r => r.code) : [] });
  const riskEvidence = sortedUnique(p.riskDecision.reasons.flatMap(r => r.evidenceIds));
  if (p.riskDecision.outcome === "REJECTED") add("TRIBUNAL_RISK_GATE_REJECTED", [], riskEvidence, true);
  if (facts.some(f => f.conflict)) add("TRIBUNAL_MATERIAL_CONFLICT", facts.filter(f => f.conflict).map(f => f.claim.claimId), facts.filter(f => f.conflict).flatMap(f => [...f.supports, ...f.opposes].map(e => e.evidenceId)));
  if (["MANUAL_REVIEW", "RESTRICTED"].includes(p.riskDecision.outcome)) add("TRIBUNAL_RISK_GATE_LIMITATION", [], riskEvidence, true);
  if (facts.some(f => f.single)) add("TRIBUNAL_UNCALIBRATED_SINGLE_GROUP_SUPPORT", facts.filter(f => f.single).map(f => f.claim.claimId), facts.filter(f => f.single).flatMap(f => f.supports.map(e => e.evidenceId)));
  if (!venture.length) add("TRIBUNAL_NO_SUPPORTED_DECISIVE_CASE", [], []);
  if (venture.length) add("TRIBUNAL_SUPPORTED_DECISIVE_CASE", venture.map(f => f.claim.claimId), venture.flatMap(f => f.supports.map(e => e.evidenceId)));
  reasons.sort((a, b) => rank[a.code] - rank[b.code] || cmp(a.code, b.code));
  const recommendation: TribunalRecommendation = p.riskDecision.outcome === "REJECTED" ? "STOP" : reasons.some(r => r.code !== "TRIBUNAL_SUPPORTED_DECISIVE_CASE") ? "CAUTION" : "CONTINUE_RESEARCH";
  return tribunalResultSchema.parse({ tribunalId: p.tribunalId, candidateId: p.candidateId, recommendation, ventureClaimIds: orderClaims(venture, "venture").slice(0, 3).map(f => f.claim.claimId), ruinClaimIds: orderClaims(ruin, "ruin").slice(0, 3).map(f => f.claim.claimId), reasons, decidedByPolicyVersion: p.policyVersion });
}

export const evaluateTribunalPolicy = evaluateTribunal;
