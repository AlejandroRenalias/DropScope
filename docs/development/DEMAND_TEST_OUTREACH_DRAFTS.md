# Demand test: channels and message drafts (DRAFT, NOT RUN: skipped on 2026-10-13 because this is a learning project; nothing sent)

Companion to [`DEMAND_TEST_ONEPAGER.md`](DEMAND_TEST_ONEPAGER.md). Nothing here has been posted, sent or scheduled. The user sends every message from their own accounts, and approves each channel and each message first. The lead agent does not contact anyone.

## Ground rules for every message

1. **Ask, do not pitch.** Lead with a question about the reader's own experience. The product comes second and short.
2. **Do not use the name DropScope.** It comes from the dropshipping origin and will confuse people. Say "a small local prototype".
3. **No repository link yet.** Visibility of the repository is undecided. Offer a short written description on request.
4. **No overclaiming.** Say it is a prototype, tried only on synthetic traces. It is not a hallucination detector, and the citation check is mechanical string matching.
5. **Never ask for a raw trace.** Traces can hold prompts, tool results and secrets. Ask only about shape (framework, exporter, whether content is captured). If someone offers a trace, reply that it is not needed yet and that any future trace must be redacted with content capture off. This also follows ADR-027, which admits real traces only after the separately approved read restriction on the run folder.
6. **Check each community's rules before posting.** Many forbid self-promotion. A genuine question about practice is usually fine.
7. **Be honest about who you are.** Say it is a personal project. Do not imply a company or a user base.
8. **One follow-up at most.** Never message the same person a third time.

## Channels, in priority order

