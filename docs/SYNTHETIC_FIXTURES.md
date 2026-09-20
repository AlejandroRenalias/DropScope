# Synthetic Fixture Catalog

DropScope fixtures are fixed local inputs for exercising the same orchestration engine under different conditions. They are teaching and regression artifacts, not product recommendations, market research, or commercial evidence.

## Deterministic Learning Fixtures

| Fixture ID | What it demonstrates | Expected learning result |
| --- | --- | --- |
| `mixed-opportunity-market` | A small market-learning task graph with demand and risk dependencies. | How dependency order shapes a normal mission. |
| `evidence-drought` | Insufficient evidence for a candidate. | A mission can stop without forcing a recommendation. |
| `safety-ambiguity` | Risk and evidence-completeness branches across several candidates. | Eligibility is a policy gate, not a ranking preference. |
| `crosscurrent-workspace-market` | Parallel work, a deterministic transient retry, recorded dry-run provenance, audit, blind review, divergence, and revision. | The full event and quality loop can be replayed after completion. |
| `failure-autopsy-pilot` | A fixed concept that cannot clear its evidence and safety pressure. | A defensible STOP conclusion records what evidence could change it. |
| `product-investigation-pilot` | One eligible fixed priority with automatic adversarial context. | Opportunity investigation can retain caution without changing the fixed ranking policy. |

The evaluation command uses the final three rows to compare task capacity and virtual staffing:

```powershell
npm.cmd run evaluate
```

## Guarded Boundary Pilots

These IDs are deliberately narrow tests of separate boundaries. They are not required for normal local learning or evaluation.

| Fixture ID | Boundary under test | Important limit |
| --- | --- | --- |
| `live-worker-pilot` | A separately guarded local live-worker path. | It is not part of standard startup or unattended execution. |
| `google-trends-pilot` | A user-triggered Google Trends capture boundary. | It does not run automatically, poll, or retry. |
| `google-trends-comparison-pilot` | A user-selected CSV import for the fixed comparison terms. | The normalized import is unscored context and does not alter rankings, gates, or recommendations. |

## Run a Fixture Locally

1. Follow [the installation guide](INSTALLATION.md) to start the loopback runtime and browser interface.
2. In the browser’s **Local runtime** control strip, choose one of the deterministic learning fixtures.
3. Select **Launch local mission** and explore the Agent Desk, Final Report, and Mission Replay views.
4. Refresh the browser or select **Reload saved mission** to observe event-derived reconstruction.

For a first tour, use `crosscurrent-workspace-market`: it shows a retry, quality review, revision, final report, and saved replay without requiring an external request or a real worker.

## Fixture Boundaries

- Fixture names, candidate details, evidence, delays, and outcomes are synthetic or recorded for this project.
- Changing fixture data tests the engine; it does not validate a real market or predict demand.
- Fixed fixtures do not grant new permissions. A fixture cannot authorize network access, subscription use, publication, spending, or any action outside the runtime’s approved boundaries.
- The source definitions live in [`src/fixture-model.ts`](../src/fixture-model.ts). Runtime behavior remains governed by the validated contracts, scheduler, reducer, and policies.
