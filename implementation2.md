# Implementation Plan — Agentic Elderly Safety Companion (Web MVP)

> Execution plan for a 4-day build, 2 developers. Work phase by phase, in order. Do not
> start a new phase until the current one is verified against its checklist.

**v3 note:** Phases 0-4 (synthetic data, deviation surfacing, GPT-5.6 reasoning agent,
evaluation harness) are **unchanged and already built** per your screenshots — do not
touch that logic. This revision replaces the single-screen UI (Phases 5-7 previously) with
a **two-screen product**: a Caretaker/Guardian dashboard and a separate Patient/Elder
companion screen. This is a meaningful upgrade for judging — a single scrolling chat-style
page reads as a prototype; two purpose-built screens read as a product.

Reference: see PROJECT_SPEC.md for full product context, non-goals, and research grounding.

**Architecture (backend unchanged):**

```
Synthetic Behavior Generator
        ↓
Deterministic Deviation Surfacing   (flags WHAT changed — not what it means)
        ↓
GPT-5.6 Reasoning Agent             (decides WHAT IT MEANS and WHAT TO DO)
        ↓
Autonomous Decision + Reasoning Trace
        ↓
   ┌────────────────────┴────────────────────┐
   ↓                                          ↓
Caretaker Dashboard                  Patient Companion Screen
(drift score, map, status,           (reminders + voice, companion
 medication scheduling)               chat, distress escalation)
```

**The one thing to protect throughout this build:** the deterministic layer surfaces raw
deviations only, and all judgment (severity, action, escalation) stays with the GPT-5.6
agent. This revision does not change that boundary — the new drift score and safe-zone
check below are **display-layer aggregations for the caretaker's benefit**, not new
judgment inserted upstream of the agent. Don't let the drift score become a second,
competing "decision maker" — it's a dashboard number, the agent's reasoning is still the
actual intelligence.

---

## Phases 0-4 — Unchanged (already built)

Synthetic behavior generator, deterministic deviation surfacing, GPT-5.6 reasoning agent
(structured decision + confidence + reasoning + escalation memory), and the lightweight
evaluation harness. No changes required. If you need the detailed spec for these again,
they're preserved in your existing codebase and PROJECT_SPEC.md — this file now picks up
from the UI layer onward.

One small **additive** change needed to Phase 1's event schema to support the map in
Phase 6 below:
- Add `lat` / `lng` fields to `location_check_in` events (still simulated, still fake
  coordinates — pick a real city's coordinate range, e.g. a few points around a real
  neighborhood, so the map looks grounded rather than arbitrary)
- This is additive only — do not change existing event types or the deviation/agent logic

---

## Phase 5 — Two-Screen Scaffold
**Owner:** either dev | **Effort:** ~2 hrs

**Goal:** Split the existing single-screen app into two routes/views, with a shared state
layer both can read from. No new features yet — just the structural split.

Tasks:
- Two routes: `/caretaker` and `/patient` (a simple toggle or two tabs is fine — no auth,
  no login, just a role switch since this is a single-persona demo)
- Introduce one shared in-memory state object on the backend (or shared context if
  frontend-only) holding: latest agent decision/reasoning trace, current drift inputs,
  safe-zone config, medication schedule, distress alert flag. Both screens poll this every
  few seconds — this is the same "no database" simplicity principle as before, just now
  shared across two views instead of one
- Move your existing timeline + AI-planned-response components into the `/caretaker`
  route as a starting point (you already have this built — it becomes the raw material
  for Phase 7 below, not thrown away)
- Move your existing chat/distress-input component into the `/patient` route as a
  starting point for Phase 8 below

**Verify before proceeding:**
- [ ] Both routes load independently and correctly
- [ ] A change written to shared state (test with a dummy value) is visible on both
      screens within your polling interval
- [ ] Nothing from Phases 0-4 was modified — only moved/reused in the frontend

---

## Phase 6 — Caretaker Dashboard: Drift Score & Safe Zone Map
**Owner:** Dev A | **Effort:** ~5-6 hrs (the heaviest UI phase — the map/geofence is most
of this)

**Goal:** Sections 1 and 2 of the caretaker dashboard.

### 6.1 — Drift score (Section 1)
A single composite number that gives the caretaker an at-a-glance read, built entirely
from data you already have — no new model, no ML, fully explainable if a judge asks
"how is this calculated?"

Suggested composite (weight as feels right, keep it simple and defend it in your README):
- **Routine deviation** — normalized severity of the current/most recent Phase 2 surfaced
  deviation (e.g. stillness duration or missed-routine gap as a % over baseline threshold)
