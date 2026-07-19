import "dotenv/config";
import cors from "cors";
import express from "express";
import { SCENARIOS, baselinePayload, injectScenario } from "./behavior.js";
import { baselineDeviationPayload, deviationPayload } from "./deviations.js";
import { getPriorDecisions, makeAgentDecision, recordAgentDecision, resetAgentMemory } from "./agent.js";
import { conversationPayload } from "./conversation.js";
import { runEvaluation } from "./evaluation.js";
import { generateDailyJournal } from "./journal.js";
import { getLatestDailyActivityDate, getSharedState, recordDailyActivity, resetSharedState, saveAgentTrace, saveDailyJournal, updateDeviceLocation, updateSharedState, useSimulatedLocationFallback } from "./shared-state.js";
import { makeCompanionResponse } from "./companion.js";

const app = express();
const port = Number(process.env.PORT ?? 3001);
const host = process.env.SERVER_HOST ?? "127.0.0.1";
const clientOrigins = (process.env.CLIENT_ORIGIN ?? "http://127.0.0.1:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({ origin: clientOrigins.length === 1 ? clientOrigins[0] : clientOrigins }));
app.use(express.json({ limit: "8mb" }));

app.get("/api/health", (_request, response) => {
  response.json({
    status: "ok",
    message: "Backend connected and ready for Phase 1.",
  });
});

// Phase 5 shared state: both role-specific screens poll this small in-memory object.
app.get("/api/shared-state", (_request, response) => {
  response.json(getSharedState());
});

app.patch("/api/shared-state", (request, response) => {
  try {
    response.json(updateSharedState(request.body ?? {}));
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

// Phase 6: this is display-only location sharing. It updates the map and safe-zone
// factor without adding a second judgment path or changing the Phase 3 agent input.
app.post("/api/location/device", (request, response) => {
  try {
    response.json(updateDeviceLocation(request.body ?? {}));
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

app.post("/api/location/fallback", (_request, response) => {
  response.json(useSimulatedLocationFallback());
});

app.get("/api/journal/today", (request, response) => {
  const journal = getSharedState().daily_journal;
  const requestedDate = request.query.date;
  response.json({ journal: !requestedDate || journal?.date === requestedDate ? journal : null });
});

app.post("/api/journal/generate", async (request, response) => {
  try {
    const date = request.body?.date ?? getLatestDailyActivityDate() ?? new Date().toISOString().slice(0, 10);
    const generated = await generateDailyJournal({ date });
    const journal = generated.status === "ready" ? saveDailyJournal(generated) : null;
    response.json({ ...generated, journal });
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

app.get("/api/behavior/baseline", (request, response) => {
  response.json(baselinePayload(request.query.date));
});

app.get("/api/behavior/scenarios", (_request, response) => {
  response.json({ scenarios: Object.entries(SCENARIOS).map(([id, details]) => ({ id, ...details })) });
});

app.get("/api/behavior/scenarios/:scenarioId", (request, response) => {
  try {
    response.json(injectScenario(request.params.scenarioId, request.query.date));
  } catch (error) {
    response.status(404).json({ error: error.message, available_scenarios: Object.keys(SCENARIOS) });
  }
});

app.get("/api/deviations/baseline", (request, response) => {
  response.json(baselineDeviationPayload(request.query.date));
});

app.get("/api/deviations/scenarios/:scenarioId", (request, response) => {
  try {
    response.json(deviationPayload(injectScenario(request.params.scenarioId, request.query.date)));
  } catch (error) {
    response.status(404).json({ error: error.message, available_scenarios: Object.keys(SCENARIOS) });
  }
});

app.post("/api/agent/decide", async (request, response) => {
  const { scenario_id: scenarioId, date } = request.body ?? {};
  if (!scenarioId || !SCENARIOS[scenarioId]) {
    response.status(400).json({ error: "Provide a valid scenario_id.", available_scenarios: Object.keys(SCENARIOS) });
    return;
  }

  const context = deviationPayload(injectScenario(scenarioId, date));
  const priorDecisions = getPriorDecisions(context.persona.id);
  const agentDecision = await makeAgentDecision(context, priorDecisions);
  const memoryRecord = recordAgentDecision(context.persona.id, agentDecision, {
    scenarioId: context.scenario?.id,
    surfacedDeviations: context.surfaced_deviations,
  });
  recordDailyActivity({
    date: context.date,
    type: "agent_decision",
    details: {
      source: "passive_monitoring",
      scenario_id: context.scenario?.id ?? null,
      decision: agentDecision.decision,
      confidence: agentDecision.confidence,
      caregiver_summary: agentDecision.caregiver_summary,
      surfaced_deviation_ids: context.surfaced_deviations.map((deviation) => deviation.id),
    },
  });
  saveAgentTrace({
    source: "passive_monitoring",
    persona: context.persona,
    decision: agentDecision,
    surfacedDeviations: context.surfaced_deviations,
    recentBehaviorHistory: context.recent_behavior_history,
  });

  response.json({
    persona: context.persona,
    date: context.date,
    recent_behavior_history: context.recent_behavior_history,
    surfaced_deviations: context.surfaced_deviations,
    agent_decision: agentDecision,
    decision_memory_record: memoryRecord,
  });
});

app.post("/api/agent/memory/reset", (request, response) => {
  resetAgentMemory(request.body?.persona_id);
  resetSharedState();
  response.json({ status: "ok", message: "Agent decision memory and shared demo state cleared." });
});

app.post("/api/agent/conversation", async (request, response) => {
  try {
    const { message, scenario_id: scenarioId, date } = request.body ?? {};
    const context = conversationPayload({ message, scenarioId, date });
    const priorDecisions = getPriorDecisions(context.persona.id);
    const agentDecision = await makeAgentDecision(context, priorDecisions);
    const memoryRecord = recordAgentDecision(context.persona.id, agentDecision, {
      scenarioId: context.scenario?.id ?? "direct_user_message",
      surfacedDeviations: context.surfaced_deviations,
    });
    recordDailyActivity({
      date: context.date,
      type: "agent_decision",
      details: {
        source: "patient_conversation",
        decision: agentDecision.decision,
        confidence: agentDecision.confidence,
        caregiver_summary: agentDecision.caregiver_summary,
        message: context.direct_user_message.text,
        surfaced_deviation_ids: context.surfaced_deviations.map((deviation) => deviation.id),
      },
    });
    saveAgentTrace({
      source: "patient_conversation",
      persona: context.persona,
      decision: agentDecision,
      surfacedDeviations: context.surfaced_deviations,
      recentBehaviorHistory: context.recent_behavior_history,
    });
    response.json({
      persona: context.persona,
      direct_user_message: context.direct_user_message,
      surfaced_deviations: context.surfaced_deviations,
      agent_decision: agentDecision,
      decision_memory_record: memoryRecord,
    });
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

app.post("/api/companion/chat", async (request, response) => {
  try {
    const { message, image_data_url: imageDataUrl, vision_preset_id: visionPresetId, scenario_id: scenarioId, date } = request.body ?? {};
    const context = conversationPayload({ message, scenarioId, date });
    const priorDecisions = getPriorDecisions(context.persona.id);
    const companion = await makeCompanionResponse({ message: context.direct_user_message.text, imageDataUrl, visionPresetId, conversationContext: context, priorDecisions });
    let memoryRecord = null;
    if (companion.agent_decision) {
      memoryRecord = recordAgentDecision(context.persona.id, companion.agent_decision, {
        scenarioId: context.scenario?.id ?? "companion_escalation",
        surfacedDeviations: context.surfaced_deviations,
      });
      recordDailyActivity({
        date: context.date,
        type: "agent_decision",
        details: {
          source: "patient_companion",
          decision: companion.agent_decision.decision,
          confidence: companion.agent_decision.confidence,
          caregiver_summary: companion.agent_decision.caregiver_summary,
          message: context.direct_user_message.text,
          surfaced_deviation_ids: context.surfaced_deviations.map((deviation) => deviation.id),
        },
      });
      saveAgentTrace({
        source: "patient_companion",
        persona: context.persona,
        decision: companion.agent_decision,
        surfacedDeviations: context.surfaced_deviations,
        recentBehaviorHistory: context.recent_behavior_history,
      });
    }
    const toolActions = companion.tool_actions.filter((action) => action.success).map((action) => action.name);
    if (toolActions.length > 0 || companion.agent_decision) {
      recordDailyActivity({
        date: context.date,
        type: "companion_interaction",
        details: {
          message: context.direct_user_message.text,
          reply: companion.text,
          tool_actions: toolActions,
        },
      });
    }
    if (toolActions.includes("escalate_to_caregiver")) {
      recordDailyActivity({
        date: context.date,
        type: "caregiver_escalation",
        details: {
          message: context.direct_user_message.text,
          decision: companion.agent_decision?.decision ?? null,
          caregiver_summary: companion.agent_decision?.caregiver_summary ?? null,
        },
      });
    }
    response.json({
      persona: context.persona,
      direct_user_message: context.direct_user_message,
      companion_response: companion,
      shared_state: getSharedState(),
      decision_memory_record: memoryRecord,
    });
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

app.post("/api/evaluation/run", async (request, response) => {
  const report = await runEvaluation({ date: request.body?.date });
  response.json(report);
});

app.listen(port, host, () => {
  console.log(`Safety Companion API listening on http://${host}:${port}`);
});
