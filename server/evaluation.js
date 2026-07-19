import { injectScenario } from "./behavior.js";
import { makeAgentDecision, resetAgentMemory, validateAgentDecision } from "./agent.js";
import { deviationPayload } from "./deviations.js";

/**
 * Hand-authored evaluation expectations. Each set allows legitimate model latitude,
 * while ruling out interventions unrelated to the surfaced facts.
 */
export const EVALUATION_CASES = Object.freeze([
  {
    scenario_id: "missed_routine",
    acceptable_decisions: ["conversational_prompt", "notify_caregiver"],
  },
  {
    scenario_id: "prolonged_stillness",
    acceptable_decisions: ["continue_monitoring", "conversational_prompt", "notify_caregiver"],
  },
  {
    scenario_id: "off_route_station",
    // Later same-day events may establish that Meera resumed her routine, so monitoring
    // is an acceptable context-aware decision alongside active navigation or notification.
    acceptable_decisions: ["continue_monitoring", "navigation_assist", "notify_caregiver"],
  },
  {
    scenario_id: "communication_silence",
    acceptable_decisions: ["conversational_prompt", "notify_caregiver"],
  },
]);

function evidenceComplete(decision) {
  const items = [
    ...(decision.interpretation ?? []),
    ...(decision.plausible_explanations ?? []),
    ...(decision.uncertainty_assessment ?? []),
    ...(decision.reasoning ?? []),
  ];

  return items.length > 0 && items.every((item) =>
    item.surfaced_deviation_ids?.length > 0 && item.cited_facts?.length > 0,
  );
}

function allReasoningItems(decision) {
  return [
    ...(decision.interpretation ?? []),
    ...(decision.plausible_explanations ?? []),
    ...(decision.uncertainty_assessment ?? []),
    ...(decision.reasoning ?? []),
  ];
}

function hasRecoveryEvidence(decision, context) {
  const stillnessDeviation = context.surfaced_deviations.find(
    (deviation) => deviation.deviation_type === "stationary_duration_above_baseline",
  );
  if (!stillnessDeviation) return false;

  const citedFacts = allReasoningItems(decision)
    .filter((item) => item.surfaced_deviation_ids?.includes(stillnessDeviation.id))
    .flatMap((item) => item.cited_facts ?? [])
    .join(" ")
    .toLowerCase();

  // These are concrete facts from the events following the stationary period, not
  // evaluator-supplied interpretations. At least one must be cited for monitoring to pass.
  const recoveryEvidenceTokens = [
    "evt-019",
    "20:30",
    "evening medication",
    "medication_reminder_ack",
    "evt-020",
    "22:00",
    "overnight rest",
  ];

  return recoveryEvidenceTokens.some((token) => citedFacts.includes(token));
}

function evaluateAgentDecision(evaluationCase, agentDecision, context) {
  let structuredOutputValid = true;
  try {
    validateAgentDecision(agentDecision, context.surfaced_deviations);
  } catch {
    structuredOutputValid = false;
  }

  const hasEvidence = evidenceComplete(agentDecision);
  const requiresRecoveryEvidence =
    evaluationCase.scenario_id === "prolonged_stillness" && agentDecision.decision === "continue_monitoring";
  const recoveryEvidenceComplete = requiresRecoveryEvidence
    ? hasRecoveryEvidence(agentDecision, context)
    : true;
  const matchesDecision = evaluationCase.acceptable_decisions.includes(agentDecision.decision);

  return {
    actual_decision: agentDecision.decision ?? null,
    confidence: agentDecision.confidence ?? null,
    model: agentDecision.model ?? null,
    fallback: Boolean(agentDecision.fallback),
    evidence_complete: hasEvidence,
    structured_output_valid: structuredOutputValid,
    reasoning_consistent: !requiresRecoveryEvidence || recoveryEvidenceComplete,
    recovery_evidence_complete: requiresRecoveryEvidence ? recoveryEvidenceComplete : null,
    verdict: matchesDecision && structuredOutputValid && hasEvidence && recoveryEvidenceComplete && !agentDecision.fallback
      ? "match"
      : "mismatch",
  };
}

/** Runs every scenario through the deviation and autonomous-reasoning pipeline. */
export async function runEvaluation({ date, decide = makeAgentDecision } = {}) {
  const results = [];

  for (const evaluationCase of EVALUATION_CASES) {
    const context = deviationPayload(injectScenario(evaluationCase.scenario_id, date));
    resetAgentMemory(context.persona.id);

    try {
      const agentDecision = await decide(context, []);
      results.push({
        scenario_id: evaluationCase.scenario_id,
        acceptable_decisions: evaluationCase.acceptable_decisions,
        ...evaluateAgentDecision(evaluationCase, agentDecision, context),
      });
    } catch (error) {
      results.push({
        scenario_id: evaluationCase.scenario_id,
        acceptable_decisions: evaluationCase.acceptable_decisions,
        actual_decision: null,
        confidence: null,
        model: null,
        fallback: false,
        evidence_complete: false,
        structured_output_valid: false,
        reasoning_consistent: false,
        recovery_evidence_complete: null,
        verdict: "mismatch",
        error: error.message,
      });
    } finally {
      resetAgentMemory(context.persona.id);
    }
  }

  const passed = results.filter((result) => result.verdict === "match").length;
  return {
    run_at: new Date().toISOString(),
    total: results.length,
    passed,
    failed: results.length - passed,
    results,
  };
}
