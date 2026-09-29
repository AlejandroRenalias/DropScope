# DropScope Frontend Direction

**Status:** Current - Editorial Command Desk with approved Single Mission Brief refinement

**Original decision date:** 2026-09-07

**Superseding decision date:** 2026-09-22

**Cross-surface propagation approval:** 2026-09-23

**Scope:** Visual language and interaction character across all six current frontend surfaces
**Does not change:** Product behavior, engine policy, event contracts, permissions, or the frozen interface surfaces

## 0. Superseding direction: Editorial Command Desk

The Editorial Command Desk direction replaces the robot-centered emphasis described in the historical Milestone 1B sections below. Those sections remain useful for state, accessibility, and product-boundary requirements, but this section takes precedence for composition and visual hierarchy.

Reading this as a dense research command center for a serious solo operator, with an editorial intelligence-workbench language and a restrained operational character layer.

Approved design dials:

- `DESIGN_VARIANCE: 7` - asymmetric hierarchy without sacrificing scan speed;
- `MOTION_INTENSITY: 3` - interaction feedback and real state animation only;
- `VISUAL_DENSITY: 7` - compact daily-use information without generic dashboard cards.

The visual system uses warm near-black surfaces, paper-white typography, a single signal-orange accent, sharp two-pixel corners, sparse dividers, and tabular monospace for identifiers and measured values. Green, amber, and red remain semantic colors for success, warning, and failure only.

Pixel robots remain original operational signatures inside the Research Office. They are compact supporting characters, not the primary identity of the application. Evidence, provenance, policy, budget, review, and report information must dominate every surface.

The application frame uses a compact horizontal workspace navigation and command ribbon. Research Office, Agent Desk, Tribunal Room, Review Office, Final Report, and Mission Replay each receive a composition suited to their work rather than sharing one repeated card grid.

The event-derived boundary remains unchanged:

> JSONL events -> engine reducer -> frontend projection -> React views

No frontend component may become a second source of truth or acquire policy authority. The redesign changes presentation and internal component organization only.

### 0.1 Single Mission Brief refinement

The approved follow-up reduces the command-desk treatment to a calmer mission-first hierarchy. Its design dials are `DESIGN_VARIANCE: 6`, `MOTION_INTENSITY: 2`, and `VISUAL_DENSITY: 6`.

- The global shell keeps the six primary navigation labels but gives runtime setup one compact `Mission controls` disclosure instead of a permanently dominant ribbon.
- Mission identity is presented as a brief: one title, one source statement, a compact provenance line, and one phase summary.
- Research Office established the accepted proof direction. `Current work` is a continuous row-based assignment sheet, robots are 48-64 pixel operational signatures, dependencies continue beneath the work list, and ledger plus recent activity form a secondary 8+4 context rail.
- Borders communicate section changes rather than boxing every object. Signal orange is limited to brand, selection, and high-value orientation cues; semantic green, amber, and red continue to describe real state only.
- Desktop content is capped near 1440 pixels. At narrow widths the rail follows the primary brief, navigation remains horizontally usable, identifiers wrap safely, and action targets remain touch-sized.
- The accepted hierarchy now applies across all six surfaces. Agent Desk separates bounded actions from the event-derived evidence ledger; Tribunal Room frames opposing arguments beneath a dominant verdict; Review Office reads as a ranked defect sheet; Final Report reads as a decision document; and Mission Replay pairs a sticky control rail with event chronology and a distinct projected snapshot.

## 1. Design read

Reading this as a desktop-first research operations product for a solo AI-native builder, with a professional retro-futurist control-room language, an expressive pixel-art robot layer, and a modern accessible product interface.

Initial design dials:

- `DESIGN_VARIANCE: 6` - distinctive and spatial, but organized
- `MOTION_INTENSITY: 4` - visible activity and feedback without constant movement
- `VISUAL_DENSITY: 6` - operationally useful without becoming a cramped cockpit

The intended balance is approximately:

- 70% professional research application
- 20% pixel-art atmosphere and character
- 10% playful motion

These percentages describe design emphasis, not a mechanical scoring formula.

## 2. Core visual idea

DropScope is a living research command center presented as a friendly illustrated office. It is not a generic SaaS dashboard and it is not a management game.

