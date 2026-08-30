import type { Claim, Evidence, ResearchDataset, Source } from "./research-domain.js";

export type AuditSeverity = "BLOCKING" | "HIGH" | "MEDIUM" | "LOW";
export type AuditCode =
  | "AUDIT_DECISIVE_CLAIM_NO_VALID_EVIDENCE"
  | "AUDIT_DECISIVE_SINGLE_GROUP_NOT_TENTATIVE"
  | "AUDIT_EVIDENCE_UNTRACEABLE"
  | "AUDIT_SOURCE_DUPLICATE"
  | "AUDIT_FACT_DUPLICATE"
  | "AUDIT_CLAIM_DUPLICATE"
  | "AUDIT_MATERIAL_CONTRADICTION"
  | "AUDIT_UNCERTAIN_DECISIVE_LABEL";

export interface EvidenceAuditFinding {
  code: AuditCode;
  severity: AuditSeverity;
  claimIds: string[];
  evidenceIds: string[];
  sourceIds: string[];
  factIds: string[];
  explanation: string;
}

export interface EvidenceAuditResult { findings: EvidenceAuditFinding[]; }

const severityOrder: Record<AuditSeverity, number> = { BLOCKING: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const lexical = (values: Iterable<string>) => [...new Set(values)].sort(compare);
const annotation = (record: { fixtureAnnotation: Record<string, unknown> | null }, keys: string[]) => {
  for (const key of keys) if (record.fixtureAnnotation && record.fixtureAnnotation[key] !== undefined) return record.fixtureAnnotation[key];
  return undefined;
};
const stringAnnotation = (record: { fixtureAnnotation: Record<string, unknown> | null }, keys: string[]) => {
  const value = annotation(record, keys);
  return typeof value === "string" && value.length > 0 ? value : undefined;
};
const stringArrayAnnotation = (record: { fixtureAnnotation: Record<string, unknown> | null }, keys: string[]) => {
  const value = annotation(record, keys);
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
};
const normalized = (value: string) => value.trim().toLowerCase().replace(/\/+$/, "");

function finding(code: AuditCode, severity: AuditSeverity, fields: Partial<Pick<EvidenceAuditFinding, "claimIds" | "evidenceIds" | "sourceIds" | "factIds">>, explanation: string): EvidenceAuditFinding {
  return { code, severity, claimIds: lexical(fields.claimIds ?? []), evidenceIds: lexical(fields.evidenceIds ?? []), sourceIds: lexical(fields.sourceIds ?? []), factIds: lexical(fields.factIds ?? []), explanation };
}

export function auditEvidence(dataset: ResearchDataset): EvidenceAuditResult {
  const candidates = new Set(dataset.candidates.map((item) => item.candidateId));
  const sources = new Map(dataset.sources.map((item) => [item.sourceId, item]));
  const claims = new Map(dataset.claims.map((item) => [item.claimId, item]));
  const findings: EvidenceAuditFinding[] = [];
  const traceable = new Map<string, Evidence[]>();

  for (const item of dataset.evidence) {
    const claim = claims.get(item.claimId);
    const untraceable = !candidates.has(item.candidateId) || !sources.has(item.sourceId) || !claim
      || claim.candidateId !== item.candidateId;
    if (untraceable) {
      findings.push(finding("AUDIT_EVIDENCE_UNTRACEABLE", "BLOCKING", { evidenceIds: [item.evidenceId], claimIds: claim ? [claim.claimId] : [item.claimId], sourceIds: sources.has(item.sourceId) ? [item.sourceId] : [] }, `Evidence ${item.evidenceId} does not trace to a known candidate, claim, and source with matching IDs.`));
    } else traceable.set(item.claimId, [...(traceable.get(item.claimId) ?? []), item]);
  }

  for (const claim of dataset.claims) {
    const valid = (traceable.get(claim.claimId) ?? []).filter((item) => claim.evidenceIds.includes(item.evidenceId));
    const groups = new Set(valid.map((item) => item.independenceGroupId));
    if (claim.decisive && valid.length === 0) findings.push(finding("AUDIT_DECISIVE_CLAIM_NO_VALID_EVIDENCE", "BLOCKING", { claimIds: [claim.claimId] }, `Decisive claim ${claim.claimId} has no traceable evidence.`));
    if (claim.decisive && groups.size < 2 && !claim.tentative) findings.push(finding("AUDIT_DECISIVE_SINGLE_GROUP_NOT_TENTATIVE", "HIGH", { claimIds: [claim.claimId], evidenceIds: valid.map((item) => item.evidenceId) }, `Decisive claim ${claim.claimId} has fewer than two independent evidence groups and is not tentative.`));
    const unknownSupport = valid.some((item) => item.direction === "SUPPORTS" && item.reliabilityClass === "UNKNOWN");
    if (claim.decisive && (groups.size < 2 || unknownSupport) && (!claim.tentative || unknownSupport)) findings.push(finding("AUDIT_UNCERTAIN_DECISIVE_LABEL", "HIGH", { claimIds: [claim.claimId], evidenceIds: valid.map((item) => item.evidenceId) }, `Decisive claim ${claim.claimId} has an insufficiently independent or reliable uncertainty label.`));
    const supports = valid.filter((item) => item.direction === "SUPPORTS");
    const opposes = valid.filter((item) => item.direction === "OPPOSES");
    if (claim.decisive && supports.length > 0 && opposes.length > 0 && supports.some((support) => opposes.some((opposing) => support.independenceGroupId !== opposing.independenceGroupId))) findings.push(finding("AUDIT_MATERIAL_CONTRADICTION", "HIGH", { claimIds: [claim.claimId], evidenceIds: [...supports, ...opposes].map((item) => item.evidenceId) }, `Decisive claim ${claim.claimId} has supporting and opposing evidence from distinct independence groups.`));
  }

  duplicateSources(dataset.sources, findings);
  duplicateFacts(dataset.evidence, findings);
  duplicateClaims(dataset.claims, dataset.evidence, findings);
  return { findings: findings.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity] || compare(a.code, b.code) || compare(JSON.stringify([a.claimIds, a.evidenceIds, a.sourceIds, a.factIds]), JSON.stringify([b.claimIds, b.evidenceIds, b.sourceIds, b.factIds]))) };
}

