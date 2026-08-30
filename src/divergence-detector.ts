import type { BlindReviewResult, DivergenceRecord } from "./research-domain.js";

type ConfidenceClass = "LOW" | "MEDIUM" | "HIGH";
export interface CommanderAssessment {
  candidateId: string;
  eligible: boolean;
  confidenceClass: ConfidenceClass;
}

export interface CommanderSnapshot {
  candidateAssessments: CommanderAssessment[];
  ranking: string[];
  /** Tasks (or their research keys) which are currently active. */
  activeTasks?: Array<string | { researchKey: string }>;
  /** Tasks (or their research keys) which have completed. */
  completedTasks?: Array<string | { researchKey: string }>;
  /** An alternative concise representation of task coverage. */
  coveredResearchKeys?: string[];
}

export interface DivergenceDescriptor {
  type: DivergenceRecord["type"];
  candidateIds: string[];
  researchKey: string | null;
  blocking: boolean;
}

export interface DivergenceDetectorInput {
  commanderSnapshot: CommanderSnapshot;
  blindReview: BlindReviewResult;
  /** Caller-owned stable ID allocation. The detector never invents IDs. */
  divergenceIdFor: (descriptor: DivergenceDescriptor) => string;
}

const types: DivergenceRecord["type"][] = [
  "ELIGIBILITY_DIVERGENCE", "TOP_CANDIDATE_DIVERGENCE", "RANK_POSITION_DIVERGENCE",
  "CONFIDENCE_DIVERGENCE", "MISSING_EVIDENCE_DIVERGENCE",
];
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const lexical = (ids: Iterable<string>) => [...new Set(ids)].sort(compare);
const taskKey = (task: string | { researchKey: string }) => typeof task === "string" ? task : task.researchKey;

/** Compare commander output with an already-frozen blind review. No events, gaps, or tribunal data are read. */
export function detectDivergences(input: DivergenceDetectorInput): DivergenceRecord[] {
  const { commanderSnapshot: commander, blindReview: review, divergenceIdFor } = input;
  const commanderById = new Map(commander.candidateAssessments.map((item) => [item.candidateId, item]));
  const reviewerById = new Map(review.candidateAssessments.map((item) => [item.anonymizedCandidateId, item]));
  const descriptors: DivergenceDescriptor[] = [];
  const add = (type: DivergenceDescriptor["type"], candidateIds: Iterable<string>, blocking: boolean, researchKey: string | null = null) => {
    descriptors.push({ type, candidateIds: lexical(candidateIds), blocking, researchKey });
  };

  for (const candidateId of new Set([...commanderById.keys(), ...reviewerById.keys()])) {
    const c = commanderById.get(candidateId);
    const r = reviewerById.get(candidateId);
    if (c && r && c.eligible !== r.reviewerEligible) add("ELIGIBILITY_DIVERGENCE", [candidateId], true);
    if (c && r && c.confidenceClass !== r.confidenceClass) add("CONFIDENCE_DIVERGENCE", [candidateId], false);
  }

  const commanderTop = commander.ranking[0];
  const reviewerTop = review.ranking[0];
  if (commanderTop !== undefined && reviewerTop !== undefined && commanderTop !== reviewerTop) {
    add("TOP_CANDIDATE_DIVERGENCE", [commanderTop, reviewerTop], false);
  }

  const commanderPositions = new Map(commander.ranking.map((id, index) => [id, index]));
  const reviewerPositions = new Map(review.ranking.map((id, index) => [id, index]));
  for (const candidateId of new Set([...commanderPositions.keys(), ...reviewerPositions.keys()])) {
    const left = commanderPositions.get(candidateId);
    const right = reviewerPositions.get(candidateId);
    if (left !== undefined && right !== undefined && Math.abs(left - right) >= 2) add("RANK_POSITION_DIVERGENCE", [candidateId], false);
  }

  const covered = new Set([
    ...(commander.coveredResearchKeys ?? []),
    ...(commander.activeTasks ?? []).map(taskKey),
    ...(commander.completedTasks ?? []).map(taskKey),
  ]);
  const missingByKey = new Map<string, Set<string>>();
  for (const assessment of review.candidateAssessments) {
    for (const key of assessment.missingResearchKeys) {
      if (!covered.has(key)) {
        let candidates = missingByKey.get(key);
        if (!candidates) {
          candidates = new Set<string>();
          missingByKey.set(key, candidates);
        }
        candidates.add(assessment.anonymizedCandidateId);
      }
    }
  }
  for (const [key, candidates] of missingByKey) add("MISSING_EVIDENCE_DIVERGENCE", candidates, true, key);

  const order = new Map(types.map((type, index) => [type, index]));
  return descriptors
    .sort((a, b) => (order.get(a.type) ?? 0) - (order.get(b.type) ?? 0) || compare(a.candidateIds.join("\0"), b.candidateIds.join("\0")) || compare(a.researchKey ?? "", b.researchKey ?? ""))
    .map((descriptor) => ({ divergenceId: divergenceIdFor(descriptor), ...descriptor, status: "OPEN", resolutionNote: null }));
}

export const detectDivergence = detectDivergences;
