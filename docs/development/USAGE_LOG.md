# Development Usage Log

Record exact credits only when visible; do not invent unavailable credits or token counts. For new entries, record the proxy metrics below so the first three issues using this workflow can be evaluated as a measured pilot.

| Date | Issue/task | Agent role | Model / effort | Worker runs | Implementation attempts | Review cycles | CI runs | Exact usage / credits | Outcome | Escalation reason | Extra model work changed outcome |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- | --- |
| YYYY-MM-DD |  | Active Commander / worker / reviewer |  |  |  |  |  | Not visible |  |  | yes / no / not required |
| 2026-08-28 | #1 async scheduler | Active Commander | Terra / current settings | Not recorded | 2 | 1 | Not recorded | Not visible | Reviewer findings addressed; awaiting CI and final review | Scheduler event durability and budget admission | Pending |
| 2026-08-28 | #5 four-state budget ledger | Active Commander + independent reviewer | Terra / current settings | Not recorded | 1 | 1 | Not recorded | Not visible | Merged in PR #6 | None | Yes — confirmed lifecycle, replay, and rejection coverage |
| 2026-08-28 | #7 mandatory budget protection | Active Commander + independent reviewer | Terra / current settings | Not recorded | 1 | 2 | Not recorded | Not visible | Merged in PR #8 | None | Yes — caught and resolved a flaky timestamp assertion |
| 2026-08-28 | #9 Commander task authorization | Active Commander + independent reviewer | Terra / current settings | Not recorded | 1 | 2 | Not recorded | Not visible | Merged in PR #10 | None | Yes — caught scheduler and duplicate-key authorization bypasses |
| 2026-08-28 | #11 authoritative gap register | Active Commander | Terra / current settings | Not recorded | 1 | Not recorded | Not recorded | Not visible | Merged in PR #12 | None | Not recorded before merge |
