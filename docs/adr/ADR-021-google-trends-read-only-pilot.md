# ADR-021: Google Trends Read-only Source Pilot

## Status

Accepted for Phase 4.1 source-contract design with the user's approval of Google Trends as the first public source. No product fetch is enabled by this decision alone.

## Decision

The first public-web source may be a single read-only Google Trends **Trending now** capture for the fixed United States scope. A future adapter may contact only the fixed `https://trends.google.com/trending/rss?geo=US` endpoint, with no cookies, login, search term, browser history, account, proxy, or user-supplied URL.

A capture must require a separate visible browser action. It may make one request, use a fixed short timeout and response-size ceiling, retain at most ten normalized trend labels and traffic buckets, record the fixed URL, `US` scope, UTC retrieval time, and Google Trends attribution in a replay-safe event, then terminate. It has no polling, retry, background refresh, worker prompt, subscription usage, API fallback, or automatic follow-on task.

Google Trends is an aggregated, sampled and normalized search-interest signal. It is not demand, sales, a scientific poll, or a decision by itself. A captured signal must be labeled as one source among others, and its source URL and attribution remain visible wherever it is projected.

## Evidence and privacy boundary

The adapter accepts no browser-provided source URL, term, location, cookie, credential, account data, or free-form text. It persists only the bounded captured source fields needed for replay and explicitly excludes raw XML, headers, IP addresses, cookies, browser state, provider errors, and network diagnostics. A malformed, oversized, unavailable, or invalid response records a closed failure outcome without partial evidence.

## Consequences

The next implementation slice must add a fixed `google-trends-pilot` mission, a strict source-result schema, reducer validation, local loopback route, browser projection, fake-backed tests, and manual E2E coverage. It must not run an actual capture during automated tests. A later user action remains required to make the first actual source request.

## Sources

- [Google Trends: Export, embed, and cite Trends data](https://support.google.com/trends/answer/4365538)
- [Google Trends FAQ about data](https://support.google.com/trends/answer/4365533)