The user gives a research organization a mission and watches the Commander and specialists execute it. The interface must make the real system understandable: who is working, what they are doing, which work can happen concurrently, what evidence exists, what failed, where agents disagree, and how the budget is being used.

Use this separation consistently:

> Pixel art belongs to agents, the office environment, and activity visualization. Modern product UI belongs to information, navigation, controls, evidence, and reports.

The pixel layer must communicate real state. It must not be decorative mascots pasted onto ordinary dashboard cards.

## 3. Atmosphere

The visual world should feel like an older imagined version of the future:

- compact robot workers with screen faces;
- recognizable workstations and equipment;
- slightly chunky, deliberately pixelated environmental art;
- dark charcoal and deep navy surfaces rather than pure black;
- restrained cool highlights, illuminated monitors, and practical status lighting;
- warm character moments inside a serious research tool;
- careful, contemporary typography for all readable information.

The target is retro-futurist, not cyberpunk. Avoid a spaceship covered in neon, excessive holograms, scanlines, glitch effects, and glowing borders.

## 4. The product must still feel professional

Research content takes priority over visual play. Reports, evidence, warnings, budgets, confidence, and review results must be easy to scan and compare.

- Use a modern sans-serif for normal UI text.
- A restrained monospace may be used for event identifiers, timestamps, numeric values, and technical metadata.
- Do not use pixel fonts for paragraphs, forms, navigation, reports, or tables.
- Maintain WCAG AA contrast for normal text and controls.
- Use a consistent spacing, radius, border, and elevation system.
- Use semantic color for actual status, not decoration.
- Never hide a failure, rejection, retry, disagreement, or budget warning to keep the office looking clean.

Dark-first is approved for the initial slice. Use semantic color tokens so a future light theme remains possible, but do not expand the first slice merely to add theme switching.

## 5. Palette and material rules

The first implementation should propose exact token values within this family:

- **Base:** cool charcoal or deep navy, never pure `#000000`.
- **Raised surfaces:** one or two slightly lighter cool neutrals.
- **Primary text:** softened off-white, never pure `#ffffff` everywhere.
- **Secondary text:** cool gray with accessible contrast.
- **Primary accent:** one restrained electric blue or cyan family.
- **Semantic colors:** green for success, amber for warning, red for failure, and a distinct neutral treatment for idle or unavailable.

Semantic colors are permitted in addition to the primary accent because they encode real operational state. Do not turn every agent into an unrelated rainbow. Agent identity should mainly come from silhouette, equipment, face, badge, and small controlled color details.

Avoid:

- AI-purple gradients;
- generic glassmorphism;
- outer neon glows;
- pure-black panels;
- heavy shadows around every region;
- a different accent color on every screen;
- decorative colored dots that do not represent state.

## 6. Shape, depth, and layout language

The application is a spatial office surrounded by precise information surfaces.

- Use one restrained radius system. Panels may be softly squared, not bubbly.
- Use cards only where containment or elevation communicates a real relationship.
- Prefer zones, dividers, alignment, and negative space over a grid of identical floating boxes.
- Controls must look tactile and intentional, but not like arcade buttons.
- Pixel-art areas may use crisp stepped edges and sprite silhouettes. Normal UI must remain resolution-independent and sharp.
- Render pixel assets with nearest-neighbor scaling and integer scale factors whenever practical so they do not blur.

The Research Office should have an intentional visual hierarchy:

1. the mission and its current phase;
2. the Commander and active organization;
3. the work graph and agent states;
4. budget, alerts, and event detail;
5. secondary navigation and utilities.

## 7. Robot art direction

Robots should be original pixel-art characters inspired only by the broad qualities in the user's references. Do not trace or reproduce the supplied examples.

Shared robot language:

- compact body and readable silhouette;
- screen face with a small set of expressive states;
- one coherent pixel grid and outline weight;
- limited palette per sprite;
- enough detail to recognize the role at normal UI size;
- no realistic human faces;
- no emoji used as a substitute for character art.

The Commander should be visually recognizable without relying only on a label. Possible signals include a slightly taller silhouette, command headset or antenna, broader display, central workstation, or restrained command accent.

