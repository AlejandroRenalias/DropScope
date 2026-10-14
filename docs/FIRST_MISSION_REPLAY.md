# First Mission Replay

> **Note.** This page describes the original mission replay. DropScope now centers on agent run forensics: start with the [README](../README.md) and the [guided tour](GUIDED_TOUR.md).

This five-minute walkthrough uses `crosscurrent-workspace-market`, a fixed local fixture. Its candidates, evidence, timing, and outcome are synthetic or recorded teaching inputs—not market research or a product recommendation.

## Start the Local Mission

Follow [the installation guide](INSTALLATION.md) to start the loopback runtime and browser interface. In the browser's **Local runtime** control strip:

1. Choose `crosscurrent-workspace-market`.
2. Select **Launch local mission**.
3. Wait for the runtime message to confirm completion.

This path runs the local deterministic scheduler. It does not contact Google, start a live worker, use a subscription, or make a purchase.

## What to Notice

### 1. Agent Desk: work and provenance

Open **Agent Desk**. The four fixed tasks represent market, evidence, operations, and risk work. One evidence task has a deterministic transient failure and retry; that shows that the scheduler owns retry and budget handling rather than a worker.

The recorded evidence task is labeled **Recorded dry-run**. That label means the result came from the fixed local adapter, not a live worker or provider-credit use. The mission usage summary shows the replayed local ledger separately.

### 2. Final Report: decisions are gated

Open **Final Report**. Some high-scoring candidates are held out because safety or evidence gates apply. The key idea is that eligibility is decided before ranking: a strong number does not override a gate.

The report's priorities and review verdict are fixed outputs of this fixture. They demonstrate how the engine records a decision; they do not recommend a product to sell.

### 3. Review Office: challenge and revision

Open **Review Office**. The initial blind review records a revision request, and the fixture's later focused re-review records the response. This illustrates that a ranking can be challenged and corrected with durable events instead of quietly changing a result.

### 4. Mission Replay: rebuild from history

Open **Mission Replay**. Move the **Position** slider backward and forward, or select an event's **Inspect** button. The projected office, budget, tasks, and review state are rebuilt from the valid event prefix at that position.

The filter buttons only change the event list. They never modify the saved mission. Select **Reload saved mission** or refresh the browser to see the same local history reconstructed again.

## The One-Sentence Mental Model

DropScope saves an ordered local event history; every screen is a read-only view rebuilt from that history.

For other fixed missions and the separately guarded pilots, see the [synthetic fixture catalog](SYNTHETIC_FIXTURES.md).
