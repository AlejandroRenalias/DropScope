import { describe, expect, it } from "vitest";
import { detectDivergences, type CommanderSnapshot } from "../src/divergence-detector.js";
import type { BlindReviewResult } from "../src/research-domain.js";

const assessment = (candidateId: string, eligible = true, confidenceClass: "LOW" | "MEDIUM" | "HIGH" = "MEDIUM", missingResearchKeys: string[] = []) => ({ anonymizedCandidateId: candidateId, reviewerScore: 80, reviewerEligible: eligible, confidenceClass, dimensionScores: { sourceIndependence: 80, decisionCriticalCoverage: 80, contradictionHandling: 80, claimEvidenceAlignment: 80, uncertaintyCalibration: 80 }, blockingDefects: [], missingResearchKeys });
const commander: CommanderSnapshot = { candidateAssessments: [{ candidateId: "a", eligible: false, confidenceClass: "LOW" }, { candidateId: "b", eligible: true, confidenceClass: "MEDIUM" }, { candidateId: "c", eligible: true, confidenceClass: "HIGH" }], ranking: ["a", "b", "c"], activeTasks: [], completedTasks: [] };
const review: BlindReviewResult = { reviewId: "review", candidateAssessments: [assessment("a", true, "MEDIUM", ["pricing"]), assessment("b", true, "MEDIUM"), assessment("c", true, "HIGH")], ranking: ["b", "c", "a"], verdict: "ACCEPT" };
const run = (snapshot = commander, result = review) => detectDivergences({ commanderSnapshot: snapshot, blindReview: result, divergenceIdFor: (d) => `id-${d.type}-${d.candidateIds.join("-")}-${d.researchKey ?? "none"}` });

describe("divergence detector", () => {
  it("emits all five policy types", () => {
    const records = run();
    expect(records.map((record) => record.type)).toEqual(["ELIGIBILITY_DIVERGENCE", "TOP_CANDIDATE_DIVERGENCE", "RANK_POSITION_DIVERGENCE", "CONFIDENCE_DIVERGENCE", "MISSING_EVIDENCE_DIVERGENCE"]);
    expect(records.every((record) => record.status === "OPEN" && record.resolutionNote === null)).toBe(true);
    expect(records.find((record) => record.type === "MISSING_EVIDENCE_DIVERGENCE")).toMatchObject({ candidateIds: ["a"], researchKey: "pricing", blocking: true });
  });
  it("uses code-unit lexical candidate ordering and replay is stable", () => {
    const swapped = { ...commander, ranking: ["c", "b", "a"] };
    expect(run(swapped)).toEqual(run(swapped));
    expect(run(swapped).find((record) => record.type === "TOP_CANDIDATE_DIVERGENCE")?.candidateIds).toEqual(["b", "c"]);
  });
  it("does not emit top divergence for empty rankings or missing evidence already covered", () => {
    const snapshot = { ...commander, ranking: [], coveredResearchKeys: ["pricing"] };
    const records = run(snapshot);
    expect(records.some((record) => record.type === "TOP_CANDIDATE_DIVERGENCE" || record.type === "MISSING_EVIDENCE_DIVERGENCE")).toBe(false);
  });
  it("uses the frozen rank threshold of two positions", () => {
    const atOne = run({ ...commander, ranking: ["a", "b", "c"] }, { ...review, ranking: ["b", "a", "c"] });
    expect(atOne.some((record) => record.type === "RANK_POSITION_DIVERGENCE")).toBe(false);
    const atTwo = run({ ...commander, ranking: ["a", "b", "c"] }, { ...review, ranking: ["c", "b", "a"] });
    expect(atTwo.some((record) => record.type === "RANK_POSITION_DIVERGENCE")).toBe(true);
  });
  it("requires caller-supplied IDs", () => {
    expect(run()[0].divergenceId).toMatch(/^id-/);
  });
});
