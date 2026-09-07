import { rankEligibleCandidates, type RankedCandidate } from "./candidate-ranking.js";
import type { CandidateEligibility } from "./candidate-eligibility.js";
import type { FixtureCandidateEvaluation } from "./fixture-model.js";
import type { RiskGateDecision } from "./research-domain.js";

export interface HeldOutCandidate {
  candidateId: string;
  outcome: RiskGateDecision["outcome"];
  reasonCodes: string[];
}

export interface CandidateReport {
  outcome: "RANKED" | "INSUFFICIENT_EVIDENCE";
  ranking: RankedCandidate[];
  heldOut: HeldOutCandidate[];
}

function assertUniqueIds(label: string, ids: string[]): void {
  if (new Set(ids).size !== ids.length) throw new Error(`${label} must contain unique candidate IDs.`);
}

function assertSameCandidateIds(evaluations: FixtureCandidateEvaluation[], riskDecisions: RiskGateDecision[], eligibilities: CandidateEligibility[]): void {
  const evaluationIds = evaluations.map(({ candidateId }) => candidateId);
  const decisionIds = riskDecisions.map(({ candidateId }) => candidateId);
  const eligibilityIds = eligibilities.map(({ candidateId }) => candidateId);
  assertUniqueIds("Fixture evaluations", evaluationIds);
  assertUniqueIds("Risk decisions", decisionIds);
  assertUniqueIds("Candidate eligibilities", eligibilityIds);
  const expected = new Set(evaluationIds);
  for (const [label, ids] of [["Risk decisions", decisionIds], ["Candidate eligibilities", eligibilityIds]] as const) {
    if (ids.length !== expected.size || ids.some((id) => !expected.has(id))) throw new Error(`${label} candidate IDs must match fixture evaluations.`);
  }
}

export function buildCandidateReport(
  evaluations: FixtureCandidateEvaluation[],
  riskDecisions: RiskGateDecision[],
  eligibilities: CandidateEligibility[],
): CandidateReport {
  assertSameCandidateIds(evaluations, riskDecisions, eligibilities);
  const byId = new Map(eligibilities.map((eligibility) => [eligibility.candidateId, eligibility]));
  const decisions = new Map(riskDecisions.map((decision) => [decision.candidateId, decision]));
  const rankingInputs = evaluations.map((candidate) => {
    const eligibility = byId.get(candidate.candidateId);
    if (!eligibility) throw new Error(`Missing eligibility for candidate ${candidate.candidateId}.`);
    return { ...candidate, eligible: eligibility.eligible };
  });
  const ranked = rankEligibleCandidates(rankingInputs);
  const ranking = ranked.slice(0, 5);
  const rankedIds = new Set(ranking.map((candidate) => candidate.candidateId));
  const heldOut = evaluations.flatMap((candidate) => {
    if (rankedIds.has(candidate.candidateId)) return [];
    const decision = decisions.get(candidate.candidateId);
    const eligibility = byId.get(candidate.candidateId);
    if (!decision || !eligibility) throw new Error(`Missing gate data for candidate ${candidate.candidateId}.`);
    const reasonCodes = [
      ...decision.reasons.map((reason) => reason.code),
      ...eligibility.blockers,
      ...(eligibility.eligible ? ["RANKING_CAP_EXCEEDED"] : []),
    ].filter((code, index, all) => all.indexOf(code) === index);
    return [{ candidateId: candidate.candidateId, outcome: decision.outcome, reasonCodes }];
  });
  return { outcome: ranking.length > 0 ? "RANKED" : "INSUFFICIENT_EVIDENCE", ranking, heldOut };
}
