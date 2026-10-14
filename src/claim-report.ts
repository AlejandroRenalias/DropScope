// Plain-language reading of a claim check. Pure: used by the replay screen and by the command line so both say the
// same thing. "Supported" always means "the text is in the recording", never "the claim is true".
import { tidyName, type ClaimCheckResult, type ClaimResult, type ClaimVerdict } from "./claim-check.js";

export const CLAIM_NOTE =
  "This checks what a run recorded. For each claim you wrote, DropScope looks for the exact texts you listed in the recorded content of one step. It never asks a model to judge, and it cannot see anything the trace did not record.";

export const VERDICT_LABEL: Record<ClaimVerdict, string> = {
  SUPPORTED: "Supported", NOT_SUPPORTED: "Not supported", CANNOT_CHECK: "Cannot check",
};

const FIELD_WORD = { result: "result", arguments: "arguments", input: "input", output: "output" } as const;
const quote = (texts: string[]): string => texts.map((t) => JSON.stringify(t.length > 80 ? `${t.slice(0, 80)}…` : t)).join(", ");

/** One sentence that says what was found, in terms of the steps of this run. */
export function describeClaimResult(r: ClaimResult, titleOf: (stepId: string) => string, knownTools: string[], knownToolsTotal: number): string {
  const field = FIELD_WORD[r.claim.field];
  const title = r.stepId === null ? "a step" : titleOf(r.stepId);
  const more = r.stepsChecked > 1 ? ` (${r.stepsChecked} steps matched; this is ${r.verdict === "SUPPORTED" ? "the first that supports it" : "the closest"})` : "";
  switch (r.reason) {
    case "FOUND": {
      const n = r.claim.mustContain.length;
      const failed = r.stepFailed ? " That step ended with an error, so treat this evidence with care." : "";
      return `${n === 1 ? "The text you listed appears" : `All ${n} texts you listed appear`} in the recorded ${field} of ${title}${more}, recorded at event ${r.evidenceEvent}.${failed}`;
    }
    case "NO_MATCHING_STEP": {
      const what = r.claim.tool !== null ? `a tool named ${JSON.stringify(tidyName(r.claim.tool))}` : `the id ${r.claim.stepId}`;
      const hint = r.claim.tool !== null
        ? (knownToolsTotal === 0 ? " No tool calls with a name were recorded in this run." : ` Tools in this run: ${knownTools.map((t) => JSON.stringify(t)).join(", ")}${knownToolsTotal > knownTools.length ? `, and ${knownToolsTotal - knownTools.length} more` : ""}.`)
        : "";
      return `No step in this run matches ${what}, so nothing recorded could support this claim.${hint}`;
    }
    case "NOT_FOUND":
      return `The recorded ${field} of ${title} was read${more}, but ${r.missing.length === 1 ? "this text does" : "these texts do"} not appear in it: ${quote(r.missing)}.`;
    case "TOO_LATE":
      return `The ${field} of ${title} was only recorded at event ${r.evidenceEvent}, after event ${r.claim.atEvent} where the claim was made, so it cannot have supported it.`;
    case "CONTENT_WITHHELD":
      return `Cannot check: this run was imported without content, so only the size and a fingerprint of the ${field} of ${title} were kept. Import the trace again with --full to check claims.`;
    case "NO_CONTENT":
      return `Cannot check: the trace did not record the ${field} of ${title}${more}.`;
    case "TOO_MUCH_WORK":
      return "Cannot check: the content to search is too large for this many claims. Check fewer claims at a time.";
  }
}

export function claimCaveats(check: ClaimCheckResult): string[] {
  const notes = [
    "Supported means the texts you listed appear in what was recorded. It does not prove the claim is true: the same words can mean something else in context (for example \"accepted\" also appears in \"not accepted\").",
    "Matching is exact text, only in the field you chose. Capital letters count unless you set caseSensitive to false, and only the values are searched, not the names of fields.",
    "Only recorded content is checked. DropScope never sees the model's hidden context and never uses a model to judge a claim.",
  ];
  if (check.contentMode === "HASH_ONLY") notes.push("This run keeps no content (only sizes and fingerprints), so claims about content cannot be checked. Import the trace with --full to keep content in the run file; run files with content must stay on this computer.");
  if (check.counts.cannotCheck > 0) notes.push(`${check.counts.cannotCheck} claim${check.counts.cannotCheck === 1 ? "" : "s"} could not be checked. That is different from being unsupported: nothing was proved either way.`);
  return notes;
}

export const claimSummary = (check: ClaimCheckResult): string => {
  const { supported, notSupported, cannotCheck } = check.counts;
  return `${supported} supported, ${notSupported} not supported, ${cannotCheck} cannot be checked (of ${check.results.length}).`;
};

/** The whole result as lines of text for the command line. */
export function claimReportLines(check: ClaimCheckResult, titleOf: (stepId: string) => string): string[] {
  const lines: string[] = [CLAIM_NOTE, "", `Result: ${claimSummary(check)}`];
  for (const r of check.results) {
    lines.push("", `[${VERDICT_LABEL[r.verdict]}] ${r.claim.id}: ${r.claim.text}`);
    lines.push(`  ${describeClaimResult(r, titleOf, check.knownTools, check.knownToolsTotal)}`);
  }
  lines.push("", "Notes:");
  for (const note of claimCaveats(check)) lines.push(`  - ${note}`);
  return lines;
}
