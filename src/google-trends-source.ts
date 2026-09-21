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
export type FetchResponse = { ok: boolean; body: ReadableStream<Uint8Array> | null };
export type FetchLike = (input: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<FetchResponse>;

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
      const xml = await readBoundedBody(response.body, controller.signal);
      return { sourceUrl: GOOGLE_TRENDS_RSS_URL, geo: "US", attribution: "Google Trends", items: parseGoogleTrendsRss(xml) };
    } finally { clearTimeout(timer); }
  }
}

async function readBoundedBody(body: ReadableStream<Uint8Array> | null, signal: AbortSignal): Promise<string> {
  if (!body) throw new GoogleTrendsSourceError("INVALID_RESPONSE");
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const next = await readWithAbort(reader, signal);
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        throw new GoogleTrendsSourceError("RESPONSE_TOO_LARGE");
      }
      chunks.push(next.value);
    }
  } catch (error) {
    if (error instanceof GoogleTrendsSourceError) throw error;
    if (signal.aborted) throw new GoogleTrendsSourceError("TIMED_OUT");
    throw new GoogleTrendsSourceError("UNAVAILABLE");
  } finally { void reader.cancel().catch(() => undefined); reader.releaseLock(); }
  const combined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.byteLength; }
  try { return new TextDecoder("utf-8", { fatal: true }).decode(combined); }
  catch { throw new GoogleTrendsSourceError("INVALID_RESPONSE"); }
}

async function readWithAbort(reader: ReadableStreamDefaultReader<Uint8Array>, signal: AbortSignal): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (signal.aborted) throw new GoogleTrendsSourceError("TIMED_OUT");
  let rejectAbort: ((reason: GoogleTrendsSourceError) => void) | undefined;
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const onAbort = () => rejectAbort?.(new GoogleTrendsSourceError("TIMED_OUT"));
  signal.addEventListener("abort", onAbort, { once: true });
  try { return await Promise.race([reader.read(), aborted]); }
  finally { signal.removeEventListener("abort", onAbort); }
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
