import { describe, expect, it } from "vitest";
import { FixedGoogleTrendsSource, GoogleTrendsSourceError, parseGoogleTrendsRss } from "../src/google-trends-source.js";

const rss = `<?xml version="1.0"?><rss><channel><item><title><![CDATA[Desk lamps]]></title><ht:approx_traffic xmlns:ht="urn:test">20K+</ht:approx_traffic></item><item><title>Standing desks</title><ht:approx_traffic xmlns:ht="urn:test">10K+</ht:approx_traffic></item></channel></rss>`;

describe("fixed Google Trends source", () => {
  it("requests only the fixed anonymous US RSS endpoint and normalizes at most ten labels", async () => {
    const calls: unknown[] = [];
    const source = new FixedGoogleTrendsSource(async (url, init) => { calls.push([url, init]); return { ok: true, text: async () => rss }; });
    await expect(source.capture()).resolves.toEqual({ sourceUrl: "https://trends.google.com/trending/rss?geo=US", geo: "US", attribution: "Google Trends", items: [{ query: "Desk lamps", traffic: "20K+" }, { query: "Standing desks", traffic: "10K+" }] });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject(["https://trends.google.com/trending/rss?geo=US", { headers: { accept: "application/rss+xml, application/xml;q=0.9" } }]);
  });

  it("rejects malformed or unsafe XML without exposing its body", () => {
    expect(() => parseGoogleTrendsRss("<!DOCTYPE rss><rss />")).toThrow(GoogleTrendsSourceError);
    expect(() => parseGoogleTrendsRss("<rss><channel /></rss>")).toThrow(GoogleTrendsSourceError);
  });

  it("closes HTTP failures as an unavailable source", async () => {
    const source = new FixedGoogleTrendsSource(async () => ({ ok: false, text: async () => "ignored" }));
    await expect(source.capture()).rejects.toMatchObject({ outcome: "UNAVAILABLE" });
  });
});
