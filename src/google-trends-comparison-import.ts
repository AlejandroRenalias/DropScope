import { googleTrendsComparisonTerms, isGoogleTrendsComparisonPeriod, type GoogleTrendsComparisonEvidence } from "./contracts.js";

const MAX_CSV_CHARS = 32 * 1024;
const sourceUrl = "https://trends.google.com/trends/explore" as const;

export class GoogleTrendsComparisonImportError extends Error {}

export function parseGoogleTrendsComparisonCsv(csv: string): Omit<GoogleTrendsComparisonEvidence, "attemptId" | "importedAt"> {
  if (csv.length === 0 || csv.length > MAX_CSV_CHARS) throw new GoogleTrendsComparisonImportError("Comparison CSV is missing or too large.");
  const rows = parseCsv(csv.replace(/^\uFEFF/, ""));
  const headerIndex = rows.findIndex((row) => row[0] === "Week" || row[0] === "Month");
  if (headerIndex < 0) throw new GoogleTrendsComparisonImportError("Comparison CSV must contain a Week or Month timeline header.");
  const header = rows[headerIndex]!;
  if (header.length !== 4) throw new GoogleTrendsComparisonImportError("Comparison CSV must contain exactly three fixed comparison series.");
  const terms = header.slice(1).map(parseTermHeader);
  if (terms.some((term) => term === null) || terms.join("|") !== googleTrendsComparisonTerms.join("|")) {
    throw new GoogleTrendsComparisonImportError("Comparison CSV terms must match the approved comparison exactly.");
  }

  const granularity = header[0] === "Week" ? "WEEK" : "MONTH";
  const maxPoints = granularity === "WEEK" ? 53 : 13;
  const dataRows = rows.slice(headerIndex + 1).filter((row) => row.some((cell) => cell.trim().length > 0));
  if (dataRows.length === 0 || dataRows.length > maxPoints) throw new GoogleTrendsComparisonImportError("Comparison CSV has an unsupported timeline length.");
  const periods: string[] = [];
  const values = googleTrendsComparisonTerms.map(() => [] as number[]);
  for (const row of dataRows) {
    if (row.length !== 4 || !isGoogleTrendsComparisonPeriod(row[0]!.trim(), granularity)) throw new GoogleTrendsComparisonImportError("Comparison CSV contains an unsupported timeline row.");
    const period = row[0]!.trim();
    if (periods.includes(period)) throw new GoogleTrendsComparisonImportError("Comparison CSV contains duplicate timeline periods.");
    periods.push(period);
    row.slice(1).forEach((cell, index) => {
      const value = Number(cell.trim());
      if (!Number.isInteger(value) || value < 0 || value > 100) throw new GoogleTrendsComparisonImportError("Comparison CSV values must be normalized integers from 0 to 100.");
      values[index]!.push(value);
    });
  }

  return {
    sourceUrl,
    geo: "US",
    searchType: "WEB_SEARCH",
    timeframe: "PAST_12_MONTHS",
    attribution: "Google Trends",
    granularity,
    periods,
    series: googleTrendsComparisonTerms.map((term, index) => ({ term, values: values[index]! })),
  };
}

function parseTermHeader(value: string): typeof googleTrendsComparisonTerms[number] | null {
  const match = /^(.*): \(United States\)$/.exec(value.trim());
  const term = match?.[1]?.trim();
  return googleTrendsComparisonTerms.includes(term as typeof googleTrendsComparisonTerms[number]) ? term as typeof googleTrendsComparisonTerms[number] : null;
}

function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index]!;
    if (quoted) {
      if (character === '"' && csv[index + 1] === '"') { value += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else value += character;
      continue;
    }
    if (character === '"') {
      if (value.length !== 0) throw new GoogleTrendsComparisonImportError("Comparison CSV has an invalid quoted field.");
      quoted = true;
    } else if (character === ",") { row.push(value); value = ""; }
    else if (character === "\n") { row.push(value.replace(/\r$/, "")); rows.push(row); row = []; value = ""; }
    else value += character;
  }
  if (quoted) throw new GoogleTrendsComparisonImportError("Comparison CSV has an unclosed quoted field.");
  if (value.length > 0 || row.length > 0) { row.push(value); rows.push(row); }
  return rows;
}
