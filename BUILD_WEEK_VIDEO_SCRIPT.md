# Kikunet Build Week Demo Video — GPT-5.6 Script and Shot List

**Target runtime:** 2 minutes 45–50 seconds. **Hard limit:** 3 minutes.  
**Track:** Apps for Your Life.  
**OpenAI focus:** GPT-5.6 reasoning, image context, function calling, strict structured output, validation, and Codex-assisted development.

## Before recording

1. Start the app with `npm run dev`, then open `/patient` and `/caretaker` in separate tabs.
2. Confirm the backend is ready and `OPENAI_MODEL=gpt-5.6-luna` is configured. Never record `.env` or an API key.
3. Prepare a clear local station image with a readable **PUNE JUNCTION** sign. In the patient view, use **Use camera** to upload it.
4. Pre-run this sequence once: `I am travelling to Indore.` → upload the Pune station image → `Please check this station for me.`
5. If the photo mismatch does not produce a caregiver action in the recorded take, send: `I feel scared and I do not know where I am.`
6. Prepare a safe code view of `server/agent.js` and `server/companion.js`; show `model: process.env.OPENAI_MODEL`, `reasoning`, `json_schema`, and `tools`, but never `.env`.

## Generated video assets

- `public/demo-video-assets/kikunet-opening-closing.png` — use for the opening and closing title card. Add the Kikunet title in your video editor on the empty left side.
- `public/demo-video-assets/pune-junction-mismatch.png` — upload this at 0:47 as the concrete Pune-versus-Indore mismatch image.
- `public/demo-video-assets/caregiver-dashboard-support.png` — use as a short visual cutaway before or after the live caretaker dashboard shot; the right side has room for a caption or dashboard overlay.

## Final recording script

### 0:00–0:14 — Hook

**Show:** Patient screen title and Nia’s companion panel.

**Say:**

> Hi, I’m [YOUR NAME], and this is Kikunet, an agentic safety companion for older adults and their caregivers. Small changes—a missed routine, a confusing journey, or silence—can leave caregivers unsure whether help is needed. Kikunet uses GPT-5.6 to turn everyday signals into evidence-based support, not automatic alarms.

### 0:14–0:29 — Calm patient support

**Show:** Medication reminders, a completed medicine tick, location-sharing note, and Nia’s input.

**Say:**

> On Meera’s patient screen, she can see today’s medication reminders, mark one as taken, and talk to Nia by text or voice. Her location is already shared with Ananya, so Nia does not add stress by asking Meera to share it again.

### 0:29–0:47 — GPT-5.6 retains context

**Show:** Type `I am travelling to Indore.` and show the remembered-destination panel.

**Say:**

> When Meera says, “I am travelling to Indore,” GPT-5.6 decides to call a tool that stores this destination as short-lived intent. That gives the next interaction context: the model can compare what Meera said with what she later shows.

### 0:47–1:12 — GPT-5.6 compares the photo with intent

**Show:** Use **Use camera** to upload the prepared Pune station image, type `Please check this station for me.`, and submit. Show the mismatch response.

**Say:**

> Now she shares a station photo and asks Nia to check it. GPT-5.6 receives the image alongside that stated intent. It reads the Pune Junction sign as a concrete mismatch with Indore, rather than making a generic guess. If Meera says she is scared or lost, it invokes the safety reasoning flow.

### 1:12–1:40 — Evidence reaches the caretaker

**Show:** Send the fallback distress message only if needed, then switch to the caretaker tab. Show the support plan, cited evidence, safe-zone context, and drift factors.

**Say:**

> On the caretaker view, Ananya sees GPT-5.6’s evidence-linked support plan: the facts it relied on, its decision and confidence, caregiver summary, and immediate action. The safe-zone and drift score add explainable context, but neither is the decision-maker. The model reasons over the evidence.

### 1:40–1:52 — Shared care continuity

**Show:** Medication acknowledgement and the daily caregiver journal.

**Say:**

> The same shared state keeps medication acknowledgements current and lets Ananya create a concise daily journal grounded only in recorded care events.

### 1:52–2:31 — OpenAI implementation and safety controls

**Show:** In `server/agent.js`, show `model: process.env.OPENAI_MODEL`, `reasoning: { effort: "medium" }`, and the strict JSON schema. In `server/companion.js`, show the tool definitions and the Responses API call. Then show `npm run evaluate` or passing tests.

**Say:**

> Here is the OpenAI implementation. Every Responses API request reads `model: process.env.OPENAI_MODEL`; this build uses the GPT-5.6 model configured as gpt-5.6-luna. For safety decisions, GPT-5.6 receives Meera’s persona, baseline, recent behavior, direct messages, surfaced deviations, and prior decisions. It reasons with medium effort and returns a strict JSON-schema decision with confidence, citations, actions, and caregiver summary. In the companion flow, GPT-5.6 chooses tools to check a schedule, record acknowledgement, remember intent, or escalate to Ananya. The server validates each decision, retries malformed output once, and falls back safely instead of inventing certainty.

### 2:31–2:50 — Codex and close

**Show:** Return to the caretaker and patient views, or end on the Kikunet title. Keep both views visible if possible.

**Say:**

> I used Codex throughout the build: translating the phase plan into React and Express, implementing shared state, tool calling, testing, and fast UI refinement. The evaluator accepts safe model latitude but rejects conclusions without evidence-linked reasoning. Kikunet makes care more contextual, compassionate, and accountable.

## Silent screen-capture checklist

1. Patient title and Nia’s idle companion panel.
2. Medication reminder marked as taken and location-sharing note.
3. Destination message and remembered intent.
4. Uploaded Pune Junction station image and Nia’s response.
5. Optional distress fallback and calm response.
6. Caretaker support plan, cited evidence, drift score, and safe-zone context.
7. Medication acknowledgement and generated daily journal.
8. Safe code clips for the Responses API model line, medium reasoning, strict JSON schema, and tool definitions.
9. `npm run evaluate` output or the passing test suite.
10. Final patient/caretaker/title shot.

## Pre-upload checklist

- Practice once at a natural pace; the narration is designed to stay below three minutes.
- Keep the video public on YouTube and include your voiceover throughout.
- Name the model accurately: “the GPT-5.6 model configured as `gpt-5.6-luna`.”
- Include the repository, project description, category, README, and required Codex feedback session ID in the submission.
- Review every clip for API keys, browser profile data, personal addresses, and live coordinates.
