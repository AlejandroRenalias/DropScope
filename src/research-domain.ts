import { z } from "zod";

const idSchema = z.string().min(1);
const scoreSchema = z.number().int().min(0).max(100);

export const candidateSchema = z.object({
  candidateId: idSchema,
  name: z.string().min(1),
  category: z.string().min(1),
});
export type Candidate = z.infer<typeof candidateSchema>;

export const sourceSchema = z.object({
  sourceId: idSchema,
  sourceType: z.enum(["MARKETPLACE_LISTING", "CUSTOMER_REVIEW", "TREND_SIGNAL", "AD_LIBRARY", "SUPPLIER_CATALOG", "POLICY_REFERENCE"]),
  title: z.string().min(1),
  canonicalLocation: z.string().min(1),
  publisherOrOrigin: z.string().min(1),
  observedAt: z.string().datetime(),
  capturedAt: z.string().datetime(),
  geography: z.string().min(1).nullable(),
  fixtureAnnotation: z.record(z.string(), z.unknown()).nullable(),
});
export type Source = z.infer<typeof sourceSchema>;

export const claimSchema = z.object({
  claimId: idSchema,
  candidateId: idSchema,
  claimTopic: z.string().min(1),
  text: z.string().min(1),
  decisive: z.boolean(),
  tentative: z.boolean(),
  confidenceClass: z.enum(["LOW", "MEDIUM", "HIGH"]),
  evidenceIds: z.array(idSchema),
  status: z.enum(["PROPOSED", "AUDITED", "CHALLENGED", "ACCEPTED", "REJECTED", "UNRESOLVED"]),
});
export type Claim = z.infer<typeof claimSchema>;

export const evidenceSchema = z.object({
  evidenceId: idSchema,
  sourceId: idSchema,
  independenceGroupId: idSchema,
  factId: idSchema,
  candidateId: idSchema,
  claimId: idSchema,
  claimTopic: z.string().min(1),
  content: z.string().min(1),
  sourceType: z.string().min(1),
  geography: z.string().min(1).nullable(),
  observedAt: z.string().datetime(),
  capturedAt: z.string().datetime(),
  reliabilityClass: z.enum(["HIGH", "MEDIUM", "LOW", "UNKNOWN"]),
  direction: z.enum(["SUPPORTS", "OPPOSES", "NEUTRAL"]),
  strength: z.number().int().min(-5).max(5),
  fixtureAnnotation: z.record(z.string(), z.unknown()).nullable(),
}).superRefine((evidence, context) => {
  const validStrength = (evidence.direction === "SUPPORTS" && evidence.strength > 0)
    || (evidence.direction === "OPPOSES" && evidence.strength < 0)
    || (evidence.direction === "NEUTRAL" && evidence.strength === 0);
  if (!validStrength) {
    context.addIssue({ code: "custom", message: "Evidence direction must match the sign of its strength.", path: ["strength"] });
  }
});
export type Evidence = z.infer<typeof evidenceSchema>;

export const riskGateDecisionSchema = z.object({
  decisionId: idSchema,
  candidateId: idSchema,
  outcome: z.enum(["ALLOWED", "RESTRICTED", "MANUAL_REVIEW", "REJECTED"]),
  reasons: z.array(z.object({
    category: z.enum(["SAFETY", "REGULATORY", "INTELLECTUAL_PROPERTY", "POLICY", "INSUFFICIENT_INFORMATION"]),
    code: idSchema,
    explanation: z.string().min(1),
    evidenceIds: z.array(idSchema),
  })),
  decidedByPolicyVersion: z.string().min(1),
});
export type RiskGateDecision = z.infer<typeof riskGateDecisionSchema>;

const uniqueIds = <T extends object>(records: T[], field: keyof T, label: string, context: z.RefinementCtx) => {
  const seen = new Set<string>();
  records.forEach((record, index) => {
    const id = record[field] as string;
    if (seen.has(id)) context.addIssue({ code: "custom", message: `Duplicate ${label}: ${id}.`, path: [label, index, field as string] });
    seen.add(id);
  });
};

