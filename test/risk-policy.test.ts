import { describe, expect, it } from "vitest";
import { evaluateRiskGate, riskAttributeSchemas, riskGateInputSchema, type RiskGateInput, type RiskAttributeName } from "../src/risk-policy.js";

const names: RiskAttributeName[] = ["intendedUser", "foodOrIngestion", "bodyContact", "healthPositioning", "electricalPower", "thermalOrFireHazard", "physicalHazard", "protectiveFunction", "chemicalExposure", "regulatedCategorySignal", "brandOrCreativeSimilaritySignal", "evidenceCompleteness"];
const base: RiskGateInput = {
  decisionId: "boundary-decision", candidateId: "boundary-candidate", decidedByPolicyVersion: "risk-policy-v1-draft",
  attributes: { intendedUser: "GENERAL", foodOrIngestion: "NO", bodyContact: "NONE", healthPositioning: "NONE", electricalPower: "NONE", thermalOrFireHazard: "NONE", physicalHazard: "NONE", protectiveFunction: "NONE", chemicalExposure: "NONE_DECLARED", regulatedCategorySignal: "NONE", brandOrCreativeSimilaritySignal: "NONE_OBSERVED", evidenceCompleteness: "SUFFICIENT" },
  attributeEvidenceIds: Object.fromEntries(names.map((name) => [name, [`ev-${name}`]])) as RiskGateInput["attributeEvidenceIds"],
};

const evaluate = (overrides: Partial<RiskGateInput["attributes"]>) => evaluateRiskGate({ ...base, attributes: { ...base.attributes, ...overrides } });

