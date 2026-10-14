// Which rows the run diff card draws. Pure, so the limits are testable without a browser.
// Matching steps in a row (FOLD_FROM or more) fold into one line. A cap on drawn rows applies to everything the
// card draws, including the steps inside a group the user opened, so a huge run cannot flood the page.
import type { DiffItem } from "../run-diff.js";

/** Rows drawn in the side-by-side list; a run can have thousands of steps. */
export const ROW_LIMIT = 300;
/** A run of this many matching steps in a row is folded into one line you can open. */
export const FOLD_FROM = 2;

export type IndexedItem = { item: DiffItem; index: number };
export type Entry = { kind: "row"; item: DiffItem; index: number } | { kind: "fold"; start: number; items: IndexedItem[] };
/** What is drawn: a row, or a fold line with the number of its steps drawn (0 while it is closed). */
export type Shown = { kind: "row"; item: DiffItem; index: number } | { kind: "fold"; start: number; total: number; drawn: number; items: IndexedItem[] };

export function foldEntries(items: readonly DiffItem[]): Entry[] {
  const all: Entry[] = [];
  let run: IndexedItem[] = [];
  const flush = (): void => {
    if (run.length >= FOLD_FROM) all.push({ kind: "fold", start: run[0].index, items: run });
    else for (const r of run) all.push({ kind: "row", ...r });
    run = [];
  };
  items.forEach((item, index) => {
    if (item.status === "same") run.push({ item, index });
    else { flush(); all.push({ kind: "row", item, index }); }
  });
  flush();
  return all;
}

/**
 * Applies the row cap. Every drawn step row counts one against `limit`; a fold line is free. When a group is open
 * but the cap runs out inside it, only the first steps are drawn (`drawn < total`). `hidden` counts the steps and
 * rows that are not drawn, so the card can say so.
 */
export function limitEntries(entries: readonly Entry[], open: ReadonlySet<number>, limit: number = ROW_LIMIT): { shown: Shown[]; hidden: number } {
  const shown: Shown[] = [];
  let budget = limit;
  let hidden = 0;
  for (const entry of entries) {
    if (entry.kind === "row") {
      if (budget > 0) { shown.push(entry); budget -= 1; } else hidden += 1;
    } else if (open.has(entry.start)) {
      const drawn = Math.min(entry.items.length, budget);
      shown.push({ kind: "fold", start: entry.start, total: entry.items.length, drawn, items: entry.items });
      budget -= drawn;
      hidden += entry.items.length - drawn;
    } else if (budget > 0) {
      shown.push({ kind: "fold", start: entry.start, total: entry.items.length, drawn: 0, items: entry.items });
    } else hidden += entry.items.length;
  }
  return { shown, hidden };
}
