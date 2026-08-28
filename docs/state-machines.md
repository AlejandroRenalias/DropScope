# DropScope State Machines

**Status:** Architecture Baseline v1

## 1. Authority

- Task lifecycle is authoritative for scheduling.
- Attempt lifecycle is authoritative for one execution attempt.
- Mission phase is a projection and never authorizes or blocks tasks.
- Terminal mission state is authoritative.
- Illegal-transition requests append `TransitionRejected`; they do not append the requested transition and do not mutate domain state.

## 2. Task states

```text
CREATED
WAITING_DEPENDENCIES
AUTHORIZED
RUNNING
COMPLETED
FAILED_TRANSIENT
FAILED_PERMANENT
INTERRUPTED
CANCELLED
REJECTED_POLICY
```

## 3. Legal task transitions

| From | To | Condition |
|---|---|---|
| CREATED | WAITING_DEPENDENCIES | Task has incomplete dependencies |
| CREATED | AUTHORIZED | No dependencies and authorization passes |
| CREATED | REJECTED_POLICY | Policy rejects before authorization |
| CREATED | CANCELLED | Mission terminal or task withdrawn |
| WAITING_DEPENDENCIES | AUTHORIZED | Dependencies complete and authorization passes |
| WAITING_DEPENDENCIES | REJECTED_POLICY | Policy rejects |
| WAITING_DEPENDENCIES | CANCELLED | Dependency permanently prevents work or mission terminates |
| AUTHORIZED | RUNNING | Attempt starts and reserved budget becomes committed |
| AUTHORIZED | CANCELLED | Authorization withdrawn before start |
| RUNNING | COMPLETED | Current running attempt submits valid completion |
| RUNNING | FAILED_TRANSIENT | Current attempt fails transiently |
| RUNNING | FAILED_PERMANENT | Current attempt fails permanently |
| RUNNING | INTERRUPTED | Recovery finds no terminal event for running attempt |
| RUNNING | CANCELLED | Explicit cancellation completes |
| FAILED_TRANSIENT | AUTHORIZED | Retry or compatible reassignment allowed and budget passes |
| FAILED_TRANSIENT | CANCELLED | Retry unavailable, declined, or unaffordable |
| FAILED_PERMANENT | AUTHORIZED | Compatible different worker reassignment allowed |
| FAILED_PERMANENT | CANCELLED | No reassignment; unresolved gap recorded |
| INTERRUPTED | AUTHORIZED | Mission recovery restart available and budget passes |
| INTERRUPTED | CANCELLED | Recovery cap reached or restart unaffordable |

Terminal task states for a particular task execution path are `COMPLETED`, `CANCELLED`, and `REJECTED_POLICY`. Failure and interruption states may authorize a new attempt only through the explicit transitions above.

## 4. Attempt states

```text
CREATED
AUTHORIZED
RUNNING
COMPLETED
FAILED_TRANSIENT
FAILED_PERMANENT
INTERRUPTED
CANCELLED
REJECTED_POLICY
```

Each attempt is immutable after entering a terminal attempt state. Retry, reassignment, or recovery always creates a new attempt.

## 5. Legal attempt transitions

| From | To |
|---|---|
| CREATED | AUTHORIZED |
| CREATED | REJECTED_POLICY |
| CREATED | CANCELLED |
| AUTHORIZED | RUNNING |
| AUTHORIZED | CANCELLED |
| RUNNING | COMPLETED |
| RUNNING | FAILED_TRANSIENT |
| RUNNING | FAILED_PERMANENT |
| RUNNING | INTERRUPTED |
| RUNNING | CANCELLED |

Any completion delivered when the attempt is not `RUNNING` produces `StaleCompletionIgnored`.

## 6. Mission phase projection

The UI may display:

```text
PLANNING
RESEARCHING
DEBATING
AUDITING
REVIEWING
REVISING
REPORTING
TERMINAL
```

Phase is calculated from events, active tasks, and mandatory pipeline state. It is not a linear state machine and has no authority over task admission. Concurrent work may make more than one descriptive phase plausible; the projection uses a documented display priority only.

Suggested display priority:

```text
TERMINAL > REVISING > REVIEWING > AUDITING > DEBATING > RESEARCHING > PLANNING
```

This priority is presentation only.

### Legal projected phase changes

The projection observed between consecutive event-history prefixes must match one of these changes or remain unchanged:

| From | May project to |
|---|---|
| PLANNING | RESEARCHING, TERMINAL |
| RESEARCHING | DEBATING, AUDITING, REVISING, TERMINAL |
| DEBATING | RESEARCHING, AUDITING, TERMINAL |
| AUDITING | RESEARCHING, REVIEWING, REVISING, TERMINAL |
| REVIEWING | RESEARCHING, REVISING, REPORTING, TERMINAL |
| REVISING | RESEARCHING, AUDITING, REVIEWING, TERMINAL |
| REPORTING | REVIEWING, TERMINAL |
| TERMINAL | TERMINAL |

These are validation rules for the phase projection, not authorization rules for tasks.

## 7. Terminal mission states

```text
COMPLETED
COMPLETED_INSUFFICIENT_EVIDENCE
BLOCKED_POLICY
BLOCKED_BUDGET
FAILED_UNRECOVERABLE
```

### COMPLETED

At least one allowed candidate cleared the evidence gates, required quality stages completed, and publication is authorized.

### COMPLETED_INSUFFICIENT_EVIDENCE

Zero allowed candidates cleared the gates after baseline research and all permitted actionable gap resolution completed, exhausted, or was declined. No relevant authorized task remains in flight.

### BLOCKED_POLICY

A mission-wide policy constraint prevents a valid report.

### BLOCKED_BUDGET

The mandatory pipeline cannot complete under remaining budget and an increase was unavailable or declined.

### FAILED_UNRECOVERABLE

Corrupt non-final history, exhausted recovery, or another engine failure prevents trustworthy continuation.

No new task may be authorized after a terminal mission event.
