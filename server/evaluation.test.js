import test from "node:test";
import assert from "node:assert/strict";
import { EVALUATION_CASES, runEvaluation } from "./evaluation.js";

function decisionFor(decision, deviationId, citedFacts = ["test fact"]) {
  const evidence = {
    statement: "The decision cites a surfaced deviation and its recorded facts.",
    surfaced_deviation_ids: [deviationId],
    cited_facts: citedFacts,
  };
  return {
    decision,
    confidence: "medium",
    model: "gpt-5.6-luna",
    fallback: false,
    interpretation: [evidence],
    plausible_explanations: [evidence],
    uncertainty_assessment: [evidence],
    reasoning: [evidence],
    immediate_action: "Take the selected action.",
    follow_up_action: "Check for a later update.",
    caregiver_summary: "Decision based on the cited deviation facts.",
    escalation_flag: false,
  };
}

test("evaluation defines one acceptable decision set for every demo scenario", () => {
  assert.equal(EVALUATION_CASES.length, 4);
  for (const evaluationCase of EVALUATION_CASES) {
    assert.ok(evaluationCase.acceptable_decisions.length > 0);
  }
});

test("evaluation reports a match for decisions within each acceptable set", async () => {
  const report = await runEvaluation({
    decide: async (context) => {
      const evaluationCase = EVALUATION_CASES.find(
        (item) => item.scenario_id === context.scenario.id,
      );
      const decision = context.scenario.id === "prolonged_stillness"
        ? "conversational_prompt"
        : evaluationCase.acceptable_decisions[0];
      return decisionFor(decision, context.surfaced_deviations[0].id);
    },
  });

  assert.equal(report.passed, 4);
  assert.equal(report.failed, 0);
  assert.ok(report.results.every((result) => result.verdict === "match" && result.evidence_complete));
});

test("evaluation reports a mismatch for an unacceptable decision", async () => {
  const report = await runEvaluation({ decide: async (context) => decisionFor("navigation_assist", context.surfaced_deviations[0].id) });

  assert.equal(report.results.find((result) => result.scenario_id === "missed_routine").verdict, "mismatch");
  assert.equal(report.results.find((result) => result.scenario_id === "prolonged_stillness").verdict, "mismatch");
});

test("prolonged stillness accepts monitoring only with cited recovery evidence", async () => {
  const report = await runEvaluation({
    decide: async (context) => {
      if (context.scenario.id !== "prolonged_stillness") {
        return decisionFor(
          EVALUATION_CASES.find((evaluationCase) => evaluationCase.scenario_id === context.scenario.id).acceptable_decisions[0],
          context.surfaced_deviations[0].id,
        );
      }
      return decisionFor("continue_monitoring", context.surfaced_deviations[0].id, [
        "actual_duration_minutes: 155",
        "evt-019 medication_reminder_ack at 20:30 after the stationary period",
      ]);
    },
  });

  const result = report.results.find((item) => item.scenario_id === "prolonged_stillness");
  assert.equal(result.verdict, "match");
  assert.equal(result.recovery_evidence_complete, true);
  assert.equal(result.reasoning_consistent, true);
});

test("prolonged stillness monitoring without cited recovery evidence fails", async () => {
  const report = await runEvaluation({
    decide: async (context) => decisionFor(
      context.scenario.id === "prolonged_stillness" ? "continue_monitoring" : EVALUATION_CASES.find(
        (evaluationCase) => evaluationCase.scenario_id === context.scenario.id,
      ).acceptable_decisions[0],
      context.surfaced_deviations[0].id,
      ["actual_duration_minutes: 155", "baseline_maximum_minutes: 50"],
    ),
  });

  const result = report.results.find((item) => item.scenario_id === "prolonged_stillness");
  assert.equal(result.verdict, "mismatch");
  assert.equal(result.evidence_complete, true);
  assert.equal(result.structured_output_valid, true);
  assert.equal(result.recovery_evidence_complete, false);
});

test("responses without evidence-linked reasoning fail evaluation", async () => {
  const report = await runEvaluation({
    decide: async (context) => ({
      ...decisionFor("conversational_prompt", context.surfaced_deviations[0].id),
      reasoning: [{ statement: "No cited evidence.", surfaced_deviation_ids: [], cited_facts: [] }],
    }),
  });

  assert.ok(report.results.every((result) => result.verdict === "mismatch"));
  assert.ok(report.results.every((result) => result.structured_output_valid === false));
});
