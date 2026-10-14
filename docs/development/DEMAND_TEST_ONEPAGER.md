# Demand test: one-pager (DRAFT, NOT RUN: skipped on 2026-10-13 because this is a learning project; kept for reuse)

Part 1 is the text to show to people. Part 2 is internal and must not be shown. Nothing here has been posted or sent.

## Part 1: text to show

### Can you prove what your agent run spent, saw and claimed, from the trace alone?

We are exploring a small local tool for people who build or review AI agent runs. You give it a trace file (OpenTelemetry GenAI, OTLP/JSON). It makes no model calls and sends nothing anywhere. It does three things:

1. **Rebuilds the recorded state at any step.** Open and finished steps, tokens used so far, errors, and which content was captured. Importing the same file twice gives byte-identical output, and the totals are checked against the trace's own numbers.
2. **Replays a budget afterwards.** "If the limit had been 1,500 input tokens, this run would have stopped at event 99 of 248, step `chat`, with 3,896 further tokens avoided." This is a counterfactual, not enforcement.
3. **Checks citations against what the run actually captured.** For each `[S3]`-style citation in the final answer, was a source with that id present in the captured tool outputs? This is mechanical only. It cannot tell whether a source supports a claim, and it needs message and tool content to be captured, which is often switched off.

Everything above ran on synthetic traces from OpenTelemetry instrumentation (OpenAI client, OpenLLMetry, OpenAI Agents SDK) pointed at a local stub model. It has not been tried on a real production trace. It is a prototype, not a product, and not a hallucination detector.

Replay, run diffing and forking already exist in tools such as Phoenix, Langfuse, LangSmith, Laminar and several open-source debuggers. We are asking only about the three things above.

### Questions (a one-line answer to any is useful)

1. When did you last need to explain what a run spent or why it did something, after the fact? What did you do?
2. Do you capture prompt and tool content in your traces, or is it off? Why?
3. Would you run this on one of your own traces? Which framework or exporter?
4. Is "would this budget have stopped the run?" something you would use, for example to choose limits or in CI?
5. What would you need to see before trusting a citation check?
6. What is missing that would make you drop it immediately?

## Part 2: internal plan (do not show)

**Goal.** Decide, before any product-direction ADR, between the auditor direction and the hybrid (a decision-research product where tribunal, review and policy are the point and replay is the front end).

**Who to ask (suggestions, the user chooses):** people the user knows who build agents; the maintainers and users of the open-source debuggers found in the competitor check, through their public discussion channels; communities for agent builders. Outreach is an outward-facing action and needs the user's explicit approval for each channel and each message.

**Decision rule, fixed in advance.** Counting only people who build or review agent runs, among about 15 reached:
- **Auditor direction supported** if at least 5 reply, at least 3 say they would try it on a real trace, and at least 2 actually send or run one, with at least 2 naming budget replay or citation checking as the reason.
- **Hybrid** if interest centers on judging the quality of findings (review, opposing cases, policy) rather than on reproducibility.
- **Neither** if fewer than 2 reply with real interest after one week. Then reconsider the whole direction.

**Caveats.** Politeness inflates interest; "would try" is weaker than "sent me a trace". A small, self-selected sample cannot size a market. Treat a clear negative as more informative than a positive.

**Timebox.** About one week of calendar time, with at most one day of the lead agent's effort.
