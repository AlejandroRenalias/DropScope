/** Frozen, commander-independent calculations from reviewer-rubric.yaml. */

export type ReviewerDimension =
  | "sourceIndependence"
  | "decisionCriticalCoverage"
  | "contradictionHandling"
  | "claimEvidenceAlignment"
  | "uncertaintyCalibration";

export interface BlindReviewClaim {
  claimId: string;
  candidateId: string;
  decisive: boolean;
  audited?: boolean;
  tentative?: boolean;
  /** Set this when the caller has identified that this claim needs uncertainty labeling. */
  requiresUncertaintyLabel?: boolean;
  /** Set this when the caller has audited the claim's uncertainty label. */
  uncertaintyLabelCorrect?: boolean;
}

export interface BlindReviewEvidence {
  evidenceId: string;
  claimId: string;
  candidateId: string;
  independenceGroupId: string;
  direction: "SUPPORTS" | "OPPOSES" | "NEUTRAL";
}

export interface BlindReviewInput {
  anonymizedCandidateId: string;
  claims: BlindReviewClaim[];
  evidence: BlindReviewEvidence[];
  requiredResearchKeys?: string[];
  coveredResearchKeys?: string[];
  unresolvedMaterialContradictionCount?: number;
}

export interface BlindReviewDimensionScores {
  sourceIndependence: number;
  decisionCriticalCoverage: number;
  contradictionHandling: number;
  claimEvidenceAlignment: number;
  uncertaintyCalibration: number;
}

export interface BlindReviewCalculation {
  anonymizedCandidateId: string;
  dimensionScores: BlindReviewDimensionScores;
  reviewerScore: number;
  blockingDefects: string[];
  missingResearchKeys: string[];
  reviewerEligible: boolean;
  confidenceClass: "LOW" | "MEDIUM" | "HIGH";
  verdict: "ACCEPT" | "REVISE" | "REASSIGN" | "REJECT";
  reasonCodes: ReviewerReasonCode[];
}

export type ReviewerReasonCode =
  | "REVIEW_BLOCKING_DEFECTS_PRESENT"
  | "REVIEW_MISSING_RESEARCH_KEYS"
  | "REVIEW_SCORE_BELOW_MINIMUM"
  | "REVIEW_SCORE_ACCEPTABLE"
  | "REVIEW_SCORE_HIGH";

export interface ReviewerDecision {
  reviewerEligible: boolean;
  confidenceClass: "LOW" | "MEDIUM" | "HIGH";
  verdict: "ACCEPT" | "REVISE" | "REASSIGN" | "REJECT";
  reasonCodes: ReviewerReasonCode[];
}

const weights: Record<ReviewerDimension, number> = {
  sourceIndependence: 30,
  decisionCriticalCoverage: 25,
  contradictionHandling: 20,
  claimEvidenceAlignment: 15,
  uncertaintyCalibration: 10,
};

const round = (value: number) => Math.round(value);

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function validate(input: BlindReviewInput): void {
  if (!input.anonymizedCandidateId) throw new Error("Anonymized candidate ID is required.");
  const contradictionCount = input.unresolvedMaterialContradictionCount ?? 0;
  if (!Number.isInteger(contradictionCount) || contradictionCount < 0) {
    throw new Error("Unresolved material contradiction count must be a non-negative integer.");
  }
}

function evidenceForClaim(claim: BlindReviewClaim, evidence: BlindReviewEvidence[]): BlindReviewEvidence[] {
  return evidence.filter((item) => item.claimId === claim.claimId && item.candidateId === claim.candidateId && isValidEvidence(item));
}

function isValidEvidence(item: BlindReviewEvidence): boolean {
  return Boolean(item.evidenceId && item.claimId && item.candidateId && item.independenceGroupId)
    && (item.direction === "SUPPORTS" || item.direction === "OPPOSES" || item.direction === "NEUTRAL");
}

export function calculateBlindReviewDimensions(input: BlindReviewInput): BlindReviewDimensionScores {
  validate(input);
  const decisive = input.claims.filter((claim) => claim.decisive);
  const sourceIndependence = decisive.length === 0 ? 0 : round(decisive.reduce((total, claim) => {
    const groups = new Set(evidenceForClaim(claim, input.evidence).map(({ independenceGroupId }) => independenceGroupId));
    return total + Math.min(groups.size / 2, 1);
  }, 0) / decisive.length * 100);

  const required = unique(input.requiredResearchKeys ?? []);
  const covered = new Set(input.coveredResearchKeys ?? []);
  const decisionCriticalCoverage = required.length === 0 ? 0 : round(required.filter((key) => covered.has(key)).length / required.length * 100);
  const contradictionCount = input.unresolvedMaterialContradictionCount ?? 0;
  const contradictionHandling = Math.max(0, 100 - contradictionCount * 50);
  const claimEvidenceAlignment = decisive.length === 0 ? 0 : round(decisive.filter((claim) => {
    const evidence = evidenceForClaim(claim, input.evidence);
    return claim.audited === true && evidence.some(({ direction }) => direction !== "NEUTRAL");
  }).length / decisive.length * 100);
  const requiringLabels = decisive.filter((claim) => claim.requiresUncertaintyLabel === true);
  const uncertaintyCalibration = requiringLabels.length === 0 ? 100 : round(requiringLabels.filter((claim) => claim.uncertaintyLabelCorrect === true).length / requiringLabels.length * 100);

  return { sourceIndependence, decisionCriticalCoverage, contradictionHandling, claimEvidenceAlignment, uncertaintyCalibration };
}

