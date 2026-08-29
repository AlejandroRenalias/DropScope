import { describe, expect, it } from "vitest";
import { evaluateRiskGate, riskAttributeSchemas, riskGateInputSchema, type RiskGateInput, type RiskAttributeName } from "../src/risk-policy.js";

const names: RiskAttributeName[] = ["intendedUser", "foodOrIngestion", "bodyContact", "healthPositioning", "electricalPower", "thermalOrFireHazard", "physicalHazard", "protectiveFunction", "chemicalExposure", "regulatedCategorySignal", "brandOrCreativeSimilaritySignal", "evidenceCompleteness"];
const base: RiskGateInput = {
  decisionId: "boundary-decision", candidateId: "boundary-candidate", decidedByPolicyVersion: "risk-policy-v1-draft",
  attributes: { intendedUser: "GENERAL", foodOrIngestion: "NO", bodyContact: "NONE", healthPositioning: "NONE", electricalPower: "NONE", thermalOrFireHazard: "NONE", physicalHazard: "NONE", protectiveFunction: "NONE", chemicalExposure: "NONE_DECLARED", regulatedCategorySignal: "NONE", brandOrCreativeSimilaritySignal: "NONE_OBSERVED", evidenceCompleteness: "SUFFICIENT" },
  attributeEvidenceIds: {
    intendedUser: ["ev-intended-user"], foodOrIngestion: ["ev-food"], bodyContact: ["ev-body"],
    healthPositioning: ["ev-health"], electricalPower: ["ev-electrical"], thermalOrFireHazard: ["ev-thermal"],
    physicalHazard: ["ev-physical"], protectiveFunction: ["ev-protective"], chemicalExposure: ["ev-chemical"],
    regulatedCategorySignal: ["ev-regulated"], brandOrCreativeSimilaritySignal: ["ev-brand"], evidenceCompleteness: ["ev-completeness"],
  },
};

