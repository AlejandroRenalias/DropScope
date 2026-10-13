# Working principles (lessons to reuse on other projects)

Short rules that came out of real work on this repository. They are advisory guidance for the lead agent and the user, not product policy. They cannot replace, waive or widen the approval and review rules in `AGENTS.md` and `DEVELOPMENT_WORKFLOW.md`; where they seem to conflict, those rules win. For example, "a first pass, not a verdict" never means a required review finding may be left unresolved, and "ask before outward-facing actions" does not turn routine read-only fetches from GitHub into approval requests.

## 1. Check demand before building, when the goal is a product

Origin: the 2026-10-13 forensics pivot. Before writing any code, the lead agent proposed a cheap demand test: ask a handful of people who would use the thing, then decide. The user liked the approach and wants it reused.

- **When it applies:** the project is meant to be used by other people, or the user is deciding whether to invest days or weeks.
- **When to skip:** the project is a learning project or personal experiment, where the experience is the goal. Say so out loud and skip it (this repository chose that on 2026-10-13). The user decides.
- **How, cheaply:**
  1. Write down the decision the test informs (build, change direction, or stop) and what each answer would change.
  2. Check what already exists first (existing tools, their docs and their communities), before asking anyone.
  3. Ask questions about the person's own practice, not about the idea. Lead with a question, keep the pitch short, and be honest about being a prototype.
  4. Fix the decision rule in advance (how many replies, what counts as strong interest) so enthusiasm does not rewrite it afterwards.
  5. Never collect sensitive data to run the test. Ask about shape, not raw material.
  6. Timebox it (about a week of calendar time and at most a day of effort), and treat a clear "no" as more informative than a polite "yes".
  7. The user sends every message from their own accounts and approves each channel and message first.
- Worked example: `DEMAND_TEST_ONEPAGER.md` and `DEMAND_TEST_OUTREACH_DRAFTS.md` (drafted, not run).

## 2. Spike before specifying, and keep the evidence honest

Prove the riskiest assumption in a throwaway experiment first (here: can a foreign trace be imported deterministically?). Then say exactly what the experiment did and did not show. Two independent reviews found that overstated evidence is as damaging as a missing feature.

## 3. Specify testable things as code, not prose

Prose specifications drew a new round of findings on every review. Keep the decision record short (what and why) and move exact rules into schemas and tests as early as possible.

## 4. Independent review is a first pass, not a verdict

Reviewers disagree in detail and agree on themes. Verify each claim against the code yourself, group findings by theme, fix them together, and cap the number of review rounds when the work is not yet approved for implementation.

## 5. Ask before every outward-facing action

Pushes, posts, messages and anything that leaves the machine need the user's explicit approval for that exact thing. A hook or a notification is not approval.

## 6. Write for a beginner

The user is new to software engineering. Explaining things as if to a 20-year veteran wastes their time and hides decisions from them. Use plain words, define each term when it first appears, lead with the conclusion, and put a plain-language summary above any technical document they must approve. The enforceable version is in `AGENTS.md`, section "Communication with the user".