- **Communication gap** — time since last communication event vs. the persona's baseline
  communication frequency
- **Safe-zone adherence** — 0 if inside the zone, scaled by distance-outside if not
  (feeds from 6.2 below)
- **Medication adherence** — recent missed vs. acknowledged doses (feeds from Phase 9)

Combine into a 0-100 score with bands: **Stable (0-30) / Watch (31-55) / Elevated (56-75)
/ Urgent (76-100)**. Display as a number + band label, ideally with a simple visual (gauge
or colored bar — don't over-engineer, a colored badge is enough).

- [ ] Score recalculates correctly when a new deviation or distress event occurs
- [ ] Score is explainable: hovering/expanding shows the 4 contributing factors and their
      individual values (this is what makes it "explainable AI" rather than a mystery number)
- [ ] Normal-day baseline produces a low, stable score — confirm it's not noisy/jumpy on
      non-events

### 6.2 — Live location + safe zone (Section 2)
Tasks:
- Render a map (Leaflet + OpenStreetMap tiles — free, no API key, no real GPS dependency;
  the coordinates are still your simulated `lat`/`lng` values from Phase 1)
- Plot the persona's current simulated location as a marker
- Let the caretaker set a **safe zone**: a center point (e.g. "home") + adjustable radius,
  drawn as a circle overlay on the map
- When the simulated location falls outside the safe zone, this feeds into the drift score
  (6.1) and displays a clear visual state change (e.g. marker/circle turns red) — this is
  a **display-layer** signal; it does not need to be re-routed through Phase 2/3 to work
  for the demo, though passing it as extra context into the Phase 3 agent call is a
  reasonable stretch if Phase 3 is stable and you have spare time (see Nice-to-Haves)

**Verify before proceeding:**
- [ ] Map renders with the persona's current location plotted correctly
- [ ] Caretaker can set/adjust a safe zone and it persists (in shared state) across
      screen refreshes/polls
- [ ] Triggering an out-of-zone scenario visibly changes both the map state and the drift
      score
- [ ] Map performs acceptably on the machine you'll record the demo on (test this early —
      map libraries can be surprisingly heavy to first-paint)

---

## Phase 7 — Caretaker Dashboard: Agent Status & Medication Scheduling
**Owner:** Dev B | **Effort:** ~4 hrs

**Goal:** Sections 3 and 4 of the caretaker dashboard.

### 7.1 — Last agent status (Section 3)
- Reuse your existing "AI-planned response" component from the screenshots as-is —
  it's already good. Just relocate/restyle it as its own dashboard card rather than a
  chat-log entry: decision, confidence badge, reasoning, immediate action, follow-up
- This should update whenever a new agent decision fires, from either the passive
  monitoring path (Phase 2/3) or the patient-initiated chat path (Phase 8 below) — same
  card, same component, regardless of source

### 7.2 — Medication scheduling (Section 4)
Tasks:
- Simple form: medicine name + time(s) of day. No dosage/medical validation logic needed —
  this is a scheduling feature, not a clinical one, and shouldn't pretend otherwise
- Store schedule entries in the shared state object from Phase 5
- List of currently scheduled reminders, editable/removable
- This data is consumed by the Patient screen in Phase 9 below — that's the whole point
  of this section: what the caretaker sets here must show up there

**Verify before proceeding:**
- [ ] Latest agent decision (from any source) appears correctly in Section 3 without delay
- [ ] Adding/editing/removing a medication schedule entry updates shared state correctly
- [ ] A schedule entry created here is visible via the shared-state poll (test this
      directly, before wiring up the patient screen, to isolate bugs)

---

## Phase 8 — Patient/Elder Companion Screen: Chat & Distress Escalation
**Owner:** Dev B | **Effort:** ~3 hrs

**Goal:** Reskin your existing distress-input feature (already built, per your screenshots)
into a warmer, companion-style experience — same backend call, different framing and tone.

Tasks:
- Restyle the chat UI to feel like a companion, not a diagnostic tool: friendly avatar/name,
  conversational bubbles, softer copy ("How are you feeling today?" as a standing prompt
  rather than a blank input box)
- Backend call is unchanged from your existing Phase 6 (old) work — same structured
  decision/confidence/reasoning output, same escalation logic
- When a message results in `notify_caregiver`, write a distress alert into the shared
  state object from Phase 5 — this is what the caretaker dashboard picks up next