export const researchDatasetSchema = z.object({
  candidates: z.array(candidateSchema),
  sources: z.array(sourceSchema),
  claims: z.array(claimSchema),
  evidence: z.array(evidenceSchema),
}).superRefine((dataset, context) => {
  uniqueIds(dataset.candidates, "candidateId", "candidates", context);
  uniqueIds(dataset.sources, "sourceId", "sources", context);
  uniqueIds(dataset.claims, "claimId", "claims", context);
  uniqueIds(dataset.evidence, "evidenceId", "evidence", context);

  const candidateIds = new Set(dataset.candidates.map(({ candidateId }) => candidateId));
  const sourceIds = new Set(dataset.sources.map(({ sourceId }) => sourceId));
  const claims = new Map(dataset.claims.map((claim) => [claim.claimId, claim]));
  const evidenceIds = new Set(dataset.evidence.map(({ evidenceId }) => evidenceId));

  dataset.claims.forEach((claim, index) => {
    if (!candidateIds.has(claim.candidateId)) context.addIssue({ code: "custom", message: `Claim references unknown candidate: ${claim.candidateId}.`, path: ["claims", index, "candidateId"] });
    claim.evidenceIds.forEach((evidenceId, evidenceIndex) => {
      if (!evidenceIds.has(evidenceId)) context.addIssue({ code: "custom", message: `Claim references unknown evidence: ${evidenceId}.`, path: ["claims", index, "evidenceIds", evidenceIndex] });
    });
  });
  dataset.evidence.forEach((evidence, index) => {
    const claim = claims.get(evidence.claimId);
    if (!candidateIds.has(evidence.candidateId)) context.addIssue({ code: "custom", message: `Evidence references unknown candidate: ${evidence.candidateId}.`, path: ["evidence", index, "candidateId"] });
    if (!sourceIds.has(evidence.sourceId)) context.addIssue({ code: "custom", message: `Evidence references unknown source: ${evidence.sourceId}.`, path: ["evidence", index, "sourceId"] });
    if (!claim) context.addIssue({ code: "custom", message: `Evidence references unknown claim: ${evidence.claimId}.`, path: ["evidence", index, "claimId"] });
    else if (claim.candidateId !== evidence.candidateId || claim.claimTopic !== evidence.claimTopic) context.addIssue({ code: "custom", message: "Evidence must reference a claim for the same candidate and topic.", path: ["evidence", index] });
  });
});
export type ResearchDataset = z.infer<typeof researchDatasetSchema>;

export const evidenceQualityScoreSchema = scoreSchema;

const strictObject = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict();

const blindReviewAssessmentSchema = strictObject({
  anonymizedCandidateId: idSchema,
  reviewerScore: scoreSchema,
  reviewerEligible: z.boolean(),
  confidenceClass: z.enum(["LOW", "MEDIUM", "HIGH"]),
  dimensionScores: strictObject({
    sourceIndependence: scoreSchema,
    decisionCriticalCoverage: scoreSchema,
    contradictionHandling: scoreSchema,
    claimEvidenceAlignment: scoreSchema,
    uncertaintyCalibration: scoreSchema,
  }),
  blockingDefects: z.array(z.string()),
  missingResearchKeys: z.array(z.string()),
});

export const blindReviewResultSchema = strictObject({
  reviewId: idSchema,
  candidateAssessments: z.array(blindReviewAssessmentSchema),
  ranking: z.array(idSchema),
  verdict: z.enum(["ACCEPT", "REVISE", "REASSIGN", "REJECT"]),
}).superRefine((result, context) => {
  const assessmentIds = result.candidateAssessments.map((item) => item.anonymizedCandidateId);
  if (new Set(assessmentIds).size !== assessmentIds.length) context.addIssue({ code: "custom", message: "Blind-review assessments must have unique candidate IDs." });
  if (new Set(result.ranking).size !== result.ranking.length) context.addIssue({ code: "custom", message: "Blind-review ranking IDs must be unique." });
});
export type BlindReviewResult = z.infer<typeof blindReviewResultSchema>;

export const divergenceRecordSchema = strictObject({
  divergenceId: idSchema,
  type: z.enum([
    "ELIGIBILITY_DIVERGENCE",
    "TOP_CANDIDATE_DIVERGENCE",
    "RANK_POSITION_DIVERGENCE",
    "CONFIDENCE_DIVERGENCE",
    "MISSING_EVIDENCE_DIVERGENCE",
  ]),
  candidateIds: z.array(idSchema),
  researchKey: idSchema.nullable(),
  blocking: z.boolean(),
  status: z.enum(["OPEN", "RESOLVED", "UNRESOLVED_ACCEPTED"]),
  resolutionNote: z.string().nullable(),
});
export type DivergenceRecord = z.infer<typeof divergenceRecordSchema>;
