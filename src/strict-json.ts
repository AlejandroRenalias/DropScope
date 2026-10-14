// Strict JSON parser for untrusted trace files (spec sections 1.1, 1.2 and 10).
// - Works on bytes, so error positions are byte offsets and invalid UTF-8 is detected exactly.
// - Iterative: nesting never grows the call stack, so a deeply nested file cannot crash it.
// - Rejects a BOM, trailing bytes, trailing commas, duplicate property names and unpaired surrogates.
// - Keeps number lexemes as text (JsonNumber); the importer validates them later (spec 1.3).
// - Enforces the limits while scanning, before values are built.
import { ImportError } from "./run-import-error.js";

export type JsonNumber = { readonly kind: "number"; readonly lexeme: string };
// Objects are Maps so keys like "__proto__" are plain data and member order is kept.
export type JsonObject = Map<string, JsonValue>;
export type JsonValue = null | boolean | string | JsonNumber | JsonValue[] | JsonObject;

export type JsonLimits = {
  maxBytes: number;
  maxDepth: number;
  maxNodes: number;
  maxElements: number;
  maxKeyBytes: number;
  maxStringBytes: number;
  maxNumberLexeme: number;
};

// Spec section 10 (provisional). Per-import totals across files are enforced by the caller.
export const DEFAULT_JSON_LIMITS: JsonLimits = {
  maxBytes: 32 * 1024 * 1024,
  maxDepth: 64,
  maxNodes: 2_000_000,
  maxElements: 100_000,
  maxKeyBytes: 1024,
  maxStringBytes: 8 * 1024 * 1024,
  maxNumberLexeme: 256,
};

const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

type Frame =
  | { kind: "array"; items: JsonValue[] }
  | { kind: "object"; members: JsonObject; key: string };

export function isJsonNumber(value: JsonValue): value is JsonNumber {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Map);
}

export function parseStrictJson(bytes: Uint8Array, stage: string, limits: JsonLimits = DEFAULT_JSON_LIMITS): JsonValue {
  return parseStrictJsonCounted(bytes, stage, limits).value;
}

