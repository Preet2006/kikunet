import { baselinePayload, injectScenario } from "./behavior.js";
import { calculateBaselineStats, deviationPayload } from "./deviations.js";

/** Builds Phase 3 context for a direct user report without using Phase 2. */
export function conversationPayload({ message, scenarioId = null, date }) {
  const trimmedMessage = message?.trim();
  if (!trimmedMessage) throw new Error("A non-empty user message is required.");

  if (scenarioId) {
    const payload = deviationPayload(injectScenario(scenarioId, date));
    return {
      ...payload,
      direct_user_message: {
        id: `direct-message-${Date.now()}`,
        text: trimmedMessage,
        received_at: new Date().toISOString(),
      },
    };
  }

  const baseline = baselinePayload(date);
  return {
    persona: baseline.persona,
    date: baseline.date,
    scenario: null,
    recent_behavior_history: baseline.events,
    baseline_reference: calculateBaselineStats(baseline.date),
    surfaced_deviations: [],
    direct_user_message: {
      id: `direct-message-${Date.now()}`,
      text: trimmedMessage,
      received_at: new Date().toISOString(),
    },
  };
}
