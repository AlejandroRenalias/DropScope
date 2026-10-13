// Canonical compact JSON and SHA-256 for run identities (spec 3.2).
// Object keys are sorted by UTF-16 code unit; arrays keep their order; no whitespace.
// The serializer is iterative: untrusted structure never grows the call stack.
import { createHash } from "node:crypto";

export function canonicalJson(root: unknown): string {
  const out: string[] = [];
  // Work items are either literal text to append or a value still to serialize.
  const work: Array<{ text: string } | { value: unknown }> = [{ value: root }];
  while (work.length > 0) {
    const item = work.pop() as { text: string } | { value: unknown };
    if ("text" in item) {
      out.push(item.text);
      continue;
    }
    const value = item.value;
    if (value === null || value === undefined) {
      out.push("null");
    } else if (typeof value === "string") {
      out.push(JSON.stringify(value));
    } else if (typeof value === "number") {
      out.push(Object.is(value, -0) ? "-0" : JSON.stringify(value));
    } else if (typeof value === "boolean") {
      out.push(value ? "true" : "false");
    } else if (typeof value === "bigint") {
      out.push(value.toString());
    } else if (Array.isArray(value)) {
      out.push("[");
      work.push({ text: "]" });
      for (let i = value.length - 1; i >= 0; i -= 1) {
        work.push({ value: value[i] });
        if (i > 0) work.push({ text: "," });
      }
    } else {
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record).filter((k) => record[k] !== undefined).sort();
      out.push("{");
      work.push({ text: "}" });
      for (let i = keys.length - 1; i >= 0; i -= 1) {
        work.push({ value: record[keys[i]] });
        work.push({ text: `${JSON.stringify(keys[i])}:` });
        if (i > 0) work.push({ text: "," });
      }
    }
  }
  return out.join("");
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

// Compares two strings by their UTF-8 bytes (used where the spec orders by serialization bytes).
export function compareUtf8(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}
