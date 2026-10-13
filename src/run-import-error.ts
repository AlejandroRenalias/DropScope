import type { ImportErrorCode } from "./run-events.js";

// A closed error for the trace importer (spec section 12). The message is built only from the code,
// the stage and a byte position: input text is never echoed (spec 11.6).
export class ImportError extends Error {
  readonly code: ImportErrorCode;
  readonly stage: string;
  readonly position: number | null;

  constructor(code: ImportErrorCode, stage: string, position: number | null = null) {
    super(position === null ? `${code} at stage ${stage}` : `${code} at stage ${stage}, byte ${position}`);
    this.name = "ImportError";
    this.code = code;
    this.stage = stage;
    this.position = position;
  }
}
