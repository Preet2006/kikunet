import test from "node:test";
import assert from "node:assert/strict";
import { buildCompanionInput, makeCompanionResponse, validateVisionImage } from "./companion.js";
import { getActiveCompanionIntents, resetSharedState } from "./shared-state.js";
import { conversationPayload } from "./conversation.js";

test("companion creates a shared reminder only after a function call", async () => {
  resetSharedState();
  const responses = [
    { output: [{ type: "function_call", name: "create_reminder", call_id: "call-1", arguments: '{"name":"iron tablet","time":"18:00"}' }] },
    { output: [], output_text: "Of course. I’ve set a reminder for your iron tablet at 6:00 PM." },
  ];
  const context = conversationPayload({ message: "Remind me to take my iron tablet at 6pm." });
  const result = await makeCompanionResponse({
    message: context.direct_user_message.text,
    conversationContext: context,
    requestResponse: async () => responses.shift(),
  });

  assert.equal(result.tool_actions[0].name, "create_reminder");
  assert.equal(result.tool_actions[0].success, true);
  assert.equal(result.tool_actions[0].result.reminder.time, "18:00");
  assert.match(result.text, /set a reminder/i);
});

test("companion returns only the actual shared schedule through get_schedule", async () => {
  resetSharedState();
  const context = conversationPayload({ message: "When is my vitamin tablet?" });
  const responses = [
    { output: [{ type: "function_call", name: "get_schedule", call_id: "call-2", arguments: "{}" }] },
    { output: [], output_text: "I don’t have a vitamin tablet in your schedule." },
  ];
  const result = await makeCompanionResponse({ message: context.direct_user_message.text, conversationContext: context, requestResponse: async () => responses.shift() });

  assert.deepEqual(result.tool_actions[0].result.schedule, []);
  assert.match(result.text, /don’t have/i);
});

test("companion sends a selected photo alongside the same dashboard context", () => {
  const imageDataUrl = "data:image/png;base64,aGVsbG8=";
  const input = buildCompanionInput({ message: "Where am I?", dashboardContext: { drift: { score: 0 } }, imageDataUrl });

  assert.equal(input[0].content[0].type, "input_text");
  assert.equal(input[0].content[1].type, "input_image");
  assert.equal(input[0].content[1].image_url, imageDataUrl);
  assert.equal(input[0].content[1].detail, "low");
});

test("vision input accepts supported images and rejects unsupported data", () => {
  assert.equal(validateVisionImage("data:image/jpeg;base64,aGVsbG8="), "data:image/jpeg;base64,aGVsbG8=");
  assert.throws(() => validateVisionImage("data:text/plain;base64,aGVsbG8="), /PNG, JPEG, or WebP/);
});

test("companion saves a stated destination for the next verification photo", async () => {
  resetSharedState();
  const responses = [
    { output: [{ type: "function_call", name: "set_stated_intent", call_id: "intent-1", arguments: '{"type":"destination","value":"Indore"}' }] },
    { output: [], output_text: "I will keep Indore in mind. Show me a photo when you are there." },
  ];
  const context = conversationPayload({ message: "I am heading to Indore." });
  const result = await makeCompanionResponse({ message: context.direct_user_message.text, conversationContext: context, requestResponse: async () => responses.shift() });

  assert.equal(result.tool_actions[0].name, "set_stated_intent");
  assert.equal(getActiveCompanionIntents().destination.value, "Indore");
});

test("a selected demo photo supplies visual details without supplying a match verdict", () => {
  const input = buildCompanionInput({
    message: "Does this match where I am going?",
    dashboardContext: { active_stated_intents: { destination: { value: "Indore" } } },
    visionPreset: { id: "pune_station", label: "Different station", visible_details: "The sign reads PUNE JUNCTION." },
  });
  const context = JSON.parse(input[0].content[0].text);

  assert.equal(context.selected_demo_photo.visible_details, "The sign reads PUNE JUNCTION.");
  assert.equal(Object.hasOwn(context.selected_demo_photo, "matches"), false);
  assert.equal(context.dashboard_context.active_stated_intents.destination.value, "Indore");
});