**Verify before proceeding:**
- [ ] Companion chat visually reads as warm/conversational, not clinical (a quick gut-check:
      would this feel okay to show an actual elderly relative?)
- [ ] Distress messages still produce correctly-cited reasoning (this shouldn't have
      regressed from your already-verified Phase 3 behavior — just confirm after the
      re-skin)
- [ ] A `notify_caregiver` result correctly writes to shared state

---

## Phase 9 — Patient/Elder Companion Screen: Reminders, Voice & Caretaker Warning Loop
**Owner:** Dev A | **Effort:** ~4 hrs

**Goal:** Close the loop both ways — medication reminders flow caretaker → patient, and
distress flows patient → caretaker.

Tasks:
- Patient screen polls shared state and displays upcoming/due medication reminders from
  Phase 7.2, in a simple card list ("Time for your evening medicine")
- When a reminder becomes due, use the browser's built-in **Web Speech API**
  (`SpeechSynthesisUtterance`) to speak it aloud — free, no external dependency, no API
  cost, works entirely client-side
- On the caretaker side, poll for the distress alert flag written in Phase 8 and surface
  it as a prominent, hard-to-miss warning banner on the dashboard (not buried in Section 3
  — this needs its own visual treatment, since "something fishy was caught" is the moment
  judges should visibly react to)
- Clear/acknowledge mechanism for the caretaker to dismiss the warning banner once seen

**Verify before proceeding:**
- [ ] A medication reminder set on the caretaker screen appears correctly on the patient
      screen at (or ahead of) its scheduled time