Specialists should share the same robot family while differing through role equipment and small silhouette changes. Examples include research sensors, evidence displays, analytic instruments, safety markings, or review tools.

Robot identity must never imply different permissions or evidence standards. Product policy remains authoritative.

### Required visual states

Each robot system must support at least:

- idle;
- assigned;
- actively working;
- waiting on a dependency;
- blocked or requiring approval;
- failed;
- completed;
- interrupted;
- under review or revising, when relevant.

Do not create a full game-animation system in the first slice. A base sprite plus small state-specific face, pose, equipment, or status changes is enough.

## 8. Meaningful motion

Every animation must explain hierarchy, feedback, or system state.

Appropriate examples:

- a working robot types or operates a monitor;
- an idle robot enters a subtle low-power pose;
- a blocked robot and its workstation show a restrained warning state;
- a task handoff travels from one workstation to another;
- multiple active robots visibly demonstrate concurrent work;
- completion produces a brief confirmation response;
- the Commander receives a result or assigns a task;
- Replay advances the office through recorded event states.

Avoid:

- constant bouncing or floating;
- animation added only because it looks impressive;
- parallax, magnetic controls, or scroll hijacking in operational screens;
- large particle effects;
- automatic sound;
- rapid glitch effects;
- animation that implies work not present in the event-derived state.

Animate `transform` and `opacity` where possible. Honor `prefers-reduced-motion`; the complete product must remain understandable when motion is disabled.

## 9. Gamification boundary

DropScope may feel alive, but it must not reward research as if it were a game.

Do not add:

- XP or levels;
- coins or fictional currencies;
- loot, unlocks, streaks, or achievements;
- health, mana, or energy bars;
- arbitrary scores that are not part of DropScope's real evidence model;
- winner celebrations that exaggerate uncertain research;
- game mechanics that encourage spending more research budget.

The permitted gamification is representational: characters, place, motion, and understandable activity. It must not alter decisions or incentives.

## 10. Milestone 1B surfaces

Preserve the frozen information architecture.

### Mission Lobby

Create or load a mission, select a fixture or mission type, configure geography and budget, and open completed missions. It should feel like entering the research facility, but forms and mission history remain conventional and readable.

### Research Office

The main spatial surface. It contains the Commander area, specialist desks, task dependencies, agent states, usage, failures and approvals, and a live event feed.

### Agent Desk

A focused detail surface for bounded instructions, current work, evidence, claims, confidence, contradictions, usage, and history. It is a workbench, not a profile or collectible-character screen.

### Tribunal Room

A structured debate surface for the advocate, prosecutor, Commander questions, challenges, and unresolved disputes. Visual staging may reinforce opposing roles, but the content must remain comparable and precise.

### Review Office

A comparison surface for blind-reviewer ranking, Commander ranking, divergence, blocking feedback, and revision response. It must clearly preserve reviewer independence.

### Final Report

A professional research document. Pixel art should be minimal here so evidence, limitations, safety status, confidence, and next experiments dominate.

### Mission Replay

A chronological reconstruction of recorded events. It should update both the office state and the event detail without inventing activity between events.

## 11. First bounded slice: Research Office

Do not implement every Milestone 1B surface at once. First build one high-quality Research Office vertical slice using event-derived representative data.

Minimum slice content:

- application frame and restrained navigation;
- mission name and current phase;
- central Commander workstation;
- two or three specialist workstations;
- original robot visuals with distinct roles;
- clearly distinguishable idle, working, blocked or failed, and completed states;
- a task dependency area that shows ordering and concurrency;
- budget reserve, committed usage, and consumed usage;
- failure and approval visibility;
- live event feed or selected-event detail;
- a path into Replay or a small replay control if already supported by scope.

The slice must use real engine contracts or an explicitly labeled projection fixture shaped from those contracts. Do not invent attractive metrics that DropScope does not produce.

## 12. Responsive behavior

The primary target is desktop because the office needs spatial room. The interface must still remain usable in a narrow desktop window and on mobile.

- On wide screens, the office may be spatial with a contextual side rail.
- On narrower screens, collapse into a clear vertical sequence: mission, Commander, active agents, work graph, budget and alerts, events.
- Do not shrink the entire office like an unreadable game canvas.
- Preserve touch targets, keyboard navigation, focus visibility, and readable text.
- Do not make hover the only way to reveal status or controls.

