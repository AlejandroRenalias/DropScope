// SHA-256 and byte-wise comparison for run identities (spec 3.2). Node only. The canonical JSON serializer
// lives in canonical-json.ts so that browser code can use it without Node modules.
import { createHash } from "node:crypto";

export { canonicalJson } from "./canonical-json.js";

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

// Compares two strings by their UTF-8 bytes (used where the spec orders by serialization bytes).
export function compareUtf8(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}
