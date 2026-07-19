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

### 6.2 addendum — Real device geolocation (added after initial build)
**Effort:** ~1-2 hrs. A small, worthwhile upgrade once the base map/safe-zone above is
already working: use the browser's built-in **Geolocation API**
(`navigator.geolocation.getCurrentPosition` / `watchPosition`) instead of a simulated
coordinate, so the map shows the real position of whichever device has the patient screen
open. This is NOT the "real GPS API" you scoped out earlier — no external service, no key,
no telecom/transit integration — it's a standard browser permission-gated feature.

- Swap the coordinate source feeding the map marker and safe-zone check from Phase 1's
  simulated `lat`/`lng` to the browser's live position when available, falling back to the
  simulated value if permission is denied or unavailable (don't let the whole feature break
  if geolocation isn't granted)
- All other synthetic behavioral signals (stillness, communication silence, missed
  routine) stay exactly as they are — only the location signal becomes real; this is a
  substitution of one input, not a redesign
- For the recorded demo: open the patient screen on an actual phone and the caretaker
  dashboard on your laptop, walk around a little, and the caretaker map should update with
  your real position live — a genuinely stronger demo beat than a static simulated marker
- Test the browser's location-permission prompt on your actual recording devices ahead of
  time — a permission dialog appearing unexpectedly mid-take is an easy way to lose a
  good recording

**Verify before proceeding:**
- [ ] Granting location permission on the patient-screen device updates the caretaker
      map with that device's real position
- [ ] Denying permission (or testing on a device without location support) falls back
      gracefully to the simulated coordinate, without crashing either screen
- [ ] Safe-zone breach detection correctly triggers off the real coordinate when available
- [ ] Permission prompt behavior is tested and rehearsed on the exact devices/browsers
      you'll use for the recorded demo

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

## Phase 8 — Companion Agent: Context, Real Actions & Voice
**Owner:** Dev B (both devs review) | **Effort:** ~8-9 hrs — this is now the second most
important phase in the whole project after Phase 3, and directly answers "it feels like
talking to an agent, not a companion." Do not compress this to save time elsewhere.

**Goal:** Turn the existing distress-input feature into a genuine companion: it knows the
full dashboard state, it can actually *do things* (not just talk about them), it sounds
human, and it can be talked to by voice. This is one upgraded capability with four parts —
build them in order, each depends on the last being stable.

### 8.1 — Persona & tone (foundation for everything else)
- Give the companion a name and a consistent personality in its system prompt — warm,
  patient, unhurried, never clinical. Write out 4-5 example exchanges in the prompt itself
  (few-shot) showing the tone you want, not just an instruction to "be warm" — models
  follow examples far better than adjectives
- Ban clinical phrasing explicitly in the prompt ("I have logged your report," "escalation
  initiated") — a companion says "I'll let Ananya know you need help," not "Notifying
  caregiver: escalation triggered"
- This tone work underlies 8.2-8.4 below — get it right first, since every other feature
  routes its output through this same voice

### 8.2 — Full dashboard context grounding
This is what fixes "when's my medicine with xyz name" not being answerable. The companion
must be able to answer questions about real dashboard state, not just react to distress.
- On every companion turn, inject as context (from the same shared state object from
  Phase 5): the current medication schedule (names + times), the most recent agent
  status/decision from Phase 7.1, the current drift score/band from Phase 6.1, and
  safe-zone status from Phase 6.2
- The companion answers factual questions (schedule, status) **grounded in this injected
  context only** — instruct it explicitly not to invent medication names, times, or
  statuses that aren't present in the injected data. If asked about something not in
  context, it should say so plainly rather than guessing (a hallucinated medicine time is
  a genuinely bad failure mode for this product, not just an awkward demo moment)

### 8.3 — Function calling for real actions
This is the part that makes it feel like a companion doing things *with* you, not just
describing things *at* you — and it's also a strong technical talking point for judges.
Give the model callable tools instead of just chat text:
- `get_schedule()` — returns current medication schedule from shared state
- `create_reminder(name, time)` — writes a new reminder into the same shared state object
  Phase 7.2 writes to. A reminder created through conversation ("remind me to take my BP
  tablet at 9pm") must show up on the caretaker dashboard exactly the same as one entered
  through the manual form — same data, same storage, two entry points
- `update_reminder(id, ...)` / `acknowledge_reminder(id)` — for edits and mark-as-taken
- `escalate_to_caregiver(reasoning)` — this replaces the old ad-hoc distress handling with
  a proper tool call using the **same structured schema as Phase 3**
  (`decision`/`confidence`/`reasoning`/`escalation_flag`), just invoked as a tool rather
  than always running. This keeps the whole project's decision logic in one consistent
  shape instead of two parallel systems
- Model decides which tool(s) to call based on the message — a schedule question calls
  `get_schedule`, "remind me to..." calls `create_reminder`, "I don't feel well" calls
  `escalate_to_caregiver` — and it should still respond in natural companion language
  around the tool result, not just return raw data

### 8.4 — Voice input (mic icon)
- Add a mic icon button on the patient screen using the browser's built-in
  **Web Speech API** (`SpeechRecognition` / `webkitSpeechRecognition`) — free, no external
  service, pairs naturally with the TTS output you already have from the old Phase 9 work
- Tap to start listening, transcribe to text, auto-submit (or let the user review/edit
  before sending — either is fine, pick whichever tests better on your recording device)
- Companion's spoken responses should also use TTS on the way out, so voice-in/voice-out
  feels like one continuous conversation, not typing that occasionally gets read aloud
- Test microphone permission prompts on your actual recording browser/OS ahead of time —
  permission dialogs mid-demo are one of the easiest ways to lose a live take

**Verify before proceeding:**
- [ ] Asking "when is my medicine with [name]" returns the correct time from the actual
      schedule set on the caretaker dashboard — test this with a schedule entry made
      through the manual caretaker form, not just one created via chat
- [ ] Creating a reminder via conversation ("remind me to take my iron tablet at 6pm")
      correctly appears on the caretaker dashboard's Section 4 list, identical in
      treatment to a manually-entered one
- [ ] Asking about a medicine name that isn't in the schedule produces an honest "I don't
      have that in your schedule" response, not a fabricated time
- [ ] A distress-style message still correctly triggers `escalate_to_caregiver` with
      properly-cited reasoning (this is Phase 3's logic, now called as a tool — confirm it
      didn't regress)
- [ ] Tone check: read 5-6 companion responses out loud — none should sound like a system
      log or contain phrases like "decision," "escalation," or "confidence level"
- [ ] Mic button correctly transcribes speech to text and the resulting message flows
      through the exact same pipeline as typed messages
- [ ] TTS speaks the companion's responses aloud, and the full voice-in → text → tool
      call → voice-out loop works end to end without manual typing at any point

---

## Phase 9 — Reminder Display & Caretaker Warning Loop
**Owner:** Dev A | **Effort:** ~3 hrs (reduced from before — reminder *creation* now also
happens via Phase 8.3's function calling; this phase is about *surfacing* reminders and
distress alerts on each screen, not creating them)

**Goal:** Close the loop both ways — medication reminders (from either the caretaker form
in 7.2 or the companion chat in 8.3) reach the patient screen and are spoken aloud; distress
escalations (from Phase 8.3's `escalate_to_caregiver`) reach the caretaker screen prominently.

Tasks:
- Patient screen polls shared state and displays upcoming/due medication reminders,
  regardless of which entry point created them, in a simple card list ("Time for your
  evening medicine")
- When a reminder becomes due, speak it aloud via the same TTS setup from Phase 8.4
- On the caretaker side, poll for the distress/escalation flag written by
  `escalate_to_caregiver` and surface it as a prominent, hard-to-miss warning banner on
  the dashboard (not buried in Section 3 — this needs its own visual treatment, since
  "something fishy was caught" is the moment judges should visibly react to)
- Clear/acknowledge mechanism for the caretaker to dismiss the warning banner once seen

**Verify before proceeding:**
- [ ] A medication reminder set via either the caretaker form OR the companion chat
      appears correctly on the patient screen at (or ahead of) its scheduled time
- [ ] The reminder is spoken aloud via TTS at the correct time, audible in your recording
      environment
- [ ] Triggering a distress scenario (typed or spoken) produces a visibly prominent
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
- Add a "pre-filled voice question" shortcut too, in case live microphone input is
  unreliable on the recording machine — better to have a rehearsed fallback than to bet
  the whole demo take on a mic working perfectly on the first try
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

## Phase 12 — Vision: Stated-Intent Verification (Location & Medicine)
**Owner:** Dev B | **Effort:** ~6-7 hrs (increased from a simpler vision-Q&A design — the
intent-tracking + two-flow comparison logic is more involved than open-ended photo
description, but it's a much stronger, more specific demo than generic vision Q&A)

**Goal:** Give the companion eyes — and specifically, the ability to **verify** what the
elder tells it against a photo, rather than just reacting to a photo in isolation. This is
the strongest replacement for the old "railway/off-route station" scenario you inherited
from the original concept: instead of faking transit data, an elder states an intent by
voice ("I'm heading to Indore," "I'm about to take my paracetamol"), then confirms it with
a photo, and the companion checks the two against each other before giving guidance. This
directly answers your original problem framing — some people can't describe a mismatch in
words, but a photo makes it checkable.

This phase has two parallel verification flows (location, medicine) that share the same
underlying pattern: **stated intent → photo → grounded comparison → guidance**. Build the
shared pattern once, then apply it to both.

### 12.1 — Stated-intent tracking
- When the elder says something intent-shaped via voice or text ("I'm heading to Indore,"
  "I'm about to take my BP tablet"), the companion should recognize and hold this as
  short-lived session context — not a new database, just something carried in the current
  conversation state so it's available when a photo arrives next
- This doesn't need new NLU — GPT-5.6 can extract "stated destination" or "stated
  medication" directly as part of its normal reasoning turn; store whatever it extracts
  in the shared session state from Phase 5

### 12.2 — Photo icon & demo-safe capture
- Camera/photo icon on the patient companion screen, alongside the existing mic icon
- For demo reliability, prepare **matched pairs of pre-set images** for both flows: e.g. a
  street/station photo that *matches* a stated Indore-area destination, one that clearly
  *doesn't*, a paracetamol package photo that matches a "take paracetamol" reminder, and
  a different medicine's photo that doesn't. Live upload can also be supported, but the
  recorded demo should lean on these tested pairs, same principle as the voice/vision
  fallbacks already in the plan

### 12.3 — Location verification flow
- When a photo arrives and there's a recent stated destination in session context, send
  the image + the stated destination + relevant dashboard context (known routine,
  safe-zone location) to GPT-5.6 for a comparison reasoning call — using the **same
  companion persona and system prompt from Phase 8.1-8.2**, not a separate cold "image
  analysis" mode
- The model should reason about what's visually identifiable (signage, general surroundings,
  landmark-like cues) and compare that against the stated destination and known context —
  be honest in the UI copy that this is best-effort visual reasoning, not precise
  geolocation, since there's no real GPS behind it
- On a clear mismatch, the companion should guide supportively ("this doesn't look like the
  Indore route you mentioned — want me to loop in Ananya to double check?") and, if the
  mismatch is significant, invoke the **existing `escalate_to_caregiver` tool from
  Phase 8.3** — no new escalation path
- On a match, confirm warmly and let the elder continue, without over-explaining the
  verification process itself

### 12.4 — Medicine verification flow
- Same pattern, applied to reminders: when a photo arrives and there's a recent stated
  medication intent (or an active due reminder from Phase 7.2/9), compare the image against
  the actual scheduled medicine name — **pulled from real shared state, never guessed**
- **Safety guardrail, non-negotiable:** the companion must never assert high-confidence
  medical certainty from a photo alone ("yes, that is definitely your correct dosage").
  Frame responses as supportive guidance with appropriate hedging — "that looks like it
  could be your paracetamol, but if you're not fully sure, it's worth checking the label
  or asking Ananya before taking it" — rather than a clean pass/fail certification. This
  matters more than it might seem: overconfident visual medication ID is a real way this
  feature could look reckless to judges who think about it for more than a few seconds,
  and it's genuinely the right design choice for a real elder, not just optics
- On a clear mismatch (photo clearly doesn't match the scheduled medicine name), the
  companion should caution against taking it and can invoke `escalate_to_caregiver` if the
  elder seems confused about it or the mismatch is significant

### 12.5 — Shared escalation & tone discipline
- Both flows funnel any real concern through the same `escalate_to_caregiver` tool from
  Phase 8.3 — do not build two more parallel decision systems on top of the two you already
  have
- Every response in this phase, match or mismatch, location or medicine, stays in the same
  warm companion voice established in Phase 8.1 — verification results should sound like a
  companion helping you double-check, not a system running a validation test

**Verify before proceeding:**
- [ ] Stating a destination by voice, then sending a matching location photo, produces a
      warm confirmation that references both the stated destination and something
      identifiable in the image
- [ ] Stating a destination, then sending a clearly mismatched location photo, produces a
      supportive caution and — for a significant mismatch — correctly invokes
      `escalate_to_caregiver` with reasoning citing both the stated intent and the image
- [ ] Sending a photo of the correct scheduled medicine produces a warm, appropriately
      hedged confirmation — not a flat "confirmed correct" certification
- [ ] Sending a photo of a clearly different medicine than what's scheduled produces a
      caution rather than a false confirmation, cross-checked against the actual schedule
      data from Phase 7.2 (not a hardcoded guess)
- [ ] Neither flow ever asserts unhedged medical certainty from an image alone — spot-check
      the actual wording, not just whether the right decision was reached
- [ ] All four test combinations (location match/mismatch, medicine match/mismatch) stay in
      the same companion tone as the rest of the app
- [ ] Your pre-set demo image pairs work reliably every time you test them

---

## Phase 13 — Daily AI-Generated Caregiver Journal
**Owner:** Dev A | **Effort:** ~3 hrs

**Goal:** A short, warm, end-of-day summary the agent writes for the caregiver, synthesizing
the day's events into something a busy caregiver can read in 10 seconds instead of
scrolling the full timeline. This is a cheap addition — one more prompt over data you
already have — but it's a genuinely compelling "the AI is actually thinking about the
whole day, not just reacting event-by-event" moment for judges.

Tasks:
- New backend function that pulls the day's logged Phase 3 decisions, any
  `escalate_to_caregiver` events from Phase 8.3, and notable companion interactions, and
  sends them to GPT-5.6 with instructions to write a concise (3-5 sentence) natural-language
  summary — warm and human, not a bulleted log dump
- Ground it strictly in what actually happened in the logged data for that simulated day —
  same anti-hallucination discipline as Phase 8.2; it should never invent an event that
  wasn't logged
- Display as its own card on the caretaker dashboard (an addition alongside your existing
  4 sections — doesn't need to replace or compress any of them, a "Today's Summary" panel
  works well positioned near Section 3's status area)
- Add an on-demand "Generate daily summary" trigger in the demo control panel — waiting for
  simulated real time to actually reach end-of-day isn't practical for recording, so make
  it instantly triggerable

**Verify before proceeding:**
- [ ] Generated summary accurately reflects the actual flagged events/decisions from the
      current simulated day — cross-check against the real event log, don't just eyeball
      whether it "sounds plausible"
- [ ] Summary reads warm and human, not like a re-formatted log
- [ ] On-demand generation via the demo panel works reliably
- [ ] Running it again later in the same day (after new events) correctly reflects the
      updated picture rather than repeating the earlier summary verbatim

---

## Phase 14 — Repo & README Finalization
**Owner:** either dev | **Effort:** ~2.5 hrs

**Goal:** Submission-ready repository.

Tasks:
- Write README: setup instructions, how to run locally, sample data explanation
- Explicitly document where Codex accelerated the build, what decisions were made
  manually, and how GPT-5.6 was used as the reasoning/decision layer — now also explain
  the two-screen split, the function-calling companion architecture, the vision
  capability, and the daily journal as deliberate design decisions, not just a feature list
- Include the Phase 4 evaluation results in the README as evidence of testing
- Confirm repo is public with appropriate license, or shared with the required judging
  emails
- Capture the /feedback Codex session ID from the main build session

**Verify before proceeding:**
- [ ] A stranger could clone the repo and get it running from the README alone
- [ ] The Codex-usage section names specific phases/files, not vague praise
- [ ] Session ID is captured and saved somewhere you won't lose it

---

## Stretch phases (only after Phase 14 is fully done and verified)

**Phase S1 — Feed safe-zone status into the Phase 3 agent as context** (rather than only
a display-layer signal), so the agent's reasoning can explicitly cite "outside safe zone"
alongside behavioral deviations — a nice reinforcement of the "agent reasons over
everything" story, but only attempt if Phase 3 is stable and you have real slack left
**Phase S2 — WebSocket push instead of polling** for the shared state, for snappier
demo-visible sync between the two screens
**Phase S3 — Drift score trend sparkline** (last few hours) instead of a static number
**Phase S4 — Second demo persona** to show generalization
**Phase S5 — Real-time voice-to-voice** (replacing the STT/TTS workaround from Phase 8.4
with true low-latency spoken conversation) — the highest "wow" ceiling of anything on this
list, but also the highest remaining engineering risk; only attempt if Phases 12-14 are
fully done with real time to spare

Do not start these unless Phase 14 is done. A finished submission beats an unfinished one
with extra bells every time in judging.

---

## Estimated Effort by Phase (2 developers, parallel where marked)

| Phase | Description | Hours | Status |
|---|---|---|---|
| 0-4 | Backend (agent, deviation logic, evaluation) | — | done |
| 5 | Two-screen scaffold | 2 | done |
| 6 | Drift score + safe-zone map | 5-6 | done |
| 6-addendum | Real device geolocation for the map | 1-2 | **remaining** |
| 7 | Agent status + medication scheduling | 4 | done |
| 8 | Companion agent: context, function calling, voice | 8-9 | done |
| 9 | Reminder display & warning loop | 3 | done |
| 10 | Demo control panel update | 2 | done |
| 11 | Polish | 3-4 | done |
| 12 | **Vision: stated-intent verification (location & medicine)** | **6-7** | **remaining** |
| 13 | **Daily AI-generated caregiver journal** | **3** | **remaining** |
| 14 | Repo/README (now also covering vision + journal) | 2.5 | update needed |
| **Remaining effort** | | **~12.5-14.5 hrs** | 6-addendum, 12-14 |

## Critical Path

```
Phase 12 (vision, reuses Phase 8's persona/tools) → Phase 13 (journal, independent of 12)
  → Phase 14 (README update covering both)
```
Phase 12 and 13 don't depend on each other — if you have two people, split them and run in
parallel. Phase 12 is the heavier lift since it touches UI (photo input) and needs to
integrate cleanly with Phase 8's existing persona/escalation logic; Phase 13 is closer to a
self-contained backend addition plus one new dashboard card.

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
6. **Companion hallucinating schedule details.** The single biggest way Phase 8 could
   backfire: if it confidently states a wrong medicine time instead of admitting it
   doesn't know, that's worse for your demo than the old flat chatbot — it looks like the
   product would give unsafe information to an elderly user. Test the "not in schedule"
   path explicitly, don't just test the happy path where the answer exists.
7. **Function calling loop failing silently.** If `create_reminder` is called but the
   write to shared state fails (bad args, race condition with the manual form, etc.), the
   companion may still reply as if it worked. Always confirm the tool result before the
   model's natural-language reply claims success — don't let it narrate an action it
   didn't actually complete.
8. **Voice recognition failing live on camera.** Mic permissions, background noise, or
   accent/audio quality issues are a real risk during recording. Always have the
   pre-filled voice-question fallback (Phase 10) ready so a bad take doesn't cost you the
   whole demo.
9. **Vision responses breaking the companion's established tone.** It's easy for a
   multimodal call to default to a dry, descriptive "the image shows..." register that
   clashes with the warm persona built in Phase 8.1. Explicitly carry the same system
   prompt/persona into the vision call — don't treat it as a separate, differently-tuned
   feature.
10. **Live camera capture being unreliable during recording.** Don't bet the demo take on
    a live photo working perfectly on camera — rehearse with the pre-set demo images from
    Phase 12 and treat live capture as a bonus, not the primary path.
11. **Daily journal quietly inventing plausible-sounding but false events.** Same failure
    mode as Phase 8.2's hallucination risk, now at the summary level — a fabricated "calm
    day" or a fabricated incident is worse than no summary at all. Cross-check the
    generated text against the real event log every time you test it.
12. **Medicine verification sounding more medically certain than it should.** This is the
    one to test most carefully in Phase 12.4 — spot-check the actual wording of "correct
    medicine" responses, not just whether the right decision was reached, since it's easy
    for a model to slip into confident-sounding phrasing without you noticing during quick
    testing.
13. **Location permission prompts derailing the recorded take.** The 6.2 addendum's
    geolocation prompt needs to be granted before you start recording, not during — test
    the exact device/browser combo you'll demo with ahead of time so the permission dialog
    never appears live on camera.

## Why These Phases Matter for Judging
Vision (Phase 12) is your strongest remaining lever specifically *because* this is an
OpenAI hackathon — a stated-intent-then-photo-verification loop is a concrete, checkable
demonstration of GPT-5.6's actual multimodal reasoning, not just text completions with
better prompting, and it directly upgrades the weakest inherited piece of your original
concept (the faked railway subsystem) into something genuinely useful and specific: an
elder says where they're going or what they're about to take, and a photo either confirms
it or flags a mismatch worth a second look. The daily journal (Phase 13) is cheap but
disproportionately effective for **Quality of Idea** — it reframes the product from "an
alert system" to "something that actually thinks about my parent's whole day," which is a
more emotionally resonant pitch in your demo video than any individual feature. Together,
prioritize Phase 12 first if you have to choose —
it's the one a technical judge will specifically ask "wait, how does that work?" about.

## Nice-to-Have If Extra Time Remains (priority order)
1. Real-time voice-to-voice (Phase S5) — the biggest remaining "wow" ceiling, only if
   Phases 12-14 are done with genuine time to spare
2. Safe-zone context feeding into the Phase 3 agent (Phase S1) — strengthens the "agent
   reasons over everything" story without much engineering risk if Phase 3 is untouched
3. Drift score trend sparkline (Phase S3) — cheap visual upgrade, good for "Design" scoring
4. WebSocket sync (Phase S2) — nicer, but polling is genuinely sufficient for a demo; only
   worth it if everything else is done early
5. Second persona (Phase S4) — lowest priority, doesn't touch your core story