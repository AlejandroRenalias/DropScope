import { reliabilityWeight, selectEvidenceRepresentatives } from "./evidence-scoring.js";
import type { Claim, Evidence, ResearchDataset } from "./research-domain.js";

export interface EvidenceQualityScore {
  score: number;
  independenceScore: number;
  reliabilityScore: number;
  decisiveClaimCoverageScore: number;
  contradictionResolutionScore: number;
}

const round = (value: number) => Math.round(value);

function evidenceForClaim(claim: Claim, evidence: Evidence[]): Evidence[] {
  return evidence.filter((item) => item.claimId === claim.claimId
    && item.candidateId === claim.candidateId
    && item.claimTopic === claim.claimTopic
    && claim.evidenceIds.includes(item.evidenceId));
}

export function scoreEvidenceQuality(dataset: ResearchDataset, options: { unresolvedMaterialContradictionCount?: number } = {}): EvidenceQualityScore {
  const contradictionCount = options.unresolvedMaterialContradictionCount ?? 0;
  if (!Number.isInteger(contradictionCount) || contradictionCount < 0) throw new Error("Unresolved material contradiction count must be a non-negative integer.");

  const decisiveClaims = dataset.claims.filter((claim) => claim.decisive);
  if (decisiveClaims.length === 0) {
    return { score: 0, independenceScore: 0, reliabilityScore: 0, decisiveClaimCoverageScore: 0, contradictionResolutionScore: 0 };
  }

  const representativesByClaim = decisiveClaims.map((claim) => selectEvidenceRepresentatives(evidenceForClaim(claim, dataset.evidence)));
  const independenceScore = round(representativesByClaim.reduce((total, representatives) => total + Math.min(representatives.length / 2, 1), 0) / decisiveClaims.length * 100);
  const representatives = representativesByClaim.flat();
  const reliabilityScore = representatives.length === 0
    ? 0
    : round(representatives.reduce((total, evidence) => total + reliabilityWeight[evidence.reliabilityClass], 0) / representatives.length * 100);
  const decisiveClaimCoverageScore = round(representativesByClaim.filter((representatives) => representatives.length > 0).length / decisiveClaims.length * 100);
  const contradictionResolutionScore = Math.max(0, 100 - contradictionCount * 50);
  const score = round(independenceScore * 0.3 + reliabilityScore * 0.25 + decisiveClaimCoverageScore * 0.25 + contradictionResolutionScore * 0.2);

  return { score, independenceScore, reliabilityScore, decisiveClaimCoverageScore, contradictionResolutionScore };
}
