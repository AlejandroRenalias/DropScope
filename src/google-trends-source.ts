const GOOGLE_TRENDS_RSS_URL = "https://trends.google.com/trending/rss?geo=US";
const MAX_RESPONSE_BYTES = 256 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_ITEMS = 10;

export type GoogleTrendsCaptureFailure = "UNAVAILABLE" | "TIMED_OUT" | "INVALID_RESPONSE" | "RESPONSE_TOO_LARGE";
export class GoogleTrendsSourceError extends Error {
  constructor(readonly outcome: GoogleTrendsCaptureFailure) { super(`Google Trends capture ${outcome.toLowerCase()}.`); }
}

export interface GoogleTrendsCapture {
  sourceUrl: typeof GOOGLE_TRENDS_RSS_URL;
  geo: "US";
  attribution: "Google Trends";
  items: Array<{ query: string; traffic: string }>;
}

export interface GoogleTrendsSource { capture(): Promise<GoogleTrendsCapture>; }
export type FetchLike = (input: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<{ ok: boolean; text(): Promise<string> }>;

/** Fixed, anonymous, read-only source adapter. It never accepts a URL or query. */
export class FixedGoogleTrendsSource implements GoogleTrendsSource {
  constructor(private readonly fetchLike: FetchLike = globalThis.fetch.bind(globalThis) as FetchLike) {}

  async capture(): Promise<GoogleTrendsCapture> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      let response: Awaited<ReturnType<FetchLike>>;
      try {
        response = await this.fetchLike(GOOGLE_TRENDS_RSS_URL, { signal: controller.signal, headers: { accept: "application/rss+xml, application/xml;q=0.9" } });
      } catch (error) {
        if (controller.signal.aborted) throw new GoogleTrendsSourceError("TIMED_OUT");
        throw new GoogleTrendsSourceError("UNAVAILABLE");
      }
      if (!response.ok) throw new GoogleTrendsSourceError("UNAVAILABLE");
      let xml: string;
      try { xml = await response.text(); } catch { throw new GoogleTrendsSourceError("UNAVAILABLE"); }
      if (Buffer.byteLength(xml, "utf8") > MAX_RESPONSE_BYTES) throw new GoogleTrendsSourceError("RESPONSE_TOO_LARGE");
      return { sourceUrl: GOOGLE_TRENDS_RSS_URL, geo: "US", attribution: "Google Trends", items: parseGoogleTrendsRss(xml) };
    } finally { clearTimeout(timer); }
  }
}

export function parseGoogleTrendsRss(xml: string): Array<{ query: string; traffic: string }> {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new GoogleTrendsSourceError("INVALID_RESPONSE");
  const items = [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].slice(0, MAX_ITEMS).map((match) => {
    const body = match[1]!;
    const title = readTag(body, "title");
    const traffic = readTag(body, "ht:approx_traffic");
    if (!title || !traffic || title.length > 160 || traffic.length > 80) throw new GoogleTrendsSourceError("INVALID_RESPONSE");
    return { query: title, traffic };
  });
  if (items.length === 0) throw new GoogleTrendsSourceError("INVALID_RESPONSE");
  return items;
}

function readTag(xml: string, tag: string): string | null {
  const match = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i").exec(xml);
  if (!match) return null;
  const value = match[1]!.replace(/^<!\[CDATA\[|\]\]>$/g, "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
  return value || null;
}

export { GOOGLE_TRENDS_RSS_URL, MAX_ITEMS };
