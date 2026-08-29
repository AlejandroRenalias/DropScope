import { z } from "zod";
import { riskGateDecisionSchema, type RiskGateDecision } from "./research-domain.js";

const idSchema = z.string().min(1);

export const riskAttributeSchemas = {
  intendedUser: z.enum(["GENERAL", "CHILD_UNDER_14", "INFANT_OR_TODDLER", "UNKNOWN"]),
  foodOrIngestion: z.enum(["NO", "FOOD_OR_SUPPLEMENT", "INGESTIBLE_COMPONENT", "UNKNOWN"]),
  bodyContact: z.enum(["NONE", "ORDINARY_SKIN_CONTACT", "EYE_OR_MUCOSAL_CONTACT", "UNKNOWN"]),
  healthPositioning: z.enum(["NONE", "WELLNESS_CLAIM", "MEDICAL_CLAIM_OR_DEVICE", "UNKNOWN"]),
  electricalPower: z.enum(["NONE", "LOW_VOLTAGE_USB_OR_CORDED", "BATTERY", "MAINS_OR_HIGH_POWER", "UNKNOWN"]),
  thermalOrFireHazard: z.enum(["NONE", "LOW_HEAT", "OPEN_FLAME_OR_EXTREME_HEAT", "UNKNOWN"]),
  physicalHazard: z.enum(["NONE", "BLUNT_LOW_FORCE", "SHARP_OR_CUTTING", "PRESSURE_OR_PROJECTILE", "UNKNOWN"]),
  protectiveFunction: z.enum(["NONE", "COMFORT_OR_ORGANIZATION", "SAFETY_OR_PROTECTIVE", "UNKNOWN"]),
  chemicalExposure: z.enum(["NONE_DECLARED", "COSMETIC_OR_TOPICAL", "HAZARDOUS_CHEMICAL", "UNKNOWN"]),
  regulatedCategorySignal: z.enum(["NONE", "ANIMAL_PRODUCT", "TOY_OR_CHILDCARE", "PERSONAL_CARE", "UNKNOWN"]),
  brandOrCreativeSimilaritySignal: z.enum(["NONE_OBSERVED", "POSSIBLE_SIMILARITY", "OBVIOUS_BRAND_OR_CHARACTER_REFERENCE", "UNKNOWN"]),
  evidenceCompleteness: z.enum(["SUFFICIENT", "MATERIAL_ATTRIBUTE_MISSING", "CONFLICTING_MATERIAL_ATTRIBUTE"]),
} as const;

export const riskAttributesSchema = z.object(riskAttributeSchemas).strict();
export type RiskAttributes = z.infer<typeof riskAttributesSchema>;

const attributeNames = [
  "intendedUser", "foodOrIngestion", "bodyContact", "healthPositioning", "electricalPower",
  "thermalOrFireHazard", "physicalHazard", "protectiveFunction", "chemicalExposure",
  "regulatedCategorySignal", "brandOrCreativeSimilaritySignal", "evidenceCompleteness",
] as const;
export type RiskAttributeName = typeof attributeNames[number];

export const riskGateInputSchema = z.object({
  decisionId: idSchema,
  candidateId: idSchema,
  decidedByPolicyVersion: idSchema,
  attributes: riskAttributesSchema,
  attributeEvidenceIds: z.object(Object.fromEntries(attributeNames.map((name) => [name, z.array(idSchema)])) as Record<RiskAttributeName, z.ZodArray<typeof idSchema>>).strict(),
}).strict();
export type RiskGateInput = z.infer<typeof riskGateInputSchema>;

type Category = RiskGateDecision["reasons"][number]["category"];
type Rule = { id: string; outcome: RiskGateDecision["outcome"]; category: Category; code: string; explanation: string; attributes: RiskAttributeName[]; matches: (a: RiskAttributes) => boolean; evidenceAttributes?: (a: RiskAttributes) => RiskAttributeName[] };

