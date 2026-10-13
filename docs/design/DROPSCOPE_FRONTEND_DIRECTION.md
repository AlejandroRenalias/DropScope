# DropScope Frontend Direction

Status: approved by the owner on 2026-10-13. This replaces the earlier illustrated pixel-office direction (see git history for the retired version). It governs presentation only; product architecture, policies and the engine are unchanged.

## 1. Direction

A modern, light research tool: white and cool-grey surfaces, near-navy text, and one strong cobalt blue for the brand and primary actions. The page leads with the finding, keeps the evidence, budget and event history one glance away, and labels everything honestly (synthetic fixture, recorded replay, not market research). Personality comes from confident type and one bold blue panel. There is no illustrated agent or pixel art.

## 2. Principles

1. **Finding first.** The newest recorded finding is the most prominent element on the Research Office screen, with its owner and a provenance link.
2. **Truthful labels.** Every screen says what it is: synthetic demo, recorded replay, or live local mission. Never imply market research that did not happen.
3. **One accent.** Cobalt means brand, links, selection and the primary action. It never means a task state.
4. **Plain words.** Labels describe what happened ("Evidence research started"), not mood.
5. **Readable first.** Body text 16px, labels never below 13px, AA contrast for all text. Event numbers and units are information, not decoration.
6. **Derived state only.** The UI renders replayed engine state and cannot bypass engine policies.

## 3. Palette

| Token | Value | Use |
|---|---|---|
| `--brand` | `#1D4ED8` | Primary actions, links, selection, the hero finding panel |
| `--brand-strong` | `#1E40AF` | Hover and pressed |
| `--brand-tint` | `#EAF0FF` | Selected rows, subtle fills |
| `--ink` | `#0F172A` | Primary text, optional dark accent |
| `--muted` | `#475569` | Secondary text |
| `--canvas` | `#F5F7FB` | Page background |
| `--surface` | `#FFFFFF` | Cards and panels |
| `--rule` | `#E2E8F0` | Dividers and borders |
| `--success` | `#15803D` | Completed |
| `--warning` | `#B45309` | Needs attention, awaiting decision |
| `--danger` | `#B91C1C` | Blocked, failed, conflict |
| `--waiting` | `#64748B` | Waiting, not started |

State is always shown by colour plus an icon or word, never colour alone. Colours are CSS variables so a dark theme later is a token swap. Text on the cobalt panel is white or `#DCE6FF` only. Contrast is verified when built.

## 4. Type and shape

- **Type:** IBM Plex Sans for text and IBM Plex Mono for IDs and event numbers. Large display size only for the finding headline and the page title.
- **Shape:** 8px radius cards, 1px rules instead of heavy shadows, 4px spacing grid. Square corners only for the hero finding panel.
- **Motion:** minimal; focus rings and short state transitions, respecting reduced motion.

## 5. Research Office layout

**Top section (slim bar plus stage stepper).** One 56px bar: logo, the six screens, and a "Mission controls" menu on the right. Below it, the title row with a status chip, and a horizontal four-step progress track (Researching, Debating, Reviewing, Report) with connectors; the current step is filled in cobalt. The synthetic or replay notice is one thin banner under the stepper.

```
[logo] Research Office  Agent Desk  Tribunal  Review  Report  Replay      [Mission controls v]
Crosscurrent Workspace Market   (Recorded replay - event 15)
(1 Researching)----(2 Debating)----(3 Reviewing)----(4 Report)
Synthetic demo, recorded replay. Illustrative inputs, not market research.
```

**Budget and activity (no permanent right rail).** A one-line ledger under the title: a stacked bar of spent, committed and reserved against the total, with the numbers and the free amount. Activity is a collapsible timeline card below the finding, showing the latest five events with "All events" to expand.

```
Budget  [########||||||.........]  Spent 25 - Committed 50 - Reserved 0 - Free 65 of 140
```

**Screen order, top to bottom**

1. Top bar and title with stepper.
2. One-line ledger.
3. **Finding panel:** full-width cobalt block, white text, headline, owner, task ID and "View provenance".
4. **Research tasks:** a simple list with state badges; show the dependency graph only with three or more tasks.
5. **Inputs in perspective:** candidate score table with exact fixture values, neutral bars, and the "No ranking implied" note.
6. Activity timeline.
7. Footer provenance note.

The other five screens (Agent Desk, Tribunal Room, Review Office, Final Report, Mission Replay) use the same tokens and components and are polished after the Research Office.

## 6. Responsive and accessibility

- Breakpoints 1280, 768 and 375. At 768 the stepper stays; at 375 it becomes "Step 1 of 4" with a menu.
- Keyboard order follows reading order; visible focus rings in `--brand`.
- Status never relies on colour alone; interactive targets are at least 40px tall.
- Verify with the Playwright overflow checks and a contrast check before accepting snapshots.

## 7. Process

- Visual snapshots are regenerated only after the image diffs are reviewed with the owner.
- No product-policy, engine or contract changes.
- Anything not specified here follows the principles above.