## 13. Empty, loading, failure, and recovery states

The first slice is incomplete unless it demonstrates more than the successful running state.

- **Empty:** explain how to start or load a mission.
- **Loading:** use stable skeletons or reserved areas matching the final layout.
- **Failure:** show which task or agent failed and whether unrelated work continues.
- **Blocked:** show the dependency, approval, or policy reason.
- **Interrupted and recovered:** preserve visible history rather than pretending uninterrupted success.
- **No eligible candidates:** present a legitimate research outcome, not a broken or disappointing empty page.

## 14. Explicit anti-slop rules

Reject a concept that relies on any of these:

- a conventional dashboard made from equal rounded cards;
- a robot image placed beside otherwise generic SaaS boxes;
- AI-purple gradients or blue-purple outer glows;
- fake charts, fake percentages, or fake activity;
- oversized marketing headings inside the product;
- generic `Step 1`, `Step 2`, and `Step 3` labels;
- excessive pills and uppercase micro-labels;
- glass panels everywhere;
- an arcade font for normal UI;
- pixelating the entire application;
- decorative terminal text, weather, coordinates, or version stamps;
- inconsistent corner radii or icon families;
- hidden failures or overly positive success theater;
- placeholder copy that sounds like marketing instead of research operations;
- inaccessible low-contrast secondary text;
- animations with no event or interaction meaning.

## 15. Asset and provenance rules

- Create original robot and environment assets for DropScope.
- Do not copy the user's visual references. They establish mood only.
- Do not commit temporary clipboard images to the public repository.
- Store final assets in an intentional, documented asset directory.
- Record how generated or third-party assets were produced and confirm their repository use is permitted.
- Avoid CSS-div drawings pretending to be finished pixel art.
- Keep source sprites or generation inputs when they are needed for consistent future characters and states.

## 16. Visual checkpoint and acceptance

Before expanding to other screens, Terra must show the user the Research Office at these states:

1. a mission with at least two concurrent active agents;
2. a mission with a blocked or failed task while unrelated work remains visible;
3. a completed mission state;
4. a narrower-window layout;
5. reduced-motion behavior or a clear verification of it.

The checkpoint passes only if:

- the user recognizes it as a research office rather than a generic dashboard;
- the pixel robots feel integrated into the work environment;
- the result feels professional before it feels playful;
- the Commander and specialists are immediately distinguishable;
- the interface communicates real mission state without explanation;
- concurrency, dependencies, failure, and budget state are legible;
- typography and controls remain crisp and accessible;
- the design does not depend on copied reference art;
- no engine policy can be bypassed through the interface;
- the user approves the visual language before it is propagated.

## 17. Implementation constraints for Terra

- Treat this as a clean visual start. No frontend implementation exists in the inspected checkout, and the rejected concept is not a repository baseline to preserve.
- Preserve the React, TypeScript, and Vite direction already frozen for Milestone 1B.
- Before adding a UI or animation dependency, inspect `package.json`, choose one coherent accessible foundation, and explain the choice briefly.
- The anti-slop frontend skill is a quality and art-direction aid, not the product UI architecture. It explicitly does not specialize in dashboards or multi-step applications.
- Use its relevant rules for typography, palette discipline, hierarchy, motion, responsiveness, accessibility, and avoiding generic AI output.
- Do not import its landing-page patterns blindly into the Research Office.
- Keep UI state derived from engine events and projections. The frontend must not import policy authority into visual components or create a second source of truth.
- Keep implementation credit-efficient. Build the single slice, verify it, and stop at the visual checkpoint.

## 18. Audit note for the rejected concept

No frontend source or preserved concept artifact was present in the inspected repository at the time this direction was written. Therefore there is nothing to refactor or preserve visually.

Terra should treat the rejected concept as evidence of patterns to retire:

- generic box-first composition;
- insufficiently integrated character art;
- weak hierarchy or spacing;
- unearned futuristic effects;
- a polished-template appearance without a DropScope-specific world.

If Terra still has a screenshot or artifact in its task context, it should compare it against Sections 2, 6, 7, 14, and 16 before implementation and report only which parts, if any, are worth retaining.