| # | Channel | Why | Notes |
| --- | --- | --- | --- |
| 1 | People the user knows who build or review agents | The strongest and cheapest signal; replies are candid | Aim for 6. Personal message, not a group post |
| 2 | [Langfuse GitHub Discussions, Ideas category](https://langfuse.com/changelog/2024-09-23-github-discussion-across-documentation) | Langfuse treats Discussions as its channel for ideas and support; the audience runs agents and tracks cost | Post as a question about practice (budgets after the fact). Read the category rules first |
| 3 | [LangChain Forum, Observability & Evals category](https://forum.langchain.com/t/about-the-observability-evals-category/14) | An existing space for observability questions from people running agents | Same question-first post |
| 4 | Maintainers of three open-source agent debuggers (agent-replay, react-agent-debugger, agent-timetravel) | They have shown that debugging agent runs matters, and know what users ask for | Short, respectful question on their public issue or discussion tracker. They are also peers working on similar ideas, so expect a careful reply and share nothing confidential. Maturity of these projects is unverified, and one of them has a burst of commits that may not reflect real use |
| 5 | OpenTelemetry GenAI SIG (the [project page](https://github.com/open-telemetry/community/blob/main/projects/gen-ai.md) should list its Slack channel and meeting; I could not confirm that from here) | These people decide how content capture and agent spans are described | Ask only the content-capture question (message D). The SIG is for spec work, so keep it brief, and skip it if the channel is off-topic |

Not recommended now: Arize Phoenix (I found no public community Slack), and general social platforms or Hacker News. A "Show HN"-style post is premature for a prototype with no release, and I have not verified the rules of those venues.

**Target:** about 15 people reached across channels 1 to 4 (6 personal, 3 maintainers, 2 forum or discussion posts that count only for named replies). Channel 5 does not count toward the 15.

## Messages

### A. Personal message (to someone you know)

> Hi [name], quick question about something you've worked on. When one of your agent runs went wrong, spent more than expected, or gave an answer you doubted, how did you figure out what happened afterwards? What did you use, and what was missing?
>
> The reason I ask: I'm exploring a small local tool (personal project, early prototype) that works from a trace file alone, with no model calls. It rebuilds the state at any step, replays a budget afterwards ("this run would have stopped at step 99 with a 1,500-token limit"), and checks whether a cited source was actually fetched during the run. I'm trying to find out whether anyone would actually use that, so honest answers, including "I wouldn't", help a lot. Two minutes of your time is plenty.

### B. Community post (Langfuse Ideas, LangChain Forum)

Title: *After a run: do you check what a budget would have done, or whether an answer's citations were really fetched?*

> I'm a solo developer exploring how people audit agent runs after the fact, and I'd like to learn from how you do it, not sell anything.
>
> Two concrete things I wonder about:
> 1. Do you ever ask "if the limit had been X, would this run have stopped, and where?" (to pick limits, or in CI), or is live enforcement enough?
> 2. For answers with citations, do you check that the cited source was actually fetched during the run, and how?
>
> I've built a small local prototype that does both from a trace file only, deterministically and with no model calls. It is only tested on synthetic traces, the citation check is just string matching (it can't tell whether a source supports a claim), and it needs prompt and tool content captured in the trace, which I know is often switched off. Would any of this be useful to you, and what would you need before trusting it? Happy to hear "no, because...".

### C. Maintainer message (public issue or discussion, question label)

> Hi, I've been reading your project, which tackles a problem I'm also looking at. A question on what you've seen from users, if you have a moment: has anyone asked for (a) replaying a budget limit against a recorded run to see where it would have stopped, or (b) a deterministic check that an answer's citations match sources the run actually fetched? Or are people mostly asking for replay, diff and fork? I'm a solo developer deciding where to spend effort, so even "nobody asks for that" is a useful answer. Thanks for building this.

### D. OpenTelemetry GenAI SIG question

> Question about practice rather than spec: for people who analyze GenAI traces after the fact, how common is it in your experience that prompt and tool content is captured at all, and through which channel (span attributes versus separate log events)? I'm building a local tool that reads OTLP/JSON traces and wants to be honest about what it can and cannot check when content is absent. A pointer to existing guidance or data is enough.

### E. One follow-up (after 5 days, only if no reply)

> Hi [name], one gentle nudge on my question above. A one-line answer is great, including "never needed that". Either way, thanks.

### F. Reply when someone is interested

> Thanks, that helps. I don't need a trace yet, and please don't send one that contains prompts, tool results or anything you wouldn't post publicly. What would help instead: which framework or exporter you use, whether you capture message and tool content, and the size of a typical run. If this goes further, any trace I ask for would be redacted with content off, and I'd tell you exactly what the tool stores first.

### G. Reply to "isn't this like Phoenix, Langfuse, LangSmith or Laminar?"

> Fair question. Replay, diff and fork are covered well by those tools, and I'm not trying to compete there. What I haven't found elsewhere is replaying a budget policy against a finished run, and a reproducible (byte-identical) import that someone else can re-check. If you know of tools that already do that, I'd like to hear about them.

### H. Closing a thread

> Thanks for the honest answer. Very useful.

## Tracking sheet (one row per person or post; keep outside the repository if it contains names)

Columns: date sent, channel, person or post, message used, reply received (Y/N), builds or reviews agents (Y/N), uses a trace format (which), captures content (Y/N/unsure), interest in budget replay (none, maybe, would try), interest in citation check (none, maybe, would try), would share a redacted trace later (Y/N), notes (their words, quoted), follow-up sent (Y/N).

## Schedule (about one week)

| Day | Action |
| --- | --- |
| 0 | The user approves channels and messages, edited as wanted |
| 1 | Send the 6 personal messages and the 3 maintainer messages |
| 2 | Post B in channels 2 and 3, and D if channel 5 fits |
| 5 | Send message E to non-responders, once |
| 7 | Tally against the decision rule in `DEMAND_TEST_ONEPAGER.md` Part 2 and report |

## Proposed change to the decision rule (needs the user's approval)

Part 2 of the one-pager counts "at least 2 actually send or run one" among the signals. That conflicts with the privacy rule above, because real traces are not admitted yet. Proposed replacement: count a person as strong signal if they **name a concrete use** (for example choosing budget limits, a CI gate, or reviewing an incident) and **agree to share a redacted trace later**. The thresholds stay the same: at least 5 replies, at least 3 saying they would try it, and at least 2 strong signals, with at least 2 of those naming budget replay or citation checking.
