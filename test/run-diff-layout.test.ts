import { describe, expect, it } from "vitest";
import type { DiffItem } from "../src/run-diff.js";
import { FOLD_FROM, ROW_LIMIT, foldEntries, limitEntries } from "../src/frontend/run-diff-layout.js";

const item = (status: DiffItem["status"]): DiffItem => ({ status, a: null, b: null, changes: [] });
const items = (...statuses: Array<DiffItem["status"] | [DiffItem["status"], number]>): DiffItem[] =>
  statuses.flatMap((s) => (Array.isArray(s) ? Array.from({ length: s[1] }, () => item(s[0])) : [item(s)]));
const drawnRows = (shown: ReturnType<typeof limitEntries>["shown"]): number =>
  shown.reduce((n, e) => n + (e.kind === "row" ? 1 : e.drawn), 0);

describe("run diff layout: folding", () => {
  it("folds runs of matching steps and keeps single ones as rows", () => {
    const entries = foldEntries(items("same", "changed", [ "same", 3 ], "onlyA", "same", "same"));
    expect(entries.map((e) => (e.kind === "row" ? `row:${e.item.status}` : `fold:${e.items.length}`))).toEqual(["row:same", "row:changed", "fold:3", "row:onlyA", "fold:2"]);
    expect(FOLD_FROM).toBe(2);
  });

  it("gives every step its own index and the fold the index of its first step", () => {
    const entries = foldEntries(items("changed", [ "same", 2 ], "onlyB"));
    expect(entries.map((e) => (e.kind === "row" ? e.index : e.start))).toEqual([0, 1, 3]);
    const fold = entries[1];
    expect(fold.kind === "fold" && fold.items.map((x) => x.index)).toEqual([1, 2]);
  });
});

describe("run diff layout: the row cap", () => {
  it("draws everything when it fits, with fold lines closed and free", () => {
    const { shown, hidden } = limitEntries(foldEntries(items("changed", [ "same", 50 ], "changed")), new Set());
    expect(hidden).toBe(0);
    expect(shown).toHaveLength(3);
    expect(drawnRows(shown)).toBe(2);
  });

  it("stops at the cap and reports what is not drawn, exactly at the boundary", () => {
    const exact = limitEntries(foldEntries(items([ "changed", ROW_LIMIT ])), new Set());
    expect(drawnRows(exact.shown)).toBe(ROW_LIMIT);
    expect(exact.hidden).toBe(0);
    const over = limitEntries(foldEntries(items([ "changed", ROW_LIMIT + 1 ])), new Set());
    expect(drawnRows(over.shown)).toBe(ROW_LIMIT);
    expect(over.hidden).toBe(1);
  });

  it("applies the cap to the steps inside an opened group (5,000 matching steps)", () => {
    const entries = foldEntries(items([ "same", 5000 ]));
    const closed = limitEntries(entries, new Set());
    expect(drawnRows(closed.shown)).toBe(0);
    expect(closed.hidden).toBe(0);
    const opened = limitEntries(entries, new Set([0]));
    expect(drawnRows(opened.shown)).toBe(ROW_LIMIT);
    expect(opened.hidden).toBe(5000 - ROW_LIMIT);
    const fold = opened.shown[0];
    expect(fold.kind === "fold" && [fold.total, fold.drawn]).toEqual([5000, ROW_LIMIT]);
  });

  it("shares one budget between rows and opened groups, and counts later rows and groups as hidden", () => {
    const entries = foldEntries(items([ "changed", 100 ], [ "same", 400 ], "changed", [ "same", 10 ], "onlyA"));
    const { shown, hidden } = limitEntries(entries, new Set([100, 501]), 300);
    expect(drawnRows(shown)).toBe(300);
    // 100 rows, then 200 of the 400 in the opened group; the rest of that group, one row, the second opened group and one row are hidden.
    expect(hidden).toBe(200 + 1 + 10 + 1);
  });

  it("a closed fold line after the budget is spent is hidden and counted", () => {
    const entries = foldEntries(items([ "changed", 3 ], [ "same", 4 ]));
    const { shown, hidden } = limitEntries(entries, new Set(), 3);
    expect(drawnRows(shown)).toBe(3);
    expect(shown).toHaveLength(3);
    expect(hidden).toBe(4);
  });
});