const rules: Rule[] = [
  { id: "RISK-001", outcome: "REJECTED", category: "SAFETY", code: "SAFETY_INGESTION_OR_FOOD", explanation: "Food, supplements, and ingestible components are outside the default low-risk scope.", attributes: ["foodOrIngestion"], matches: (a) => ["FOOD_OR_SUPPLEMENT", "INGESTIBLE_COMPONENT"].includes(a.foodOrIngestion) },
  { id: "RISK-002", outcome: "REJECTED", category: "REGULATORY", code: "REGULATORY_MEDICAL_POSITIONING", explanation: "Medical positioning is outside this research filter.", attributes: ["healthPositioning"], matches: (a) => a.healthPositioning === "MEDICAL_CLAIM_OR_DEVICE" },
  { id: "RISK-003", outcome: "REJECTED", category: "SAFETY", code: "SAFETY_INFANT_OR_TODDLER", explanation: "Infant/toddler-directed products are excluded conservatively.", attributes: ["intendedUser"], matches: (a) => a.intendedUser === "INFANT_OR_TODDLER" },
  { id: "RISK-004", outcome: "REJECTED", category: "SAFETY", code: "SAFETY_HIGH_POWER_ELECTRICAL", explanation: "High-power electrical products are outside the default scope.", attributes: ["electricalPower"], matches: (a) => a.electricalPower === "MAINS_OR_HIGH_POWER" },
  { id: "RISK-005", outcome: "REJECTED", category: "SAFETY", code: "SAFETY_FLAME_OR_EXTREME_HEAT", explanation: "Open flame/extreme heat is excluded.", attributes: ["thermalOrFireHazard"], matches: (a) => a.thermalOrFireHazard === "OPEN_FLAME_OR_EXTREME_HEAT" },
  { id: "RISK-006", outcome: "REJECTED", category: "SAFETY", code: "SAFETY_PRESSURE_OR_PROJECTILE", explanation: "Pressure/projectile hazards are excluded.", attributes: ["physicalHazard"], matches: (a) => a.physicalHazard === "PRESSURE_OR_PROJECTILE" },
  { id: "RISK-007", outcome: "REJECTED", category: "SAFETY", code: "SAFETY_HAZARDOUS_CHEMICAL", explanation: "Declared hazardous chemical exposure is excluded.", attributes: ["chemicalExposure"], matches: (a) => a.chemicalExposure === "HAZARDOUS_CHEMICAL" },
  { id: "RISK-008", outcome: "REJECTED", category: "INTELLECTUAL_PROPERTY", code: "INTELLECTUAL_PROPERTY_OBVIOUS_REFERENCE", explanation: "Obvious reference is excluded as a risk signal.", attributes: ["brandOrCreativeSimilaritySignal"], matches: (a) => a.brandOrCreativeSimilaritySignal === "OBVIOUS_BRAND_OR_CHARACTER_REFERENCE" },
  { id: "RISK-009", outcome: "MANUAL_REVIEW", category: "INSUFFICIENT_INFORMATION", code: "INSUFFICIENT_INFORMATION_MATERIAL_CONFLICT", explanation: "Conflicting material attributes prevent a deterministic safe classification.", attributes: ["evidenceCompleteness"], matches: (a) => a.evidenceCompleteness === "CONFLICTING_MATERIAL_ATTRIBUTE" },
  { id: "RISK-010", outcome: "MANUAL_REVIEW", category: "INSUFFICIENT_INFORMATION", code: "INSUFFICIENT_INFORMATION_MATERIAL_MISSING", explanation: "Missing a material attribute prevents classification.", attributes: ["evidenceCompleteness"], matches: (a) => a.evidenceCompleteness === "MATERIAL_ATTRIBUTE_MISSING" },
  { id: "RISK-011", outcome: "MANUAL_REVIEW", category: "INSUFFICIENT_INFORMATION", code: "INSUFFICIENT_INFORMATION_ATTRIBUTE_UNKNOWN", explanation: "Unknown declared attributes are not assumed safe.", attributes: attributeNames.slice(0, 11), matches: (a) => attributeNames.slice(0, 11).some((name) => a[name] === "UNKNOWN"), evidenceAttributes: (a) => attributeNames.slice(0, 11).filter((name) => a[name] === "UNKNOWN") },
  { id: "RISK-012", outcome: "RESTRICTED", category: "REGULATORY", code: "REGULATORY_CHILD_DIRECTED", explanation: "Child-directed/toy-childcare signals require marked research handling.", attributes: ["intendedUser", "regulatedCategorySignal"], matches: (a) => a.intendedUser === "CHILD_UNDER_14" || a.regulatedCategorySignal === "TOY_OR_CHILDCARE", evidenceAttributes: (a) => [a.intendedUser === "CHILD_UNDER_14" && "intendedUser", a.regulatedCategorySignal === "TOY_OR_CHILDCARE" && "regulatedCategorySignal"].filter(Boolean) as RiskAttributeName[] },
  { id: "RISK-013", outcome: "RESTRICTED", category: "REGULATORY", code: "REGULATORY_PERSONAL_CARE_OR_SENSITIVE_CONTACT", explanation: "Personal-care or sensitive-contact items are held out of main ranking.", attributes: ["chemicalExposure", "bodyContact"], matches: (a) => a.chemicalExposure === "COSMETIC_OR_TOPICAL" || a.bodyContact === "EYE_OR_MUCOSAL_CONTACT", evidenceAttributes: (a) => [a.chemicalExposure === "COSMETIC_OR_TOPICAL" && "chemicalExposure", a.bodyContact === "EYE_OR_MUCOSAL_CONTACT" && "bodyContact"].filter(Boolean) as RiskAttributeName[] },
  { id: "RISK-014", outcome: "RESTRICTED", category: "SAFETY", code: "SAFETY_ELECTRICAL_COMPONENT", explanation: "Electrical components exceed the default non-electrical scope.", attributes: ["electricalPower"], matches: (a) => ["BATTERY", "LOW_VOLTAGE_USB_OR_CORDED"].includes(a.electricalPower) },
  { id: "RISK-015", outcome: "RESTRICTED", category: "SAFETY", code: "SAFETY_PHYSICAL_OR_THERMAL_HAZARD", explanation: "Heat or cutting hazards require marked handling.", attributes: ["thermalOrFireHazard", "physicalHazard"], matches: (a) => a.thermalOrFireHazard === "LOW_HEAT" || a.physicalHazard === "SHARP_OR_CUTTING", evidenceAttributes: (a) => [a.thermalOrFireHazard === "LOW_HEAT" && "thermalOrFireHazard", a.physicalHazard === "SHARP_OR_CUTTING" && "physicalHazard"].filter(Boolean) as RiskAttributeName[] },
  { id: "RISK-016", outcome: "RESTRICTED", category: "SAFETY", code: "SAFETY_PROTECTIVE_FUNCTION", explanation: "Safety/protective claims are held out of the main ranking.", attributes: ["protectiveFunction"], matches: (a) => a.protectiveFunction === "SAFETY_OR_PROTECTIVE" },
  { id: "RISK-017", outcome: "RESTRICTED", category: "INTELLECTUAL_PROPERTY", code: "INTELLECTUAL_PROPERTY_POSSIBLE_SIMILARITY", explanation: "Possible similarity is a research caution, not an IP conclusion.", attributes: ["brandOrCreativeSimilaritySignal"], matches: (a) => a.brandOrCreativeSimilaritySignal === "POSSIBLE_SIMILARITY" },
  { id: "RISK-018", outcome: "RESTRICTED", category: "REGULATORY", code: "REGULATORY_ELEVATED_CATEGORY", explanation: "Elevated-category signals are held out of the main ranking.", attributes: ["regulatedCategorySignal", "healthPositioning"], matches: (a) => ["ANIMAL_PRODUCT", "PERSONAL_CARE"].includes(a.regulatedCategorySignal) || a.healthPositioning === "WELLNESS_CLAIM", evidenceAttributes: (a) => [["ANIMAL_PRODUCT", "PERSONAL_CARE"].includes(a.regulatedCategorySignal) && "regulatedCategorySignal", a.healthPositioning === "WELLNESS_CLAIM" && "healthPositioning"].filter(Boolean) as RiskAttributeName[] },
];

