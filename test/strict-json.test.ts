import { describe, expect, it } from "vitest";
import { ImportError } from "../src/run-import-error.js";
import { DEFAULT_JSON_LIMITS, isJsonNumber, parseStrictJson, type JsonObject } from "../src/strict-json.js";

const enc = (text: string) => new TextEncoder().encode(text);
const parse = (text: string | Uint8Array, limits = DEFAULT_JSON_LIMITS) =>
  parseStrictJson(typeof text === "string" ? enc(text) : text, "parse", limits);
const codeOf = (text: string | Uint8Array, limits = DEFAULT_JSON_LIMITS): string | null => {
  try {
    parse(text, limits);
    return null;
  } catch (error) {
    if (error instanceof ImportError) return error.code;
    throw error;
  }
};

describe("strict JSON: accepted input", () => {
  it("parses every value kind and keeps member order", () => {
    const value = parse(' {"b": [1, "x", true, false, null, {}], "a": []} ') as JsonObject;
    expect([...value.keys()]).toEqual(["b", "a"]);
    const list = value.get("b") as unknown[];
    expect(list.length).toBe(6);
    expect(list[1]).toBe("x");
    expect(list[4]).toBeNull();
    expect(list[5]).toBeInstanceOf(Map);
  });

  it("keeps number lexemes as text, without rounding", () => {
    const list = parse("[9007199254740993, -0, 1e400, 0.10, 1E+2]") as { lexeme: string }[];
    expect(list.map((n) => n.lexeme)).toEqual(["9007199254740993", "-0", "1e400", "0.10", "1E+2"]);
    expect(isJsonNumber(list[0] as never)).toBe(true);
  });

  it("decodes escapes, surrogate pairs and raw UTF-8", () => {
    expect(parse('"a\\n\\u00e9\\ud83d\\ude00/\\/é😀"')).toBe("a\né😀//é😀");
  });

  it("keeps __proto__ as an ordinary key", () => {
    const value = parse('{"__proto__": {"polluted": true}}') as JsonObject;
    expect(value.has("__proto__")).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("accepts nesting exactly at the depth limit", () => {
    expect(codeOf("[".repeat(64) + "]".repeat(64))).toBeNull();
  });
});

describe("strict JSON: rejected input", () => {
  it("rejects a BOM, empty input, trailing bytes and trailing commas", () => {
    expect(codeOf(new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d]))).toBe("E_SYNTAX");
    expect(codeOf("")).toBe("E_SYNTAX");
    expect(codeOf("   ")).toBe("E_SYNTAX");
    expect(codeOf("{} x")).toBe("E_SYNTAX");
    expect(codeOf("{}{}")).toBe("E_SYNTAX");
    expect(codeOf("[1,]")).toBe("E_SYNTAX");
    expect(codeOf('{"a":1,}')).toBe("E_SYNTAX");
    expect(codeOf("[1 2]")).toBe("E_SYNTAX");
  });

  it("rejects duplicate property names, including ones hidden by escapes", () => {
    expect(codeOf('{"a":1,"a":2}')).toBe("E_SYNTAX");
    expect(codeOf('{"a":1,"\\u0061":2}')).toBe("E_SYNTAX");
    expect(codeOf('{"x":{"a":1},"y":{"a":1}}')).toBeNull();
  });

  it("rejects malformed numbers, literals, strings and escapes", () => {
    for (const bad of ["01", "1.", ".5", "+1", "-", "1e", "NaN", "tru", "nul", "'a'", '"a', '"\\x"', '"\\u12"', '"\u0001"', "{1:2}", '{"a" 1}']) {
      expect(codeOf(bad), bad).toBe("E_SYNTAX");
    }
  });

  it("rejects invalid UTF-8 and unpaired surrogates", () => {
    expect(codeOf(new Uint8Array([0x22, 0xff, 0x22]))).toBe("E_UNICODE");
    expect(codeOf(new Uint8Array([0x22, 0xc0, 0xaf, 0x22]))).toBe("E_UNICODE");
    expect(codeOf(new Uint8Array([0x22, 0xed, 0xa0, 0x80, 0x22]))).toBe("E_UNICODE");
    expect(codeOf('"\\ud800"')).toBe("E_UNICODE");
    expect(codeOf('"\\ud800x"')).toBe("E_UNICODE");
    expect(codeOf('"\\udc00"')).toBe("E_UNICODE");
    expect(codeOf('"\\ud800\\u0041"')).toBe("E_UNICODE");
  });

  it("reports a byte position and never echoes the input", () => {
    try {
      parse('{"secret-token-123": tru}');
      expect.unreachable();
    } catch (error) {
      expect((error as ImportError).position).toBe(24);
      expect((error as Error).message).not.toContain("secret");
    }
  });
});

describe("strict JSON: limits", () => {
  it("rejects nesting one past the depth limit, and survives extreme nesting without recursion", () => {
    expect(codeOf("[".repeat(65) + "]".repeat(65))).toBe("E_LIMIT");
    expect(codeOf("[".repeat(5_000_000))).toBe("E_LIMIT");
    expect(codeOf('{"a":'.repeat(1_000_000))).toBe("E_LIMIT");
  });

  it("enforces the byte, node, element, key, string and number limits", () => {
    const small = { ...DEFAULT_JSON_LIMITS };
    expect(codeOf("[1,2,3]", { ...small, maxBytes: 6 })).toBe("E_LIMIT");
    expect(codeOf("[1,2,3]", { ...small, maxNodes: 3 })).toBe("E_LIMIT");
    expect(codeOf("[1,2,3]", { ...small, maxNodes: 4 })).toBeNull();
    expect(codeOf("[1,2,3]", { ...small, maxElements: 2 })).toBe("E_LIMIT");
    expect(codeOf('{"a":1,"b":2}', { ...small, maxElements: 1 })).toBe("E_LIMIT");
    expect(codeOf('{"abcd":1}', { ...small, maxKeyBytes: 3 })).toBe("E_LIMIT");
    expect(codeOf('"abcdef"', { ...small, maxStringBytes: 4 })).toBe("E_LIMIT");
    expect(codeOf("123456", { ...small, maxNumberLexeme: 5 })).toBe("E_LIMIT");
  });

  it("parses a large flat document in reasonable time", () => {
    const text = "[" + Array.from({ length: 100_000 }, (_, i) => `{"k":"v${i}"}`).join(",") + "]";
    const started = performance.now();
    expect((parse(text) as unknown[]).length).toBe(100_000);
    expect(performance.now() - started).toBeLessThan(3000);
  });
});
