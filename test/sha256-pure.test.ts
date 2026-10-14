import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { paddedSize, sha256Bytes, sha256HexPure } from "../src/sha256-pure.js";

const nodeHex = (data: string | Uint8Array): string => createHash("sha256").update(data).digest("hex");

describe("sha256-pure (browser-safe SHA-256)", () => {
  it("matches the published test vectors", () => {
    expect(sha256HexPure("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256HexPure("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256HexPure("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
  });

  it("matches Node for every length around the padding boundaries", () => {
    for (let length = 0; length <= 200; length += 1) {
      const text = "x".repeat(length);
      expect(sha256HexPure(text), `length ${length}`).toBe(nodeHex(text));
    }
  });

  it("matches Node for non-ASCII text, including characters outside the first plane", () => {
    for (const text of ["café", "日本語のテキスト", "emoji 😀🚀 mixed", "a\u0000b", "\u{10FFFF}", "é vs é"]) {
      expect(sha256HexPure(text), text).toBe(nodeHex(text));
    }
  });

  it("matches Node for random bytes of many sizes and for a large input", () => {
    for (const size of [1, 55, 56, 57, 63, 64, 65, 119, 120, 128, 1000, 4096, 65_537]) {
      const bytes = new Uint8Array(randomBytes(size));
      expect(Buffer.from(sha256Bytes(bytes)).toString("hex"), `size ${size}`).toBe(nodeHex(bytes));
    }
    const big = "0123456789abcdef".repeat(64 * 1024); // 1 MiB
    expect(sha256HexPure(big)).toBe(nodeHex(big));
  });

  it("does not change its input", () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    sha256Bytes(bytes);
    expect(Array.from(bytes)).toEqual([1, 2, 3, 4, 5]);
  });

  it("computes the padded size with plain arithmetic, including sizes past 2 GiB where 32-bit shifts overflow", () => {
    for (const n of [0, 1, 54, 55, 56, 63, 64, 119, 120, 128]) expect(paddedSize(n) % 64, `n=${n}`).toBe(0);
    expect([54, 55, 56, 63, 64, 119, 120].map(paddedSize)).toEqual([64, 64, 128, 128, 128, 128, 192]);
    // Every padded size leaves room for the 0x80 byte and the 8-byte length, and is the smallest such multiple of 64.
    for (const n of [0, 55, 56, 2 ** 31 - 64, 2 ** 31 - 1, 2 ** 31, 2 ** 32 - 1, 2 ** 32, 2 ** 33 + 5]) {
      const size = paddedSize(n);
      expect(size, `n=${n}`).toBeGreaterThanOrEqual(n + 9);
      expect(size - 64, `n=${n}`).toBeLessThan(n + 9);
      expect(size % 64).toBe(0);
    }
    expect(paddedSize(2 ** 31 - 64)).toBe(2 ** 31);
  });
});
