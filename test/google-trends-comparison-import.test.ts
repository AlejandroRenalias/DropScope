import { describe, expect, it } from "vitest";
import { googleTrendsComparisonEvidenceSchema } from "../src/contracts.js";
import { GoogleTrendsComparisonImportError, parseGoogleTrendsComparisonCsv } from "../src/google-trends-comparison-import.js";

const validCsv = `Category: All categories
Week,desk cable organizer: (United States),under-desk cable tray: (United States),cable management box: (United States)
2026-01-04,12,24,36
2026-01-11,18,30,42`;

describe("Google Trends manual comparison CSV parser", () => {
  it("retains only the fixed normalized comparison snapshot", () => {
    expect(parseGoogleTrendsComparisonCsv(validCsv)).toEqual({
      sourceUrl: "https://trends.google.com/trends/explore",
      geo: "US",
      searchType: "WEB_SEARCH",
      timeframe: "PAST_12_MONTHS",
      attribution: "Google Trends",
      granularity: "WEEK",
      periods: ["2026-01-04", "2026-01-11"],
      series: [
        { term: "desk cable organizer", values: [12, 18] },
        { term: "under-desk cable tray", values: [24, 30] },
        { term: "cable management box", values: [36, 42] },
      ],
    });
  });

  it.each([
    ["an unapproved term", validCsv.replace("cable management box", "cable sleeve")],
    ["an out-of-range value", validCsv.replace("18,30,42", "101,30,42")],
    ["a mixed-granularity period", validCsv.replace("2026-01-11", "2026-01")],
    ["an impossible calendar date", validCsv.replace("2026-01-11", "2026-02-31")],
    ["an impossible calendar month", validCsv.replace("2026-01-11", "2026-13-01")],
    ["an unexpected extra series", validCsv.replace("\n2026-01-04", ",extra\n2026-01-04")],
  ])("rejects %s", (_label, csv) => {
    expect(() => parseGoogleTrendsComparisonCsv(csv)).toThrow(GoogleTrendsComparisonImportError);
  });

  it("rejects impossible calendar periods at the durable event boundary too", () => {
    const evidence = { attemptId: "google-trends-us-comparison:a1", importedAt: "2026-01-12T00:00:00.000Z", ...parseGoogleTrendsComparisonCsv(validCsv) };
    expect(googleTrendsComparisonEvidenceSchema.safeParse({ ...evidence, periods: ["2026-02-31", "2026-01-11"] }).success).toBe(false);
  });
});
