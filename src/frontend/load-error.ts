import { ImportError } from "../run-import-error.js";

/** Turns anything that went wrong while opening a run file into a sentence. Input text is never repeated. */
export function explainLoadError(error: unknown): string {
  if (error instanceof ImportError) {
    if (error.reason?.startsWith("UNSUPPORTED_SCHEMA_VERSION")) return "This run file uses a format version this build does not support.";
    if (error.reason?.startsWith("CONTENT_NOT_WITHHELD") || error.reason?.startsWith("WITHHELD_IN_FULL_RUN")) return "This file claims to hide its content but does not: it was changed after it was saved, so it was not opened.";
    return `This is not a valid DropScope run file (${error.code}${error.reason ? `, ${error.reason}` : ""}). Create one with the import command.`;
  }
  return "This file could not be read as a run file.";
}
