import test from "node:test";
import assert from "node:assert/strict";
import { conversationPayload } from "./conversation.js";
import { validateAgentDecision } from "./agent.js";

test("direct conversation creates Phase 3 context without a surfaced deviation", () => {
  const payload = conversationPayload({ message: "I feel scared and do not know where I am." });

  assert.equal(payload.surfaced_deviations.length, 0);
  assert.equal(payload.direct_user_message.text, "I feel scared and do not know where I am.");
  assert.match(payload.direct_user_message.id, /^direct-message-/);
  assert.ok(payload.recent_behavior_history.length > 0);
});

test("conversation can include existing scenario context without processing text through Phase 2", () => {
  const payload = conversationPayload({ message: "I think I am lost.", scenarioId: "off_route_station" });

  assert.equal(payload.surfaced_deviations.length, 1);
  assert.equal(payload.direct_user_message.text, "I think I am lost.");
});

test("direct-message evidence is valid without a surfaced deviation", () => {
  const payload = conversationPayload({ message: "I am scared and do not know where I am." });
  const item = {
    statement: "The user said they are scared and do not know where they are.",
    surfaced_deviation_ids: [payload.direct_user_message.id],
    cited_facts: ["direct message: I am scared and do not know where I am."],
  };
  const decision = {
    decision: "navigation_assist", confidence: "high", interpretation: [item],
    plausible_explanations: [item], uncertainty_assessment: [item], reasoning: [item],
    immediate_action: "Offer location guidance.", follow_up_action: "Ask for the current location.",
    caregiver_summary: "User reported being scared and disoriented.", escalation_flag: false,
  };

  assert.equal(
    validateAgentDecision(decision, [], [payload.direct_user_message.id]).decision,
    "navigation_assist",
  );
});
