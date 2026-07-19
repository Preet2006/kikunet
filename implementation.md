# Implementation Plan — Agentic Elderly Safety Companion (Web MVP)

> Execution plan for a 4-day build, 2 developers. Work phase by phase, in order. Do not
> start a new phase until the current one is verified against its checklist. Each phase
> ends with a concrete, checkable output — if that output isn't there, the phase isn't
> done, regardless of what else got built.

Reference: see PROJECT_SPEC.md for full product context, non-goals, and research grounding.
This file is the execution sequence.

**Architecture (unchanged, strengthened in emphasis):**

```
Synthetic Behavior Generator
        ↓
Deterministic Deviation Surfacing   (flags WHAT changed — not what it means)
        ↓
GPT-5.6 Reasoning Agent             (decides WHAT IT MEANS and WHAT TO DO — this is the agent)
        ↓
Autonomous Decision + Reasoning Trace
        ↓
Timeline + Intervention UI + Caregiver View
```

**The one thing to protect throughout this build:** the deterministic layer surfaces raw
deviations only — it must never itself decide severity, meaning, or action. That
judgment belongs entirely to the GPT-5.6 agent. If a judge could look at your code and
conclude "the backend already decided everything, GPT just phrased it nicely," that's a
failure of this build, not a stylistic nitpick. Guard this boundary in every phase below.

---

## Phase 0 — Environment & Scaffold
**Owner:** either dev | **Effort:** ~2 hrs

**Goal:** A running, empty web app with the right shape, nothing functional yet.

Tasks:
- Initialize repo, choose stack (Next.js/React + Tailwind recommended for speed), set up
  backend (Node/Express or Python/FastAPI — whichever Codex scaffolds cleaner)
- Set up OpenAI API key handling (env var, never hardcoded)
- Create basic route/page structure: single-page app, no auth needed
- Confirm the app runs locally end to end (frontend hits backend hits a health-check route)
- No database. Persona state and event history live in memory / a JSON file for the
  session — this is a deliberate simplicity choice, not a shortcut you need to defend

**Verify before proceeding:**
- [ ] App boots with zero errors
- [ ] A dummy backend route returns a response visible in the frontend
- [ ] Repo structure is clean enough to build on (no throwaway boilerplate cruft)

---

## Phase 1 — Synthetic Behavior Data Layer
**Owner:** Dev A | **Effort:** ~3 hrs

**Goal:** A generator that produces a believable day of activity for one demo persona, plus
a way to inject anomalies into it on demand.

Tasks:
- Define event schema (timestamp, event_type, location/context fields)
- Event types: `location_check_in`, `movement`, `stationary`, `communication`,
  `medication_reminder_ack`