describe("deterministic risk policy v1", () => {
  it("accepts every declared vocabulary value and allows the neutral vector", () => {
    expect(evaluate({})).toEqual({ decisionId: base.decisionId, candidateId: base.candidateId, outcome: "ALLOWED", reasons: [], decidedByPolicyVersion: base.decidedByPolicyVersion });
    const schemas = riskAttributeSchemas as unknown as Record<RiskAttributeName, { options: readonly string[] }>;
    for (const name of names) {
      for (const value of schemas[name].options) {
        expect(riskGateInputSchema.safeParse({ ...base, attributes: { ...base.attributes, [name]: value } }).success).toBe(true);
      }
    }
  });

  it.each([
    ["foodOrIngestion", "FOOD_OR_SUPPLEMENT", "REJECTED", "SAFETY_INGESTION_OR_FOOD"], ["healthPositioning", "MEDICAL_CLAIM_OR_DEVICE", "REJECTED", "REGULATORY_MEDICAL_POSITIONING"], ["intendedUser", "INFANT_OR_TODDLER", "REJECTED", "SAFETY_INFANT_OR_TODDLER"], ["electricalPower", "MAINS_OR_HIGH_POWER", "REJECTED", "SAFETY_HIGH_POWER_ELECTRICAL"], ["thermalOrFireHazard", "OPEN_FLAME_OR_EXTREME_HEAT", "REJECTED", "SAFETY_FLAME_OR_EXTREME_HEAT"], ["physicalHazard", "PRESSURE_OR_PROJECTILE", "REJECTED", "SAFETY_PRESSURE_OR_PROJECTILE"], ["chemicalExposure", "HAZARDOUS_CHEMICAL", "REJECTED", "SAFETY_HAZARDOUS_CHEMICAL"], ["brandOrCreativeSimilaritySignal", "OBVIOUS_BRAND_OR_CHARACTER_REFERENCE", "REJECTED", "INTELLECTUAL_PROPERTY_OBVIOUS_REFERENCE"],
    ["evidenceCompleteness", "CONFLICTING_MATERIAL_ATTRIBUTE", "MANUAL_REVIEW", "INSUFFICIENT_INFORMATION_MATERIAL_CONFLICT"], ["evidenceCompleteness", "MATERIAL_ATTRIBUTE_MISSING", "MANUAL_REVIEW", "INSUFFICIENT_INFORMATION_MATERIAL_MISSING"], ["intendedUser", "CHILD_UNDER_14", "RESTRICTED", "REGULATORY_CHILD_DIRECTED"], ["chemicalExposure", "COSMETIC_OR_TOPICAL", "RESTRICTED", "REGULATORY_PERSONAL_CARE_OR_SENSITIVE_CONTACT"], ["electricalPower", "BATTERY", "RESTRICTED", "SAFETY_ELECTRICAL_COMPONENT"], ["thermalOrFireHazard", "LOW_HEAT", "RESTRICTED", "SAFETY_PHYSICAL_OR_THERMAL_HAZARD"], ["physicalHazard", "SHARP_OR_CUTTING", "RESTRICTED", "SAFETY_PHYSICAL_OR_THERMAL_HAZARD"], ["protectiveFunction", "SAFETY_OR_PROTECTIVE", "RESTRICTED", "SAFETY_PROTECTIVE_FUNCTION"], ["brandOrCreativeSimilaritySignal", "POSSIBLE_SIMILARITY", "RESTRICTED", "INTELLECTUAL_PROPERTY_POSSIBLE_SIMILARITY"], ["regulatedCategorySignal", "ANIMAL_PRODUCT", "RESTRICTED", "REGULATORY_ELEVATED_CATEGORY"],
  ] as const)("evaluates %s=%s", (attribute, value, outcome, code) => {
    const result = evaluate({ [attribute]: value });
    expect(result.outcome).toBe(outcome);
    expect(result.reasons.map((reason) => reason.code)).toContain(code);
  });

  it("sorts reasons by category and rule, applies precedence, and preserves all matches", () => {
    const result = evaluate({ foodOrIngestion: "INGESTIBLE_COMPONENT", intendedUser: "INFANT_OR_TODDLER", thermalOrFireHazard: "OPEN_FLAME_OR_EXTREME_HEAT", evidenceCompleteness: "MATERIAL_ATTRIBUTE_MISSING" });
    expect(result.outcome).toBe("REJECTED");
    expect(result.reasons.map(({ category, code }) => `${category}:${code}`)).toEqual(["SAFETY:SAFETY_INGESTION_OR_FOOD", "SAFETY:SAFETY_INFANT_OR_TODDLER", "SAFETY:SAFETY_FLAME_OR_EXTREME_HEAT", "INSUFFICIENT_INFORMATION:INSUFFICIENT_INFORMATION_MATERIAL_MISSING"]);
  });

  it("uses only matching OR branches and de-duplicates sorted provenance", () => {
    const input = { ...base, attributeEvidenceIds: { ...base.attributeEvidenceIds, intendedUser: ["z", "a", "a"], regulatedCategorySignal: ["m"] } };
    expect(evaluateRiskGate({ ...input, attributes: { ...input.attributes, intendedUser: "CHILD_UNDER_14" } }).reasons[0].evidenceIds).toEqual(["a", "z"]);
    expect(evaluateRiskGate({ ...input, attributes: { ...input.attributes, regulatedCategorySignal: "TOY_OR_CHILDCARE" } }).reasons[0].evidenceIds).toEqual(["m"]);
    expect(evaluateRiskGate({ ...input, attributes: { ...input.attributes, intendedUser: "CHILD_UNDER_14", regulatedCategorySignal: "TOY_OR_CHILDCARE" } }).reasons[0].evidenceIds).toEqual(["a", "m", "z"]);
  });

  it.each([
    ["chemicalExposure", "COSMETIC_OR_TOPICAL", "REGULATORY_PERSONAL_CARE_OR_SENSITIVE_CONTACT", "ev-chemicalExposure"],
    ["bodyContact", "EYE_OR_MUCOSAL_CONTACT", "REGULATORY_PERSONAL_CARE_OR_SENSITIVE_CONTACT", "ev-bodyContact"],
    ["thermalOrFireHazard", "LOW_HEAT", "SAFETY_PHYSICAL_OR_THERMAL_HAZARD", "ev-thermalOrFireHazard"],
    ["physicalHazard", "SHARP_OR_CUTTING", "SAFETY_PHYSICAL_OR_THERMAL_HAZARD", "ev-physicalHazard"],
    ["regulatedCategorySignal", "PERSONAL_CARE", "REGULATORY_ELEVATED_CATEGORY", "ev-regulatedCategorySignal"],
    ["healthPositioning", "WELLNESS_CLAIM", "REGULATORY_ELEVATED_CATEGORY", "ev-healthPositioning"],
  ] as const)("keeps provenance to the matching branch for %s=%s", (attribute, value, code, evidenceId) => {
    const result = evaluateRiskGate(riskGateInputSchema.parse({ ...base, attributes: { ...base.attributes, [attribute]: value } }));
    expect(result.reasons.find((reason) => reason.code === code)?.evidenceIds).toEqual([evidenceId]);
  });

  it.each(["intendedUser", "foodOrIngestion", "bodyContact", "healthPositioning", "electricalPower", "thermalOrFireHazard", "physicalHazard", "protectiveFunction", "chemicalExposure", "regulatedCategorySignal", "brandOrCreativeSimilaritySignal"] as const)("reviews UNKNOWN %s with only its provenance", (attribute) => {
    const result = evaluateRiskGate(riskGateInputSchema.parse({ ...base, attributes: { ...base.attributes, [attribute]: "UNKNOWN" } }));
    expect(result.outcome).toBe("MANUAL_REVIEW");
    expect(result.reasons).toEqual([expect.objectContaining({ code: "INSUFFICIENT_INFORMATION_ATTRIBUTE_UNKNOWN", evidenceIds: [`ev-${attribute}`] })]);
  });

  it("rejects malformed vocabulary and extra fields", () => {
    for (const attribute of names) {
      expect(() => riskGateInputSchema.parse({ ...base, attributes: { ...base.attributes, [attribute]: "NOT_A_DECLARED_VALUE" } })).toThrow();
    }
    expect(() => riskGateInputSchema.parse({ ...base, extra: true })).toThrow();
  });
});
