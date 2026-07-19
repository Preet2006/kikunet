# Agentic Elderly Safety Companion

Web MVP for simulating an elderly person's day, surfacing routine deviations, and using an AI reasoning agent to select an appropriate intervention.

## Phase 0 setup

1. Copy `.env.example` to `.env` and add values when needed.
2. Install dependencies: `npm install`
3. Start the frontend and backend: `npm run dev`
4. Open `http://127.0.0.1:5173`.

The page confirms that the React frontend can reach `GET /api/health` on the Express backend.

## Phase 1 behavior-data API

The backend uses an in-memory, deterministic event stream for the demo persona. All responses are JSON and can be inspected directly:

- `GET /api/behavior/baseline` — normal full day of activity
- `GET /api/behavior/scenarios` — available anomaly scenarios
- `GET /api/behavior/scenarios/missed_routine`
- `GET /api/behavior/scenarios/prolonged_stillness`
- `GET /api/behavior/scenarios/off_route_station`
- `GET /api/behavior/scenarios/communication_silence`

You may append `?date=2026-07-17` to any event-stream endpoint to set the simulated date.

Every event includes its ISO timestamp, a `time_of_day` value (`morning`, `afternoon`,
`evening`, or `night`), location, and contextual expectations such as
`context.expected_location`. The response persona profile includes mobility, cognitive-risk,
transport, emergency-contact, and language context for the reasoning phase.

## Phase 2 deviation API

Phase 2 compares an event stream to the same persona's baseline and returns factual
expected-versus-actual differences only. It contains no severity, interpretation, or
recommended intervention.

- `GET /api/deviations/baseline` — returns zero surfaced deviations for a normal day
- `GET /api/deviations/scenarios/:scenarioId` — returns raw deviations for a scenario

For example, the station scenario reports the expected location, the observed location,
and its expected routine context (`afternoon park visit`). Phase 3 will be responsible
for deciding what those facts mean.

## Phase 3 reasoning agent

Set `OPENAI_API_KEY` in `.env`, then request a live autonomous agent decision:

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:3001/api/agent/decide -ContentType application/json -Body '{"scenario_id":"off_route_station"}'
```

The API sends gpt-5.6-luna the persona profile, recent behavior history, baseline reference,
surfaced deviations, and prior decisions for the same persona. The model returns an
evidence-linked interpretation, plausible explanations, uncertainty assessment, decision,
confidence, immediate and follow-up actions, caregiver summary, and escalation flag.

The server retries malformed or invalid model output once. If both attempts fail, it returns
a visible `continue_monitoring` fallback with a system note rather than crashing.

## Phase 6 caretaker dashboard: drift score, safe zone, and live location

The caretaker view combines the four explainable drift inputs (routine, communication,
safe-zone distance, and medication) into a display-only 0–100 score. It does not make a
safety decision—the Phase 3 reasoning agent remains the only component that decides an
intervention.

Each open app tab starts browser location sharing with a fresh
`navigator.geolocation.getCurrentPosition` request, then keeps a
`navigator.geolocation.watchPosition` subscription and a 30-second refresh. When the
browser grants permission, it sends the device coordinates and accuracy to the shared
dashboard state. The caretaker map follows the live marker, recomputes the safe-zone factor,
and shows whether the current point is inside or outside the configured radius. While a fresh
location is pending, it does not present the prior device point as current. The caretaker can
update the safe-zone centre coordinates and radius, or click a point on the map to fill the
centre fields and preview the new zone before saving; that setting persists in shared state.
Device location is not passed into the Phase 3 reasoning prompt.

If permission is denied, unavailable, or unsupported, the app restores the most recent
simulated check-in location without interrupting either screen. The patient sees a simple
status message such as “Location sharing is on”; Nia never asks the patient to share a
location.

To test it locally, open `/patient`, allow the browser location prompt, then open
`/caretaker` in another browser window. The map state updates through the shared-state poll.
Browser geolocation requires a secure context (`https`) or `localhost`. For a phone demo,
serve the app over HTTPS and set `VITE_API_URL`, `CLIENT_ORIGIN`, and `SERVER_HOST=0.0.0.0`
for the host running the API. `CLIENT_ORIGIN` may contain comma-separated allowed origins.

## Direct user-initiated conversational input

An elder can send a direct message without any co-occurring behavioral deviation. The text is
sent directly to the Phase 3 agent with the same structured decision schema; it is never passed
through the deterministic Phase 2 scorer. A low-confidence message can receive one clarifying
follow-up through the existing `follow_up_action` field.

## Phase 4 evaluation harness

The evaluation harness runs all four scenarios through Phase 1 data generation, Phase 2
deviation surfacing, and the Phase 3 agent. Each scenario has a small hand-authored set of
acceptable decisions, so the test allows evidence-based model latitude without accepting
unrelated interventions. For prolonged stillness, `continue_monitoring` passes only when
the agent cites concrete recovery evidence from the later simulated history, such as the
20:30 evening medication acknowledgement or overnight rest; an unsupported monitoring
decision remains a mismatch.

Run it from the command line:

```powershell
npm run evaluate
```

Or request the same JSON report through the API:

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:3001/api/evaluation/run -ContentType application/json -Body '{}'
```