- [ ] The reminder is spoken aloud via TTS at the correct time, audible in your recording
      environment (test this on the actual machine/browser you'll demo with)
- [ ] Triggering a distress scenario from the patient chat produces a visibly prominent
      warning banner on the caretaker screen within your polling interval
- [ ] The caretaker can dismiss/acknowledge the warning without losing the underlying
      reasoning trace (it should still be readable in Section 3 after dismissal)

---

## Phase 10 — Demo Control Panel (Updated for Two Screens)
**Owner:** either dev | **Effort:** ~2 hrs

**Goal:** A reliable way to drive both screens during the recorded demo without needing to
juggle two windows awkwardly on camera.

Tasks:
- Keep your existing scenario trigger buttons (4 anomaly types + distress input + reset +
  evaluation harness)
- Add a quick screen-switch control so the demo can show "trigger on caretaker view →
  swap to patient view to show the reminder/voice → swap back to show the warning banner"
  in one smooth recording pass
- Add a "set demo medication reminder due in 10 seconds" shortcut — waiting for a real
  scheduled time during a live recording is a bad demo experience; make it fast to trigger

**Verify before proceeding:**
- [ ] Each scenario button still reliably triggers its full pipeline
- [ ] Screen-switch control works smoothly enough to use live on camera
- [ ] The 10-second demo reminder shortcut correctly triggers the voice + patient-screen
      update without waiting for real scheduled time

---

## Phase 11 — Polish Pass
**Owner:** both devs | **Effort:** ~3-4 hrs

**Goal:** Make both screens look like a coherent product, not two separately-built pages.

Tasks:
- Shared visual language across both screens (same color system, typography, spacing —
  they should look like siblings, not two different apps)
- Caretaker dashboard: consistent card sizing across the 4 sections, don't let the map
  section visually dominate the other 3
- Patient screen: warm, larger-text, higher-contrast styling appropriate for an elderly
  user persona — this is a legitimate design opportunity to mention in your README
  (accessibility-conscious design for the actual end user, distinct from the caretaker's
  denser data view)
- Error handling: a failed LLM call, a map load failure, or a TTS failure should each show
  a graceful state, never crash either screen
- Basic responsive check on the recording machine

**Verify before proceeding:**
- [ ] Both screens look like one product
- [ ] No visible console errors during a full run-through of all scenarios on both screens
- [ ] A first-time viewer understands each screen's purpose within 10 seconds of looking

---

## Phase 12 — Repo & README Finalization
**Owner:** either dev | **Effort:** ~2.5 hrs

**Goal:** Submission-ready repository.

Tasks:
- Write README: setup instructions, how to run locally, sample data explanation
- Explicitly document where Codex accelerated the build, what decisions were made
  manually, and how GPT-5.6 was used as the reasoning/decision layer — now also explain
  the two-screen split as a deliberate design decision (caretaker needs data density,
  patient needs simplicity/warmth/voice — different users, different interfaces)
- Include the Phase 4 evaluation results in the README as evidence of testing
- Confirm repo is public with appropriate license, or shared with the required judging
  emails
- Capture the /feedback Codex session ID from the main build session

**Verify before proceeding:**
- [ ] A stranger could clone the repo and get it running from the README alone
- [ ] The Codex-usage section names specific phases/files, not vague praise
- [ ] Session ID is captured and saved somewhere you won't lose it

---

## Stretch phases (only after Phase 12 is fully done and verified)

**Phase S1 — Feed safe-zone status into the Phase 3 agent as context** (rather than only
a display-layer signal), so the agent's reasoning can explicitly cite "outside safe zone"
alongside behavioral deviations — a nice reinforcement of the "agent reasons over
everything" story, but only attempt if Phase 3 is stable and you have real slack left
**Phase S2 — WebSocket push instead of polling** for the shared state, for snappier
demo-visible sync between the two screens
**Phase S3 — Drift score trend sparkline** (last few hours) instead of a static number
**Phase S4 — Second demo persona** to show generalization

Do not start these unless Phase 12 is done. A finished two-screen MVP beats an unfinished
one with extra bells every time in judging.

---

## Estimated Effort by Phase (2 developers, parallel where marked)

| Phase | Description | Hours | Parallelizable? |
|---|---|---|---|
| 0-4 | Backend (already built) | — | done |
| 5 | Two-screen scaffold | 2 | No — blocks 6-9 |
| 6 | Drift score + safe-zone map | 5-6 | No — depends on 5 |
| 7 | Agent status + medication scheduling | 4 | Yes, parallel with Phase 6 |
| 8 | Companion chat re-skin | 3 | Yes, parallel with Phase 6/7 |
| 9 | Reminders, voice, warning loop | 4 | No — depends on 7 and 8 |
| 10 | Demo control panel update | 2 | No — depends on 6-9 |
| 11 | Polish | 3-4 | Both devs |
| 12 | Repo/README | 2.5 | Either dev |
| **Total remaining** | | **~26-28 hrs** | across 2 devs |

That's roughly 1.5-2 focused days for two people on top of what's already built — tight
but realistic within your remaining hackathon time, provided the map (6.2) doesn't
balloon. That's the one line item most likely to overrun.

## Critical Path

```
Phase 5 → Phase 6 (map/drift, heaviest) → Phase 9 (needs 7 + 8 done) → Phase 10 → Phase 11 → Phase 12
```
Phase 7 and 8 can run in parallel with Phase 6 on the other developer's track — use that
parallelism, since Phase 6 is your longest single item.

## Highest Implementation Risks

1. **The map/safe-zone feature (6.2) eating disproportionate time.** Map libraries have a
   habit of fighting you on styling, tile loading, or circle-overlay interactions right
   before a demo. Timebox this explicitly — if it's not working cleanly by a self-imposed
   checkpoint, fall back to a simplified static-image map with a plotted marker and a
   drawn circle rather than a fully interactive Leaflet integration. A slightly less
   interactive map that works beats a fully interactive one that glitches on camera.
2. **Drift score becoming a second decision-maker.** Keep reinforcing to yourselves: the
   score is a caretaker-facing summary number, not a new judgment layer competing with the
   Phase 3 agent. If a judge asks "which one actually decides what happens," the answer
   must stay "the GPT-5.6 agent" — the drift score is context, not authority.
3. **Shared state polling causing visible lag or flicker between the two screens during
   the demo.** Test the actual poll interval on your recording setup before the final
   take — a laggy handoff between screens undercuts the "closed loop" story you're going
   for.
4. **TTS not firing reliably in the recording environment.** Browser autoplay/audio
   permission policies can block `SpeechSynthesisUtterance` without a prior user
   interaction. Test this specifically on the device/browser you'll record with, not just
   in dev.
5. **Time creep in Phase 11 (polish).** Same risk as before, now doubled across two
   screens. Timebox hard.

## Nice-to-Have If Extra Time Remains (priority order)
1. Safe-zone context feeding into the Phase 3 agent (Phase S1) — strengthens the "agent
   reasons over everything" story without much engineering risk if Phase 3 is untouched
2. Drift score trend sparkline (Phase S3) — cheap visual upgrade, good for "Design" scoring
3. WebSocket sync (Phase S2) — nicer, but polling is genuinely sufficient for a demo; only
   worth it if everything else is done early
4. Second persona (Phase S4) — lowest priority, doesn't touch your core story