// Also reports how many nodes were parsed, so a caller can share one node budget across several files.
export function parseStrictJsonCounted(
  bytes: Uint8Array, stage: string, limits: JsonLimits = DEFAULT_JSON_LIMITS,
): { value: JsonValue; nodes: number } {
  const fail = (code: "E_SYNTAX" | "E_UNICODE" | "E_LIMIT", at: number): never => {
    throw new ImportError(code, stage, at);
  };
  if (bytes.length > limits.maxBytes) fail("E_LIMIT", limits.maxBytes);
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) fail("E_SYNTAX", 0);

  const length = bytes.length;
  let pos = 0;
  let nodes = 0;

  const countNode = (): void => {
    nodes += 1;
    if (nodes > limits.maxNodes) fail("E_LIMIT", pos);
  };
  const skipWhitespace = (): void => {
    while (pos < length) {
      const c = bytes[pos];
      if (c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09) pos += 1;
      else break;
    }
  };
  const decode = (start: number, end: number): string => {
    try {
      return utf8.decode(bytes.subarray(start, end));
    } catch {
      return fail("E_UNICODE", start);
    }
  };
  const hexAt = (at: number): number => {
    if (at + 4 > length) fail("E_SYNTAX", at);
    let value = 0;
    for (let i = 0; i < 4; i += 1) {
      const c = bytes[at + i];
      let digit: number;
      if (c >= 0x30 && c <= 0x39) digit = c - 0x30;
      else if (c >= 0x41 && c <= 0x46) digit = c - 0x41 + 10;
      else if (c >= 0x61 && c <= 0x66) digit = c - 0x61 + 10;
      else return fail("E_SYNTAX", at + i);
      value = value * 16 + digit;
    }
    return value;
  };

  // Reads a string starting at the opening quote; leaves pos after the closing quote.
  const readString = (maxBytes: number): string => {
    const open = pos;
    pos += 1;
    const parts: string[] = [];
    let segment = pos;
    for (;;) {
      if (pos >= length) fail("E_SYNTAX", open);
      if (pos - open > maxBytes) fail("E_LIMIT", open);
      const c = bytes[pos];
      if (c === QUOTE) {
        parts.push(decode(segment, pos));
        pos += 1;
        return parts.length === 1 ? parts[0] : parts.join("");
      }
      if (c < 0x20) fail("E_SYNTAX", pos);
      if (c !== BACKSLASH) {
        pos += 1;
        continue;
      }
      parts.push(decode(segment, pos));
      const e = bytes[pos + 1];
      pos += 2;
      switch (e) {
        case 0x22: parts.push('"'); break;
        case 0x5c: parts.push("\\"); break;
        case 0x2f: parts.push("/"); break;
        case 0x62: parts.push("\b"); break;
        case 0x66: parts.push("\f"); break;
        case 0x6e: parts.push("\n"); break;
        case 0x72: parts.push("\r"); break;
        case 0x74: parts.push("\t"); break;
        case 0x75: {
          const unit = hexAt(pos);
          pos += 4;
          if (unit >= 0xd800 && unit <= 0xdbff) {
            // A high surrogate must be followed by an escaped low surrogate.
            if (bytes[pos] !== BACKSLASH || bytes[pos + 1] !== 0x75) fail("E_UNICODE", pos);
            const low = hexAt(pos + 2);
            if (low < 0xdc00 || low > 0xdfff) fail("E_UNICODE", pos);
            pos += 6;
            parts.push(String.fromCharCode(unit, low));
          } else if (unit >= 0xdc00 && unit <= 0xdfff) {
            fail("E_UNICODE", pos - 4);
          } else {
            parts.push(String.fromCharCode(unit));
          }
          break;
        }
        default:
          fail("E_SYNTAX", pos - 1);
      }
      segment = pos;
    }
  };

  const isDigit = (c: number | undefined): boolean => c !== undefined && c >= 0x30 && c <= 0x39;
  const readNumber = (): JsonNumber => {
    const start = pos;
    if (bytes[pos] === 0x2d) pos += 1;
    if (bytes[pos] === 0x30) pos += 1;
    else if (isDigit(bytes[pos])) while (isDigit(bytes[pos])) pos += 1;
    else fail("E_SYNTAX", pos);
    if (bytes[pos] === 0x2e) {
      pos += 1;
      if (!isDigit(bytes[pos])) fail("E_SYNTAX", pos);
      while (isDigit(bytes[pos])) pos += 1;
    }
    if (bytes[pos] === 0x65 || bytes[pos] === 0x45) {
      pos += 1;
      if (bytes[pos] === 0x2b || bytes[pos] === 0x2d) pos += 1;
      if (!isDigit(bytes[pos])) fail("E_SYNTAX", pos);
      while (isDigit(bytes[pos])) pos += 1;
    }
    if (pos - start > limits.maxNumberLexeme) fail("E_LIMIT", start);
    return { kind: "number", lexeme: String.fromCharCode(...bytes.subarray(start, pos)) };
  };

  const readLiteral = (word: string, value: null | boolean): null | boolean => {
    for (let i = 0; i < word.length; i += 1) {
      if (bytes[pos + i] !== word.charCodeAt(i)) fail("E_SYNTAX", pos + i);
    }
    pos += word.length;
    return value;
  };

  const stack: Frame[] = [];
  let root: JsonValue = null;

  // Attaches a finished value to its parent, or makes it the root.
  const complete = (value: JsonValue): void => {
    const top = stack[stack.length - 1];
    if (top === undefined) {
      root = value;
      return;
    }
    if (top.kind === "array") {
      if (top.items.length >= limits.maxElements) fail("E_LIMIT", pos);
      top.items.push(value);
    } else {
      if (top.members.size >= limits.maxElements) fail("E_LIMIT", pos);
      top.members.set(top.key, value);
    }
  };

  const pushContainer = (frame: Frame): void => {
    if (stack.length >= limits.maxDepth) fail("E_LIMIT", pos);
    stack.push(frame);
  };

  // States: reading a value, reading an object key, or reading what follows a finished value.
  let state: "value" | "key" | "after" = "value";
  let finished = false;
  while (!finished) {
    if (state === "value") {
      skipWhitespace();
      if (pos >= length) fail("E_SYNTAX", pos);
      const c = bytes[pos];
      countNode();
      if (c === 0x7b) {
        pos += 1;
        skipWhitespace();
        if (bytes[pos] === 0x7d) {
          if (stack.length >= limits.maxDepth) fail("E_LIMIT", pos);
          pos += 1;
          complete(new Map());
          state = "after";
        } else {
          pushContainer({ kind: "object", members: new Map(), key: "" });
          state = "key";
        }
      } else if (c === 0x5b) {
        pos += 1;
        skipWhitespace();
        if (bytes[pos] === 0x5d) {
          if (stack.length >= limits.maxDepth) fail("E_LIMIT", pos);
          pos += 1;
          complete([]);
          state = "after";
        } else {
          pushContainer({ kind: "array", items: [] });
        }
      } else {
        let value: JsonValue;
        if (c === QUOTE) value = readString(limits.maxStringBytes);
        else if (c === 0x2d || isDigit(c)) value = readNumber();
        else if (c === 0x74) value = readLiteral("true", true);
        else if (c === 0x66) value = readLiteral("false", false);
        else if (c === 0x6e) value = readLiteral("null", null);
        else return fail("E_SYNTAX", pos);
        complete(value);
        state = "after";
      }
    } else if (state === "key") {
      skipWhitespace();
      if (bytes[pos] !== QUOTE) fail("E_SYNTAX", pos);
      const keyStart = pos;
      const key = readString(limits.maxKeyBytes);
      skipWhitespace();
      if (bytes[pos] !== 0x3a) fail("E_SYNTAX", pos);
      pos += 1;
      const top = stack[stack.length - 1] as Extract<Frame, { kind: "object" }>;
      if (top.members.has(key)) fail("E_SYNTAX", keyStart);
      top.key = key;
      state = "value";
    } else {
      skipWhitespace();
      const top = stack[stack.length - 1];
      if (top === undefined) {
        // The root value is complete; anything left over is trailing bytes.
        if (pos < length) fail("E_SYNTAX", pos);
        finished = true;
      } else {
        const c = bytes[pos];
        if (c === 0x2c) {
          pos += 1;
          state = top.kind === "object" ? "key" : "value";
        } else if ((c === 0x5d && top.kind === "array") || (c === 0x7d && top.kind === "object")) {
          pos += 1;
          stack.pop();
          complete(top.kind === "array" ? top.items : top.members);
        } else {
          fail("E_SYNTAX", pos);
        }
      }
    }
  }
  return { value: root, nodes };
}
