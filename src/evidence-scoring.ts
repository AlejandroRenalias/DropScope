import type { Claim, Evidence, ResearchDataset } from "./research-domain.js";

// Mirrors docs/policies/evidence-policy.yaml version 1. Changes require a superseding ADR.
export const reliabilityWeight = {
  HIGH: 1,
  MEDIUM: 0.7,
  LOW: 0.4,
  UNKNOWN: 0,
} as const;

export interface EvidenceScore {
  claimId: string;
  representativeEvidenceIds: string[];
  independentGroupCount: number;
  netStrength: number;
  score: number;
  requiresTentativeLabel: boolean;
}

const weightedStrength = (evidence: Evidence) => evidence.strength * reliabilityWeight[evidence.reliabilityClass];

function compareRepresentative(left: Evidence, right: Evidence): number {
  const magnitudeDifference = Math.abs(weightedStrength(right)) - Math.abs(weightedStrength(left));
  if (magnitudeDifference !== 0) return magnitudeDifference;
  if (left.direction === "OPPOSES" && right.direction !== "OPPOSES") return -1;
  if (right.direction === "OPPOSES" && left.direction !== "OPPOSES") return 1;
  return left.evidenceId.localeCompare(right.evidenceId);
}

export function selectEvidenceRepresentatives(evidence: Evidence[]): Evidence[] {
  const groups = new Map<string, Evidence[]>();
  for (const item of evidence) groups.set(item.independenceGroupId, [...(groups.get(item.independenceGroupId) ?? []), item]);
  return [...groups.values()].map((group) => [...group].sort(compareRepresentative)[0]).sort((left, right) => left.evidenceId.localeCompare(right.evidenceId));
}

export function scoreClaimEvidence(claim: Claim, evidence: Evidence[]): EvidenceScore {
  const relevantEvidence = evidence.filter((item) => item.candidateId === claim.candidateId && item.claimTopic === claim.claimTopic);
  const representatives = selectEvidenceRepresentatives(relevantEvidence);
  const netStrength = Math.max(-10, Math.min(10, representatives.reduce((total, item) => total + weightedStrength(item), 0)));
  const hasUnknownSupport = representatives.some((item) => item.direction === "SUPPORTS" && item.reliabilityClass === "UNKNOWN");

  return {
    claimId: claim.claimId,
    representativeEvidenceIds: representatives.map((item) => item.evidenceId),
    independentGroupCount: representatives.length,
    netStrength,
    score: Math.round((netStrength + 10) * 5),
    requiresTentativeLabel: claim.decisive && (representatives.length < 2 || hasUnknownSupport),
  };
}

export function scoreDatasetClaim(dataset: ResearchDataset, claimId: string): EvidenceScore {
  const claim = dataset.claims.find((item) => item.claimId === claimId);
  if (!claim) throw new Error(`Unknown claim: ${claimId}.`);
  return scoreClaimEvidence(claim, dataset.evidence);
}