const evaluate = (overrides: Partial<RiskGateInput["attributes"]>) => evaluateRiskGate({ ...base, attributes: { ...base.attributes, ...overrides } });
const approvedEvidenceIds: Record<string, string> = {
  "ev-intendedUser": "ev-intended-user", "ev-foodOrIngestion": "ev-food", "ev-bodyContact": "ev-body",
  "ev-healthPositioning": "ev-health", "ev-electricalPower": "ev-electrical", "ev-thermalOrFireHazard": "ev-thermal",
  "ev-physicalHazard": "ev-physical", "ev-protectiveFunction": "ev-protective", "ev-chemicalExposure": "ev-chemical",
  "ev-regulatedCategorySignal": "ev-regulated", "ev-brandOrCreativeSimilaritySignal": "ev-brand", "ev-evidenceCompleteness": "ev-completeness",
};
const reason = (category: "SAFETY" | "REGULATORY" | "INTELLECTUAL_PROPERTY" | "INSUFFICIENT_INFORMATION", code: string, explanation: string, evidenceIds: string[]) => ({ category, code, explanation, evidenceIds: evidenceIds.map((id) => approvedEvidenceIds[id] ?? id) });

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
    ["foodOrIngestion", "FOOD_OR_SUPPLEMENT", "REJECTED", reason("SAFETY", "SAFETY_INGESTION_OR_FOOD", "Food, supplements, and ingestible components are outside the default low-risk scope.", ["ev-foodOrIngestion"])],
    ["healthPositioning", "MEDICAL_CLAIM_OR_DEVICE", "REJECTED", reason("REGULATORY", "REGULATORY_MEDICAL_POSITIONING", "Medical positioning is outside this research filter.", ["ev-healthPositioning"])],
    ["intendedUser", "INFANT_OR_TODDLER", "REJECTED", reason("SAFETY", "SAFETY_INFANT_OR_TODDLER", "Infant/toddler-directed products are excluded conservatively.", ["ev-intendedUser"])],
    ["electricalPower", "MAINS_OR_HIGH_POWER", "REJECTED", reason("SAFETY", "SAFETY_HIGH_POWER_ELECTRICAL", "High-power electrical products are outside the default scope.", ["ev-electricalPower"])],
    ["thermalOrFireHazard", "OPEN_FLAME_OR_EXTREME_HEAT", "REJECTED", reason("SAFETY", "SAFETY_FLAME_OR_EXTREME_HEAT", "Open flame/extreme heat is excluded.", ["ev-thermalOrFireHazard"])],
    ["physicalHazard", "PRESSURE_OR_PROJECTILE", "REJECTED", reason("SAFETY", "SAFETY_PRESSURE_OR_PROJECTILE", "Pressure/projectile hazards are excluded.", ["ev-physicalHazard"])],
    ["chemicalExposure", "HAZARDOUS_CHEMICAL", "REJECTED", reason("SAFETY", "SAFETY_HAZARDOUS_CHEMICAL", "Declared hazardous chemical exposure is excluded.", ["ev-chemicalExposure"])],
    ["brandOrCreativeSimilaritySignal", "OBVIOUS_BRAND_OR_CHARACTER_REFERENCE", "REJECTED", reason("INTELLECTUAL_PROPERTY", "INTELLECTUAL_PROPERTY_OBVIOUS_REFERENCE", "Obvious reference is excluded as a risk signal.", ["ev-brandOrCreativeSimilaritySignal"])],
    ["evidenceCompleteness", "CONFLICTING_MATERIAL_ATTRIBUTE", "MANUAL_REVIEW", reason("INSUFFICIENT_INFORMATION", "INSUFFICIENT_INFORMATION_MATERIAL_CONFLICT", "Conflicting material attributes prevent a deterministic safe classification.", ["ev-evidenceCompleteness"])],
    ["evidenceCompleteness", "MATERIAL_ATTRIBUTE_MISSING", "MANUAL_REVIEW", reason("INSUFFICIENT_INFORMATION", "INSUFFICIENT_INFORMATION_MATERIAL_MISSING", "Missing a material attribute prevents classification.", ["ev-evidenceCompleteness"])],
    ["intendedUser", "CHILD_UNDER_14", "RESTRICTED", reason("REGULATORY", "REGULATORY_CHILD_DIRECTED", "Child-directed/toy-childcare signals require marked research handling.", ["ev-intendedUser"])],
    ["chemicalExposure", "COSMETIC_OR_TOPICAL", "RESTRICTED", reason("REGULATORY", "REGULATORY_PERSONAL_CARE_OR_SENSITIVE_CONTACT", "Personal-care or sensitive-contact items are held out of main ranking.", ["ev-chemicalExposure"])],
    ["electricalPower", "BATTERY", "RESTRICTED", reason("SAFETY", "SAFETY_ELECTRICAL_COMPONENT", "Electrical components exceed the default non-electrical scope.", ["ev-electricalPower"])],
    ["thermalOrFireHazard", "LOW_HEAT", "RESTRICTED", reason("SAFETY", "SAFETY_PHYSICAL_OR_THERMAL_HAZARD", "Heat or cutting hazards require marked handling.", ["ev-thermalOrFireHazard"])],
    ["physicalHazard", "SHARP_OR_CUTTING", "RESTRICTED", reason("SAFETY", "SAFETY_PHYSICAL_OR_THERMAL_HAZARD", "Heat or cutting hazards require marked handling.", ["ev-physicalHazard"])],
    ["protectiveFunction", "SAFETY_OR_PROTECTIVE", "RESTRICTED", reason("SAFETY", "SAFETY_PROTECTIVE_FUNCTION", "Safety/protective claims are held out of the main ranking.", ["ev-protectiveFunction"])],
    ["brandOrCreativeSimilaritySignal", "POSSIBLE_SIMILARITY", "RESTRICTED", reason("INTELLECTUAL_PROPERTY", "INTELLECTUAL_PROPERTY_POSSIBLE_SIMILARITY", "Possible similarity is a research caution, not an IP conclusion.", ["ev-brandOrCreativeSimilaritySignal"])],
    ["regulatedCategorySignal", "ANIMAL_PRODUCT", "RESTRICTED", reason("REGULATORY", "REGULATORY_ELEVATED_CATEGORY", "Elevated-category signals are held out of the main ranking.", ["ev-regulatedCategorySignal"])],
  ] as const)("evaluates exact contract for %s=%s", (attribute, value, outcome, expectedReason) => {
    const result = evaluate({ [attribute]: value });
    expect(result.outcome).toBe(outcome);
    expect(result.reasons).toEqual([expectedReason]);
  });

  it("sorts reasons by category and rule, applies precedence, and preserves all matches", () => {
    const result = evaluate({ foodOrIngestion: "INGESTIBLE_COMPONENT", intendedUser: "INFANT_OR_TODDLER", thermalOrFireHazard: "OPEN_FLAME_OR_EXTREME_HEAT", evidenceCompleteness: "MATERIAL_ATTRIBUTE_MISSING" });
    expect(result.outcome).toBe("REJECTED");
    expect(result.reasons).toEqual([
      reason("SAFETY", "SAFETY_INGESTION_OR_FOOD", "Food, supplements, and ingestible components are outside the default low-risk scope.", ["ev-foodOrIngestion"]),
      reason("SAFETY", "SAFETY_INFANT_OR_TODDLER", "Infant/toddler-directed products are excluded conservatively.", ["ev-intendedUser"]),
      reason("SAFETY", "SAFETY_FLAME_OR_EXTREME_HEAT", "Open flame/extreme heat is excluded.", ["ev-thermalOrFireHazard"]),
      reason("INSUFFICIENT_INFORMATION", "INSUFFICIENT_INFORMATION_MATERIAL_MISSING", "Missing a material attribute prevents classification.", ["ev-evidenceCompleteness"]),
    ]);
  });

  it("replays every approved boundary vector with the full decision contract", () => {
    const expected = (outcome: ReturnType<typeof evaluateRiskGate>["outcome"], reasons: ReturnType<typeof reason>[]) => ({ decisionId: base.decisionId, candidateId: base.candidateId, outcome, reasons, decidedByPolicyVersion: base.decidedByPolicyVersion });
    expect(evaluate({})).toEqual(expected("ALLOWED", []));
    expect(evaluate({ electricalPower: "LOW_VOLTAGE_USB_OR_CORDED" })).toEqual(expected("RESTRICTED", [reason("SAFETY", "SAFETY_ELECTRICAL_COMPONENT", "Electrical components exceed the default non-electrical scope.", ["ev-electricalPower"])]));
    expect(evaluate({ intendedUser: "CHILD_UNDER_14", regulatedCategorySignal: "TOY_OR_CHILDCARE" })).toEqual(expected("RESTRICTED", [reason("REGULATORY", "REGULATORY_CHILD_DIRECTED", "Child-directed/toy-childcare signals require marked research handling.", ["ev-intendedUser", "ev-regulatedCategorySignal"])]));
    expect(evaluate({ intendedUser: "INFANT_OR_TODDLER", foodOrIngestion: "INGESTIBLE_COMPONENT" })).toEqual(expected("REJECTED", [
      reason("SAFETY", "SAFETY_INGESTION_OR_FOOD", "Food, supplements, and ingestible components are outside the default low-risk scope.", ["ev-foodOrIngestion"]),
      reason("SAFETY", "SAFETY_INFANT_OR_TODDLER", "Infant/toddler-directed products are excluded conservatively.", ["ev-intendedUser"]),
    ]));
    expect(evaluate({ chemicalExposure: "UNKNOWN" })).toEqual(expected("MANUAL_REVIEW", [reason("INSUFFICIENT_INFORMATION", "INSUFFICIENT_INFORMATION_ATTRIBUTE_UNKNOWN", "Unknown declared attributes are not assumed safe.", ["ev-chemicalExposure"])]));
    expect(evaluate({ brandOrCreativeSimilaritySignal: "POSSIBLE_SIMILARITY" })).toEqual(expected("RESTRICTED", [reason("INTELLECTUAL_PROPERTY", "INTELLECTUAL_PROPERTY_POSSIBLE_SIMILARITY", "Possible similarity is a research caution, not an IP conclusion.", ["ev-brandOrCreativeSimilaritySignal"])]));
    expect(evaluate({ thermalOrFireHazard: "OPEN_FLAME_OR_EXTREME_HEAT", evidenceCompleteness: "MATERIAL_ATTRIBUTE_MISSING" })).toEqual(expected("REJECTED", [
      reason("SAFETY", "SAFETY_FLAME_OR_EXTREME_HEAT", "Open flame/extreme heat is excluded.", ["ev-thermalOrFireHazard"]),
      reason("INSUFFICIENT_INFORMATION", "INSUFFICIENT_INFORMATION_MATERIAL_MISSING", "Missing a material attribute prevents classification.", ["ev-evidenceCompleteness"]),
    ]));
  });

  it("uses only matching OR branches and de-duplicates sorted provenance", () => {
    const input = { ...base, attributeEvidenceIds: { ...base.attributeEvidenceIds, intendedUser: ["z", "a", "a"], regulatedCategorySignal: ["m"] } };
    expect(evaluateRiskGate({ ...input, attributes: { ...input.attributes, intendedUser: "CHILD_UNDER_14" } }).reasons[0].evidenceIds).toEqual(["a", "z"]);
    expect(evaluateRiskGate({ ...input, attributes: { ...input.attributes, regulatedCategorySignal: "TOY_OR_CHILDCARE" } }).reasons[0].evidenceIds).toEqual(["m"]);
    expect(evaluateRiskGate({ ...input, attributes: { ...input.attributes, intendedUser: "CHILD_UNDER_14", regulatedCategorySignal: "TOY_OR_CHILDCARE" } }).reasons[0].evidenceIds).toEqual(["a", "m", "z"]);
  });

  it.each([
    ["bodyContact", "EYE_OR_MUCOSAL_CONTACT", reason("REGULATORY", "REGULATORY_PERSONAL_CARE_OR_SENSITIVE_CONTACT", "Personal-care or sensitive-contact items are held out of main ranking.", ["ev-bodyContact"])],
    ["physicalHazard", "SHARP_OR_CUTTING", reason("SAFETY", "SAFETY_PHYSICAL_OR_THERMAL_HAZARD", "Heat or cutting hazards require marked handling.", ["ev-physicalHazard"])],
    ["regulatedCategorySignal", "PERSONAL_CARE", reason("REGULATORY", "REGULATORY_ELEVATED_CATEGORY", "Elevated-category signals are held out of the main ranking.", ["ev-regulatedCategorySignal"])],
    ["healthPositioning", "WELLNESS_CLAIM", reason("REGULATORY", "REGULATORY_ELEVATED_CATEGORY", "Elevated-category signals are held out of the main ranking.", ["ev-healthPositioning"])],
  ] as const)("keeps exact contract and provenance to the matching branch for %s=%s", (attribute, value, expectedReason) => {
    const result = evaluateRiskGate(riskGateInputSchema.parse({ ...base, attributes: { ...base.attributes, [attribute]: value } }));
    expect(result.reasons).toEqual([expectedReason]);
  });

  it.each(["intendedUser", "foodOrIngestion", "bodyContact", "healthPositioning", "electricalPower", "thermalOrFireHazard", "physicalHazard", "protectiveFunction", "chemicalExposure", "regulatedCategorySignal", "brandOrCreativeSimilaritySignal"] as const)("reviews UNKNOWN %s with only its provenance", (attribute) => {
    const result = evaluateRiskGate(riskGateInputSchema.parse({ ...base, attributes: { ...base.attributes, [attribute]: "UNKNOWN" } }));
    expect(result.outcome).toBe("MANUAL_REVIEW");
    expect(result.reasons).toEqual([reason("INSUFFICIENT_INFORMATION", "INSUFFICIENT_INFORMATION_ATTRIBUTE_UNKNOWN", "Unknown declared attributes are not assumed safe.", [`ev-${attribute}`])]);
  });

  it("rejects malformed vocabulary and extra fields", () => {
    for (const attribute of names) {
      expect(() => riskGateInputSchema.parse({ ...base, attributes: { ...base.attributes, [attribute]: "NOT_A_DECLARED_VALUE" } })).toThrow();
    }
    expect(() => riskGateInputSchema.parse({ ...base, extra: true })).toThrow();
    expect(() => riskGateInputSchema.parse({ ...base, attributes: { ...base.attributes, extra: true } })).toThrow();
    expect(() => riskGateInputSchema.parse({ ...base, attributeEvidenceIds: { ...base.attributeEvidenceIds, extra: ["ev-extra"] } })).toThrow();
  });
});