function duplicateSources(records: Source[], findings: EvidenceAuditFinding[]) {
  const groups = new Map<string, Source[]>();
  for (const record of records) for (const key of [`id:${normalized(record.sourceId)}`, `location:${normalized(record.canonicalLocation)}`]) groups.set(key, [...(groups.get(key) ?? []), record]);
  const emitted = new Set<string>();
  for (const recordsForKey of groups.values()) if (recordsForKey.length > 1) { const ids = lexical(recordsForKey.map((item) => item.sourceId)); const signature = ids.join("\0"); if (!emitted.has(signature)) { emitted.add(signature); findings.push(finding("AUDIT_SOURCE_DUPLICATE", "MEDIUM", { sourceIds: ids }, `Sources share a normalized source ID or canonical location: ${ids.join(", ")}.`)); } }
}

function duplicateFacts(records: Evidence[], findings: EvidenceAuditFinding[]) {
  const groups = new Map<string, Evidence[]>();
  for (const record of records) { const id = stringAnnotation(record, ["canonicalFactId", "canonical_fact_id"]); if (id) groups.set(id, [...(groups.get(id) ?? []), record]); }
  for (const [factId, group] of groups) if (group.length > 1) findings.push(finding("AUDIT_FACT_DUPLICATE", "MEDIUM", { factIds: [factId], evidenceIds: group.map((item) => item.evidenceId), sourceIds: group.map((item) => item.sourceId) }, `Evidence records share declared canonical fact ${factId}.`));
}

function duplicateClaims(claims: Claim[], evidence: Evidence[], findings: EvidenceAuditFinding[]) {
  const groups = new Map<string, Claim[]>();
  for (const claim of claims) groups.set(`${claim.candidateId}\0${claim.claimTopic}`, [...(groups.get(`${claim.candidateId}\0${claim.claimTopic}`) ?? []), claim]);
  for (const group of groups.values()) for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
    const left = new Set(group[i].evidenceIds.flatMap((id) => { const item = evidence.find((candidate) => candidate.evidenceId === id); return item ? [item.evidenceId, ...stringArrayAnnotation(item, ["canonicalEvidenceIds", "canonical_evidence_ids"])] : []; }));
    const right = new Set(group[j].evidenceIds.flatMap((id) => { const item = evidence.find((candidate) => candidate.evidenceId === id); return item ? [item.evidenceId, ...stringArrayAnnotation(item, ["canonicalEvidenceIds", "canonical_evidence_ids"])] : []; }));
    const overlap = [...left].filter((id) => right.has(id)).sort(compare);
    if (overlap.length) findings.push(finding("AUDIT_CLAIM_DUPLICATE", "MEDIUM", { claimIds: [group[i].claimId, group[j].claimId], evidenceIds: overlap }, `Claims share explicitly overlapping canonical evidence IDs: ${overlap.join(", ")}.`));
  }
}

export const runEvidenceAudit = auditEvidence;
