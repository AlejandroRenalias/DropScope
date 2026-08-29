export interface CandidateRankingInput {
  candidateId: string;
  eligible: boolean;
  customerProblemEvidenceScore: number;
  evidenceQualityScore: number;
  trendDurabilityScore: number;
  advertisingSaturationScore: number;
  operationalRiskScore: number;
  failureRiskScore: number;
}

export interface RankedCandidate extends CandidateRankingInput {
  researchPriorityScore: number;
}

const scores = (input: CandidateRankingInput) => [
  input.customerProblemEvidenceScore,
  input.evidenceQualityScore,
  input.trendDurabilityScore,
  input.advertisingSaturationScore,
  input.operationalRiskScore,
  input.failureRiskScore,
];

function assertScores(input: CandidateRankingInput): void {
  if (!input.candidateId) throw new Error("Candidate ID is required.");
  if (typeof input.eligible !== "boolean") throw new Error("Candidate eligibility must be a boolean.");
  if (scores(input).some((score) => !Number.isInteger(score) || score < 0 || score > 100)) throw new Error("Candidate scores must be integers from 0 through 100.");
}

export function calculateResearchPriority(input: CandidateRankingInput): number {
  assertScores(input);
  return Math.round(
    input.customerProblemEvidenceScore * 0.30
    + input.evidenceQualityScore * 0.20
    + input.trendDurabilityScore * 0.15
    + (100 - input.advertisingSaturationScore) * 0.15
    + (100 - input.operationalRiskScore) * 0.10
    + (100 - input.failureRiskScore) * 0.10,
  );
}

export function rankEligibleCandidates(inputs: CandidateRankingInput[]): RankedCandidate[] {
  return inputs
    .map((input) => ({ ...input, researchPriorityScore: calculateResearchPriority(input) }))
    .filter((candidate) => candidate.eligible)
    .sort((left, right) => right.researchPriorityScore - left.researchPriorityScore
      || right.evidenceQualityScore - left.evidenceQualityScore
      || (left.candidateId < right.candidateId ? -1 : left.candidateId > right.candidateId ? 1 : 0));
}
