import { describe, expect, it } from "vitest";
import { buildComparisonTimelinePath } from "../src/frontend/google-trends-comparison-timeline.js";

describe("Google Trends comparison timeline", () => {
  it("builds deterministic normalized paths", () => {
    expect(buildComparisonTimelinePath([0, 50, 100])).toBe("M8.00 138.00 L260.00 75.00 L512.00 12.00");
    expect(buildComparisonTimelinePath([42])).toBe("M260.00 85.08");
  });

  it("returns no path for an empty series", () => {
    expect(buildComparisonTimelinePath([])).toBe("");
  });
});
