# ADR-025: Virtual Role-Based Staffing Evaluation

## Status

Accepted for Phase 5.6 with the user's approval. This decision is limited to the local evaluation harness.

## Decision

DropScope adds three fixed virtual staffing plans to the evaluation harness: one generalist, a two-agent research/operations-risk pair, and a four-agent specialist team. Each virtual agent has an explicit closed set of existing task roles and may run one recorded task attempt at a time.

The evaluator consumes the existing fixed mission trace at scheduler capacity three. It preserves that trace's task-attempt order, dependencies, retry ordering, simulated delays, and fixed decision context, then derives a staffing-constrained logical latency for each plan. It never invokes a real worker, adds an event, writes a product mission history, changes the scheduler, or changes task assignment, budget, ranking, gate, recommendation, or browser behavior.

## Consequences

The evaluation CLI may compare virtual-agent count and role coverage against the same fixed mission outputs. Its conclusions are staffing-model simulations only; they must not be presented as measured human/real-agent performance or as a product-runtime configuration change. Real role-based assignment, dynamic staffing, new worker roles, or any effect on mission decisions requires a separate approved ADR.
