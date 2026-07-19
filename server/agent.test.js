import test from "node:test";
import assert from "node:assert/strict";
import { injectScenario } from "./behavior.js";
import { deviationPayload } from "./deviations.js";
import { assembleAgentContext, makeAgentDecision, recordAgentDecision, resetAgentMemory, validateAgentDecision } from "./agent.js";

function validDecision(deviationId) {
  const evidence = {
    statement: "The location deviation records Central Railway Station as actual and Cedar Grove Park as expected.",
    surfaced_deviation_ids: [deviationId],
    cited_facts: ["actual_location: Central Railway Station", "expected_location: Cedar Grove Park"],
  };

  return {
    decision: "navigation_assist",
    confidence: "medium",
    interpretation: [evidence],
    plausible_explanations: [{ ...evidence, statement: "The location difference could reflect a changed plan, because the recorded actual location is Central Railway Station instead of Cedar Grove Park." }],
    uncertainty_assessment: [{ ...evidence, statement: "Confidence is medium because the deviation confirms the location difference but does not record Meera's purpose at Central Railway Station." }],
    reasoning: [evidence],
    immediate_action: "Offer navigation assistance that mentions Central Railway Station and the expected Cedar Grove Park visit.",
    follow_up_action: "Recheck for a location update after offering assistance.",
    caregiver_summary: "Meera checked in at Central Railway Station where the baseline expected Cedar Grove Park; navigation assistance was selected.",
    escalation_flag: false,
  };
}

test("agent context contains persona, baseline, recent history, deviations, and memory", () => {
  const payload = deviationPayload(injectScenario("off_route_station"));
  const context = assembleAgentContext(payload, [{ decision: "conversational_prompt" }]);

  assert.equal(context.persona_profile.name, "Meera Shah");
  assert.ok(context.baseline_reference.expected_check_in_locations.length > 0);
  assert.equal(context.recent_behavior_history.length, payload.recent_behavior_history.length);
  assert.equal(context.surfaced_deviations.length, 1);
  assert.equal(context.prior_agent_decisions.length, 1);
});

test("agent context identifies a prior decision for the same surfaced deviation", () => {
  const payload = deviationPayload(injectScenario("off_route_station"));
  const personaId = payload.persona.id;
  const decision = validDecision(payload.surfaced_deviations[0].id);

  resetAgentMemory(personaId);
  const prior = recordAgentDecision(personaId, decision, {
    scenarioId: "off_route_station",
    surfacedDeviations: payload.surfaced_deviations,
  });
  const context = assembleAgentContext(payload, [prior]);

  assert.equal(context.recurrence_context.matching_prior_decision_count, 1);
  assert.equal(context.recurrence_context.resolution_event_supplied, false);
  resetAgentMemory(personaId);
});

test("agent decision validation requires surfaced-deviation evidence", () => {
  const payload = deviationPayload(injectScenario("off_route_station"));
  const decision = validDecision(payload.surfaced_deviations[0].id);

  assert.equal(validateAgentDecision(decision, payload.surfaced_deviations).decision, "navigation_assist");
  decision.reasoning[0].surfaced_deviation_ids = ["not-a-real-deviation"];
  assert.throws(() => validateAgentDecision(decision, payload.surfaced_deviations), /unknown evidence/);
});

test("malformed model output is retried once before accepting a valid decision", async () => {
  const payload = deviationPayload(injectScenario("off_route_station"));
  let calls = 0;
  const requestDecision = async (_context, retry) => {
    calls += 1;
    if (!retry) return { decision: "navigation_assist" };
    return validDecision(payload.surfaced_deviations[0].id);
  };

  const decision = await makeAgentDecision(payload, [], { requestDecision });
  assert.equal(calls, 2);
  assert.equal(decision.fallback, false);
  assert.equal(decision.decision, "navigation_assist");
});

test("two invalid model outputs produce a visible fallback instead of a crash", async () => {
  const payload = deviationPayload(injectScenario("missed_routine"));
  const decision = await makeAgentDecision(payload, [], { requestDecision: async () => ({}) });

  assert.equal(decision.fallback, true);
  assert.equal(decision.decision, "continue_monitoring");
  assert.match(decision.system_note, /Model output fallback/);
});

test("agent responses record the configured gpt-5.6-luna model", async () => {
  const previousModel = process.env.OPENAI_MODEL;
  process.env.OPENAI_MODEL = "gpt-5.6-luna";

  try {
    const payload = deviationPayload(injectScenario("off_route_station"));
    const decision = await makeAgentDecision(payload, [], {
      requestDecision: async () => validDecision(payload.surfaced_deviations[0].id),
    });
    assert.equal(decision.model, "gpt-5.6-luna");
  } finally {
    if (previousModel === undefined) delete process.env.OPENAI_MODEL;
    else process.env.OPENAI_MODEL = previousModel;
  }
});
