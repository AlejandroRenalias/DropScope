import type { ImportErrorCode } from "./run-events.js";

// A closed error for the trace importer (spec section 12). The message is built only from the code,
// the stage and a byte position: input text is never echoed (spec 11.6).
export class ImportError extends Error {
  readonly code: ImportErrorCode;
  readonly stage: string;
  readonly position: number | null;
  // A short fixed label chosen by the importer (never input text), for example "STEP_ENDED_TWICE at event 12".
  readonly reason: string | null;

  constructor(code: ImportErrorCode, stage: string, position: number | null = null, reason: string | null = null) {
    super(`${code} at stage ${stage}${position === null ? "" : `, byte ${position}`}${reason === null ? "" : `, ${reason}`}`);
    this.reason = reason;
    this.name = "ImportError";
    this.code = code;
    this.stage = stage;
    this.position = position;
  }
}
