# ADR-022: Google Trends Manual Comparison Import

## Status

Accepted for Phase 4.4 with the user's approval. This decision adds no automatic source request.

## Context

ADR-021 admits one fixed US Trending Now RSS capture and explicitly rejects search-term input. DropScope now needs one bounded way to inspect relative search interest for a user-approved product comparison without using an undocumented Google endpoint, a login, a worker, or a background source request.

## Decision

The comparison is a distinct `google-trends-comparison-pilot`, separate from ADR-021's RSS pilot. Its only admitted comparison is these three ordinary Google Trends **search terms** (not Topics):

1. `desk cable organizer`
2. `under-desk cable tray`
3. `cable management box`

The user manually creates a Google Trends Explore comparison with US, Web Search, and past 12 months selected, then exports the Interest over time chart as CSV. DropScope may accept one explicit local-browser import action only. It never constructs or contacts a Google URL, opens a browser, invokes a worker, sends a subscription request, stores the raw CSV, or accepts arbitrary terms, locations, time ranges, source URLs, or free-form evidence.

The import parser accepts only a bounded UTF-8 CSV whose series headers identify exactly the three fixed terms in the United States and whose index values are normalized integers from 0 through 100. It persists only the fixed source label, US scope, Web Search / past-12-month declaration, UTC import time, and one uniform timeline of at most fifty-three weekly or thirteen monthly periods with three normalized series. It rejects unexpected columns, duplicated or missing terms, malformed CSV, unsupported periods, mixed granularity, out-of-range values, and oversized input. The raw file and parser errors are not persisted.

The persisted event is local evidence context only. It must be replayable, visible on Agent Desk, Mission Replay, and Final Report, and explicitly state that it changes no candidate score, ranking, safety gate, or recommendation. The import completes a one-task local pilot with no retry, polling, background refresh, automatic follow-up, or fallback.

## Consequences

Phase 4.4 must add a separate fixture, strict event schema and reducer admission, loopback import route, bounded local parser, browser file-selection flow, projections, fake CSV tests, and browser E2E. Automated tests use fixture CSV only and never contact Google. The existing ADR-021 RSS pilot and its source adapter remain unchanged.

## Sources

- [Google Trends: Compare Trends search terms](https://support.google.com/trends/answer/4359550)
- [Google Trends: Compare search terms and topics](https://support.google.com/trends/answer/17309543)
- [Google Trends: Export, embed, and cite Trends data](https://support.google.com/trends/answer/4365538)
- [Google Trends FAQ about data](https://support.google.com/trends/answer/4365533)