const precedence: Record<RiskGateDecision["outcome"], number> = { ALLOWED: 0, RESTRICTED: 1, MANUAL_REVIEW: 2, REJECTED: 3 };
const categoryOrder: Category[] = ["SAFETY", "REGULATORY", "INTELLECTUAL_PROPERTY", "POLICY", "INSUFFICIENT_INFORMATION"];

export function evaluateRiskGate(input: RiskGateInput): RiskGateDecision {
  const parsed = riskGateInputSchema.parse(input);
  const matched = rules.filter((rule) => rule.matches(parsed.attributes));
  const reasons = matched.map((rule) => ({
    category: rule.category,
    code: rule.code,
    explanation: rule.explanation,
    evidenceIds: [...new Set((rule.evidenceAttributes?.(parsed.attributes) ?? rule.attributes).flatMap((name) => parsed.attributeEvidenceIds[name]))].sort(),
    ruleId: rule.id,
  })).sort((a, b) => categoryOrder.indexOf(a.category) - categoryOrder.indexOf(b.category) || a.ruleId.localeCompare(b.ruleId));
  const outcome = matched.reduce<RiskGateDecision["outcome"]>((current, rule) => precedence[rule.outcome] > precedence[current] ? rule.outcome : current, "ALLOWED");
  return riskGateDecisionSchema.parse({ decisionId: parsed.decisionId, candidateId: parsed.candidateId, outcome, reasons: reasons.map(({ ruleId: _ruleId, ...reason }) => reason), decidedByPolicyVersion: parsed.decidedByPolicyVersion });
}

export const evaluateRiskPolicy = evaluateRiskGate;
