# Holdout Fixture Result

## Purpose

`crosscurrent-workspace-market` is DropScope's Fixture D holdout. It was authored after the original engine, policy thresholds, commander policy, and reviewer rubric were frozen. Its job is to check whether the existing generic engine handles previously unseen fixture data without a fixture-specific orchestration or policy change.

This is a software-generalization check. It is not market research, a demand forecast, or a product recommendation.

## Recorded Result

The focused holdout test passed locally on 2026-09-20:

```powershell
npm.cmd test -- test/fixture-runner.test.ts
```

It ran 14 tests successfully, including the unseen-fixture assertion. The assertion runs the standard fixture runner; it does not start a browser, live worker, subscription runtime, or Google request.

| Check | Fixed result |
| --- | --- |
| Terminal state | `COMPLETED` with one final `MissionCompleted` event. |
| Task graph | All four fixed tasks complete through the generic dependency scheduler. |
| Retry path | `workflow-interviews:a1` records a deterministic transient failure; `workflow-interviews:a2` completes as the permitted retry. |
| Recorded-worker provenance | The retry records `RECORDED_DRY_RUN` with provider usage `NOT_APPLICABLE`; no live worker or provider credit is claimed. |
| Risk gates | Four candidates are held out by the fixed rejected, restricted, or manual-review gates. |
| Ranked output | The allowed fixed ranking is `deskflow-alpha`, `deskflow-beta`, then `deskflow-gamma`. |

## What This Demonstrates

- The fixture can be processed by the frozen scheduler, reducer, risk gate, eligibility, report, and quality pipeline without adding a special-case code path.
- A deterministic retry and recorded dry-run provenance survive the normal event history.
- High candidate scores do not bypass the fixed risk and evidence gates.
- The result is reproducible from source-controlled fixture data and test assertions.

## What This Does Not Demonstrate

- Real customer demand, competitor conditions, pricing, supply feasibility, safety, legal compliance, or profitability.
- The quality of a live worker, a paid model, an external data source, or a Google Trends signal.
- That a different fixture or future policy revision will have the same result.

If the holdout ever requires a policy or orchestration change to pass, record that outcome rather than retuning the fixture to hide it. The frozen-engine criterion is defined in [the architecture baseline](architecture/DROPSCOPE_ARCHITECTURE_BASELINE_V1.md).