- Build a baseline generator: a normal day's worth of events following a plausible routine
- Build an anomaly injector with these scenarios (hardcode all 4, don't parameterize
  beyond what's needed for the demo):
  1. Missed routine (expected event doesn't happen)
  2. Prolonged stillness beyond normal threshold
  3. Off-route station check-in (the "railway/mobility" scenario — same event schema,
     no special-case system)
  4. Unusual communication silence window
- Expose this via an API endpoint the frontend can call

**Verify before proceeding:**
- [ ] Calling the baseline generator produces a full day of coherent, timestamped events
- [ ] Each of the 4 anomaly injectors visibly and correctly alters the event stream
- [ ] Data is inspectable as raw JSON — you can eyeball it and confirm it looks like a real day

---

## Phase 2 — Deterministic Deviation Surfacing
**Owner:** Dev A | **Effort:** ~2.5 hrs

**Goal:** A thin, explainable layer that surfaces WHAT deviated from baseline — nothing more.
This layer answers "did something change?" It never answers "does this matter?" or "what
should happen?" — that's reserved entirely for Phase 3.

Tasks:
- Compute simple baseline stats per persona (expected time windows, average stillness
  duration, expected check-in locations)
- Compare incoming events against baseline (threshold or z-score based)
- Output a structured "surfaced deviation" object: what changed, expected vs. actual, and
  by how much (e.g. "stationary for 95 min vs. baseline max of 20 min") — deliberately
  no severity label, no recommended action. Keep this layer dumb on purpose.
- Run this against all 4 injected anomaly scenarios from Phase 1 and confirm each is surfaced

**Verify before proceeding:**
- [ ] Normal-day data produces zero or near-zero surfaced deviations
- [ ] Each of the 4 injected anomalies is correctly surfaced
- [ ] The surfaced-deviation output contains raw facts only — no judgment language
      ("severe", "dangerous", "urgent") leaking in from this layer. If you find any,
      that's scope creep into what belongs in Phase 3.

---

## Phase 3 — GPT-5.6 Autonomous Reasoning Agent
**Owner:** Dev B (both devs review) | **Effort:** ~8-10 hrs — this is the heart of the
project and the primary driver of your Technological Implementation and Quality of Idea
scores. Do not compress this phase to make room elsewhere.

**Goal:** GPT-5.6 receives a surfaced deviation plus behavior history and context, and
independently performs the actual reasoning: what this means, how confident it is, whether
to escalate, and what to do about it. The deterministic layer told it *what changed*; the
agent decides *everything else*.

### 3.1 — Context assembly
- Persona's recent event history (a rolling window — recommend last 24-48 simulated hours,
  not the entire day, to keep the prompt focused and interpretable)
- The surfaced deviation object from Phase 2
- Situational context: time of day, day of week, known routine baseline
- Prior agent decisions for this persona (escalation memory — see 3.4)

### 3.2 — Structured decision output
Require GPT-5.6 to return structured JSON with:
```json
{
  "decision": "continue_monitoring | conversational_prompt | navigation_assist | notify_caregiver",
  "confidence": "low | medium | high",
  "reasoning": "specific explanation referencing the actual deviation data",
  "escalation_flag": true/false
}
```
- `confidence` matters for the demo: it's visible proof the agent is genuinely weighing
  ambiguity rather than pattern-matching to a fixed rule
- `reasoning` must cite the specific deviation (e.g. reference the actual stillness
  duration or station name) — reject/retry on generic reasoning that could apply to any
  event

### 3.3 — Malformed output handling
- Validate the JSON response on receipt; if parsing fails or required fields are missing,
  retry once with a stricter format reminder appended to the prompt
- If retry also fails, fall back to `continue_monitoring` with a logged system note
  (not a silent crash) — this is a small addition but makes the agent look production-aware
  rather than fragile in front of judges

### 3.4 — Escalation memory
- Track prior decisions per persona for the current simulated day
- If the same deviation type recurs, or confidence stays low across repeated flags, the
  agent should be able to escalate its own decision (e.g. move from
  `conversational_prompt` to `notify_caregiver`) — pass this history into the prompt
  explicitly rather than hard-coding an escalation rule outside the model
- This is what separates "agent with memory" from "single-shot classifier" — worth the
  extra hour it takes

### 3.5 — Decision consistency check
- Run each of the 4 scenarios through the agent 2-3 times each during dev testing
- Confirm decisions are consistent in kind (same scenario shouldn't wildly flip between
  `continue_monitoring` and `notify_caregiver`) while reasoning phrasing can vary — this
  proves it's a live reasoning call, not a canned string, without looking flaky

**Verify before proceeding:**
- [ ] All 4 anomaly scenarios produce a decision + confidence + reasoning that clearly
      references the actual deviation data (not generic boilerplate)
- [ ] Malformed-output retry logic is tested (temporarily corrupt a response to confirm
      the fallback path works, not just the happy path)
- [ ] Escalation works: triggering the same anomaly type twice in a row produces a visibly
      different (and more urgent) decision the second time, with reasoning that explicitly
      references the recurrence
- [ ] Decisions are consistent enough across repeat runs that you'd trust it live in front
      of judges, while reasoning text still varies naturally between runs

---

## Phase 4 — Lightweight Evaluation Harness
**Owner:** Dev A | **Effort:** ~3 hrs (half-day ceiling — do not let this expand)

**Goal:** A small, visible proof that the agent's decisions are correct — without adding
ML, datasets, or another model. This is cheap to build and disproportionately strengthens
your "Technological Implementation" story: it shows you tested the reasoning, not just
demoed it.

Tasks:
- Define expected decisions for each of the 4 hardcoded anomaly scenarios (a simple lookup
  table you write by hand, e.g. "off-route station check-in → expect
  `navigation_assist` or `notify_caregiver`" — allow a small acceptable set per scenario,
  not a single rigid answer, since reasoning legitimately has some latitude)
- Run all 4 scenarios through the full pipeline and record: expected vs. actual decision →
  match/mismatch
- Surface this as a simple results table (can be a CLI script output or a small dev-only
  UI panel) — this becomes a genuinely compelling artifact for your README and video

**Verify before proceeding:**
- [ ] All 4 scenarios run through the harness and produce a match/mismatch verdict
- [ ] At least 4/4 (ideally over multiple runs) land within the acceptable decision set
- [ ] The results are presentable as-is — a screenshot of this table is a strong
      "we didn't just build it, we tested it" moment in your demo video

---

## Phase 5 — Timeline & Agent Decision Log UI
**Owner:** Dev B | **Effort:** ~4 hrs

**Goal:** The primary demo screen — the single screen a judge will look at longest, and the
one that needs to communicate timeline → anomaly → AI reasoning → AI action in under 30
seconds without narration.

Tasks:
- Scrollable timeline of the persona's day, with surfaced deviations visually distinct
  from normal events
- Expanding a flagged event shows, in this order: the raw deviation (what changed), then
  the agent's decision, confidence, and reasoning — the ordering itself tells the story of
  "data surfaced → agent reasoned"
- Confidence should be visually represented (not just text) — a simple badge or color
  is enough, don't over-engineer this
- Keep visual design simple and legible in this phase; defer aesthetic polish to Phase 8

**Verify before proceeding:**
- [ ] A full day's timeline renders correctly with surfaced deviations visually distinct
- [ ] Every flagged event shows deviation → decision → confidence → reasoning without
      more than one click/expand
- [ ] You can narrate this screen out loud in under 30 seconds and a listener would
      understand the agent (not the backend) made the call

---

## Phase 6 — User-Initiated Conversational Input
**Owner:** Dev B | **Effort:** ~3-4 hrs

**Goal:** Close the loop in the other direction. Phases 1-5 handle the agent *noticing*
something is wrong. This phase handles the case where the elder *tells* it directly —
"I don't feel well," "I think I'm lost," "I'm scared." Your own problem framing calls out
elders "unable to communicate distress," which implicitly means the system also needs to
handle the elders who *can and do* — don't leave that half unbuilt.

This is a new input channel, not a new pipeline. It reuses Phase 3's agent and its existing
structured decision schema unchanged.

Tasks:
- Add a simple chat-style input on the UI where the persona can type a free-text message
- Route this text **directly into the Phase 3 agent's context** alongside (if present) the
  persona's recent behavior history and any currently surfaced deviation. Do NOT pass it
  through the Phase 2 deterministic scorer — that layer only understands structured
  behavioral events, not language, and forcing text through it would blur the boundary
  you've protected since Phase 2
- The agent must be able to produce a full decision (`decision`, `confidence`, `reasoning`,
  `escalation_flag`) from user text **alone**, with no co-occurring behavioral deviation —
  direct communication is sufficient on its own, it shouldn't need a passive anomaly to
  also be present to be taken seriously
- Reasoning must cite the actual message content (e.g. reference "user reported feeling
  unwell" or "user expressed disorientation"), same standard as Phase 3's existing rule
  against generic reasoning
- Keep the exchange shallow: user message → agent decision, optionally one clarifying
  question back from the agent (e.g. "Can you tell me where you are right now?") if
  confidence is low. Do not build an open-ended multi-turn chatbot with long-running
  memory — that reopens Phase 3's architecture and isn't worth the risk this late
- Any resulting `notify_caregiver` decision flows into the exact same alert UI you're
  about to build in Phase 7 below — no separate caregiver-view logic for this path

**Verify before proceeding:**
- [ ] Typing a distress message with no behavioral anomaly present still produces a full
      agent decision (not skipped, not defaulted to `continue_monitoring` by default logic)
- [ ] Reasoning text references the actual message content, not a generic template
- [ ] A low-confidence case correctly triggers one clarifying follow-up rather than jumping
      straight to a decision on ambiguous input
- [ ] A clear distress message (e.g. "I'm scared and don't know where I am") reliably
      results in `navigation_assist` or `notify_caregiver`, not `continue_monitoring`
- [ ] This path reuses Phase 3's existing decision schema — confirm no parallel/duplicate
      decision logic was created for the conversational path

---

## Phase 7 — Intervention & Caregiver Views
**Owner:** Dev A | **Effort:** ~3.5 hrs

**Goal:** The two downstream surfaces that make the agent's decisions feel like real
interventions, not just log entries.

Tasks:
- `conversational_prompt` → chat-bubble UI showing the check-in message sent to the elder,
  generated from the reasoning (not a static per-type string) — frame this in the UI as
  "AI-planned intervention," not "generated message"
- `navigation_assist` → simple card showing the guidance that would be offered
- `notify_caregiver` → alert card pulling directly from the reasoning trace — what
  happened, why, and the underlying deviation data (no re-summarizing; reuse the same
  trace so there's no drift between what the agent reasoned and what the caregiver sees)

**Verify before proceeding:**
- [ ] All 4 decision types have a corresponding, visually distinct UI outcome
- [ ] Caregiver alert content matches Phase 3's reasoning trace exactly (no mismatch)
- [ ] Check-in message text varies meaningfully based on the specific deviation, not
      templated per decision type

---

## Phase 8 — Demo Control Panel
**Owner:** either dev | **Effort:** ~2 hrs

**Goal:** A reliable way to trigger any of the 4 scenarios on demand, live, for both the
recorded video and any live Q&A with judges.

Tasks:
- Small panel (fine if visibly "dev tool" styled) with 4 buttons, one per scenario
- Triggering a scenario runs the full pipeline live: inject → surface deviation → agent
  reasons → UI updates — should be fast enough to demo without dead air
- Add a "reset to normal day" button
- Add a "run user distress input" shortcut for the demo (prefilled sample messages so you
  don't need to type live on camera)
- Add a "run evaluation harness" button that surfaces Phase 4's results on demand — this
  turns your evaluation work into a live demo moment instead of a buried test script

**Verify before proceeding:**
- [ ] Each of the 4 buttons reliably triggers its scenario through the full pipeline
- [ ] End-to-end latency (click → visible result) is demo-acceptable (a few seconds)
- [ ] Reset button correctly returns to a clean normal-day state
- [ ] Evaluation harness button produces the Phase 4 results table live
- [ ] Prefilled distress-message shortcut reliably triggers Phase 6's conversational path

---

## Phase 9 — Polish Pass
**Owner:** both devs | **Effort:** ~3 hrs

**Goal:** Make the demo look finished and intentional. Only enter this phase once Phases
0-7 are all verified working.

Tasks:
- Visual pass on timeline, decision log, chat UI, alert cards, confidence badges
- Add a short in-app header explaining what the app does, for judges browsing without
  watching the video first
- Error handling: a failed LLM call should show a graceful state, never crash the UI
- Basic responsive check so it doesn't break on the laptop screen you'll record on

**Verify before proceeding:**
- [ ] App looks coherent and intentional, not like a wireframe
- [ ] No visible console errors during a full run-through of all 4 scenarios plus the
      evaluation harness
- [ ] A first-time viewer can understand what's happening within 10 seconds of looking

---

## Phase 10 — Repo & README Finalization
**Owner:** either dev | **Effort:** ~2.5 hrs

**Goal:** Submission-ready repository that makes the judging criteria easy to award.

Tasks:
- Write README: setup instructions, how to run locally, sample data explanation
- Explicitly document where Codex accelerated the build, what decisions were made
  manually, and specifically how GPT-5.6 was used as the reasoning/decision layer
  (reference actual phases/files — vague praise reads as filler to judges)
- Include the Phase 4 evaluation results in the README as evidence of testing
- Confirm repo is public with appropriate license, or shared with the required judging
  emails
- Capture the /feedback Codex session ID from the main build session for the submission
  form

**Verify before proceeding:**
- [ ] A stranger could clone the repo and get it running from the README alone
- [ ] The Codex-usage section names specific phases/files, not vague praise
- [ ] Session ID is captured and saved somewhere you won't lose it

---

## Stretch phases (only after Phase 10 is fully done and verified)

**Phase S1 — Severity trend indicator** across the simulated day (not just per-event
confidence, but a running sense of "how many ambiguous flags today")
**Phase S2 — Second demo persona** to show baseline generalization
**Phase S3 — Caregiver trend chart** (deviation frequency across the simulated week)

Do not start these if Phase 10 isn't done. A finished 11-phase MVP beats an unfinished
14-phase one every time in judging.

---

## Estimated Effort by Phase (2 developers, parallel where marked)

| Phase | Description | Hours | Parallelizable? |
|---|---|---|---|
| 0 | Scaffold | 2 | No — blocks everything |
| 1 | Synthetic data layer | 3 | Yes, with Phase 3 prep work |
| 2 | Deviation surfacing | 2.5 | No — depends on Phase 1 |
| 3 | GPT-5.6 reasoning agent | 8-10 | No — critical path, both devs review |
| 4 | Evaluation harness | 3 | Yes, once Phase 3 has a stable interface |
| 5 | Timeline UI | 4 | Yes, in parallel with Phase 4 |
| 6 | User-initiated conversational input | 3-4 | Yes, once Phase 3 is stable |
| 7 | Intervention/caregiver views | 3.5 | Yes, in parallel with Phases 5-6 |
| 8 | Demo control panel | 2 | No — depends on 4, 5, 6, 7 |
| 9 | Polish | 3 | Both devs |
| 10 | Repo/README | 2.5 | Either dev |
| **Total** | | **~37-40 hrs** | across 2 devs over 4 days |

Note: you're already past Phase 5, so the remaining work from here is Phases 6-10,
roughly ~14-16 hrs across both devs — comfortably fits your remaining time.

This fits comfortably into 4 days at ~4-5 focused hours per developer per day, with slack
for debugging and the video recording itself (which is intentionally not counted above —
budget it as its own final block once Phase 9 is done).

## Critical Path

```
Phase 0 → Phase 1 → Phase 2 → Phase 3 → Phase 5/6/7 (parallel) → Phase 8 → Phase 9 → Phase 10
```
Phase 3 is the bottleneck: nothing meaningful can be demoed until it's solid, and it's the
single highest-effort phase. Start Phase 3 as early as Phase 1/2 give you a stable
deviation object shape to design the prompt against — don't wait for Phase 2 to be
"finished," just interface-stable.

## Highest Implementation Risks

1. **Phase 3 reasoning quality drifting generic.** The single biggest way this project
   fails to impress judges is the agent's reasoning text reading like filler ("this seems
   unusual, monitoring recommended") instead of citing specifics. Budget explicit prompt
   iteration time here, not just implementation time.
2. **Malformed JSON from the LLM breaking the demo live.** Build and test the retry/fallback
   path (3.3) before you assume the happy path is enough — this is exactly the kind of
   thing that fails during a live judge Q&A, not during solo testing.
3. **Escalation memory feeling scripted rather than reasoned.** If escalation is
   implemented as a hard rule outside the model ("if flagged twice, force notify_caregiver"),
   judges who look at the code will see the "agent decided everything" story break. Keep
   the history as prompt context and let the model actually decide the escalation.
4. **Time creep in Phase 9 (polish).** Polish has no natural stopping point. Timebox it
   hard and stop even if it's not "done" — a working, slightly plain app beats a
   beautiful, broken one.
5. **Phase 6 turning into an open-ended chatbot.** It's tempting to make the conversational
   input feel more "alive" by letting it run long multi-turn exchanges. Resist this — one
   message in, at most one clarifying question back, then a decision. A sprawling chat
   feature this late risks destabilizing the Phase 3 agent you've already verified.

## Nice-to-Have If Extra Time Remains (priority order)
1. Confidence-based visual escalation in the timeline (e.g. low-confidence flags visually
   "dimmer" until resolved) — cheap, reinforces the reasoning story
2. Second demo persona (Phase S2) — shows generalization without much new engineering
3. Caregiver trend chart (Phase S3) — nice for the "Design" judging criterion, lowest
   priority since it doesn't touch the core agentic story