export function calculateReviewerScore(scores: BlindReviewDimensionScores): number {
  return round((scores.sourceIndependence * weights.sourceIndependence
    + scores.decisionCriticalCoverage * weights.decisionCriticalCoverage
    + scores.contradictionHandling * weights.contradictionHandling
    + scores.claimEvidenceAlignment * weights.claimEvidenceAlignment
    + scores.uncertaintyCalibration * weights.uncertaintyCalibration) / 100);
}

export function collectMissingResearchKeys(input: BlindReviewInput): string[] {
  const covered = new Set(input.coveredResearchKeys ?? []);
  return unique((input.requiredResearchKeys ?? []).filter((key) => !covered.has(key))).sort();
}

export function collectBlockingDefects(input: BlindReviewInput): string[] {
  validate(input);
  const decisive = input.claims.filter((claim) => claim.decisive);
  const defects = new Set<string>();
  if (decisive.some((claim) => evidenceForClaim(claim, input.evidence).length === 0)) defects.add("decisive_claim_has_no_valid_evidence");
  if (decisive.some((claim) => {
    const groups = new Set(evidenceForClaim(claim, input.evidence).map(({ independenceGroupId }) => independenceGroupId));
    return groups.size === 1 && claim.tentative !== true;
  })) defects.add("decisive_single_group_claim_is_not_tentative");
  if ((input.unresolvedMaterialContradictionCount ?? 0) > 0) defects.add("unresolved_decision_critical_contradiction");
  const traceableClaims = new Set(input.claims.map((claim) => `${claim.claimId}\u0000${claim.candidateId}`));
  if (input.evidence.some((item) => !isValidEvidence(item) || !traceableClaims.has(`${item.claimId}\u0000${item.candidateId}`))) defects.add("malformed_or_untraceable_evidence");
  return [...defects];
}

/** Maps only the calculated reviewer result; it makes no product, legal, or tribunal determination. */
export function mapReviewerDecision(input: Pick<BlindReviewCalculation, "reviewerScore" | "blockingDefects" | "missingResearchKeys">): ReviewerDecision {
  if (input.blockingDefects.length > 0) {
    return { reviewerEligible: false, confidenceClass: "LOW", verdict: "REJECT", reasonCodes: ["REVIEW_BLOCKING_DEFECTS_PRESENT"] };
  }
  if (input.missingResearchKeys.length > 0) {
    return { reviewerEligible: false, confidenceClass: "LOW", verdict: "REASSIGN", reasonCodes: ["REVIEW_MISSING_RESEARCH_KEYS"] };
  }
  if (input.reviewerScore < 75) {
    return { reviewerEligible: false, confidenceClass: "MEDIUM", verdict: "REVISE", reasonCodes: ["REVIEW_SCORE_BELOW_MINIMUM"] };
  }
  if (input.reviewerScore < 90) {
    return { reviewerEligible: true, confidenceClass: "MEDIUM", verdict: "ACCEPT", reasonCodes: ["REVIEW_SCORE_ACCEPTABLE"] };
  }
  return { reviewerEligible: true, confidenceClass: "HIGH", verdict: "ACCEPT", reasonCodes: ["REVIEW_SCORE_HIGH"] };
}

export function calculateBlindReview(input: BlindReviewInput): BlindReviewCalculation {
  const dimensionScores = calculateBlindReviewDimensions(input);
  const hasDecisiveClaims = input.claims.some((claim) => claim.decisive);
  const reviewerScore = hasDecisiveClaims ? calculateReviewerScore(dimensionScores) : 0;
  const blockingDefects = collectBlockingDefects(input);
  const missingResearchKeys = collectMissingResearchKeys(input);
  const decision = mapReviewerDecision({ reviewerScore, blockingDefects, missingResearchKeys });
  return {
    anonymizedCandidateId: input.anonymizedCandidateId,
    dimensionScores,
    reviewerScore,
    blockingDefects,
    missingResearchKeys,
    ...decision,
  };
}

export function rankBlindReviews(reviews: BlindReviewCalculation[]): BlindReviewCalculation[] {
  return [...reviews].sort((left, right) => right.reviewerScore - left.reviewerScore
    || right.dimensionScores.sourceIndependence - left.dimensionScores.sourceIndependence
    || (left.anonymizedCandidateId < right.anonymizedCandidateId ? -1 : left.anonymizedCandidateId > right.anonymizedCandidateId ? 1 : 0));
}
