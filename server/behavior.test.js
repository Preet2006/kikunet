import test from "node:test";
import assert from "node:assert/strict";
import { EVENT_TYPES, SCENARIOS, baselinePayload, injectScenario } from "./behavior.js";

test("baseline day has ordered events that use the documented schema", () => {
  const payload = baselinePayload();

  assert.equal(payload.events.length, 20);
  assert.deepEqual(
    [...payload.events].map((event) => event.timestamp),
    payload.events.map((event) => event.timestamp),
  );

  for (const event of payload.events) {
    assert.ok(event.id);
    assert.ok(event.timestamp);
    assert.ok(["morning", "afternoon", "evening", "night"].includes(event.time_of_day));
    assert.ok(EVENT_TYPES.includes(event.event_type));
    assert.ok(event.location);
    assert.equal(typeof event.context, "object");
    assert.ok(event.context.expected_location);
    if (event.event_type === "location_check_in") {
      assert.equal(typeof event.lat, "number");
      assert.equal(typeof event.lng, "number");
    }
  }
});

test("persona profile includes context required for later reasoning", () => {
  const { persona } = baselinePayload();

  assert.equal(persona.mobility_level, "independent");
  assert.equal(persona.cognitive_risk, "mild");
  assert.equal(persona.usual_transport, "walking");
  assert.equal(persona.emergency_contact.relationship, "Daughter");
  assert.equal(persona.language, "English");
});

test("each hardcoded scenario visibly changes the baseline event stream", () => {
  const baseline = baselinePayload().events;

  for (const scenario of Object.keys(SCENARIOS)) {
    const result = injectScenario(scenario);
    assert.ok(result.injected_anomaly);
    assert.notDeepEqual(result.events, baseline);
  }
});

test("scenario injectors make the intended alterations", () => {
  assert.equal(injectScenario("missed_routine").events.some((event) => event.id === "evt-005"), false);
  assert.equal(injectScenario("prolonged_stillness").events.find((event) => event.id === "evt-016").context.duration_minutes, 155);
  assert.equal(injectScenario("off_route_station").events.find((event) => event.id === "evt-013").location, "Central Railway Station");
  assert.equal(injectScenario("off_route_station").events.find((event) => event.id === "evt-013").context.expected_location, "Cedar Grove Park");
  assert.equal(typeof injectScenario("off_route_station").events.find((event) => event.id === "evt-013").lat, "number");
  assert.equal(injectScenario("communication_silence").events.some((event) => event.id === "evt-014"), false);
  assert.equal(injectScenario("communication_silence").events.some((event) => event.id === "evt-017"), false);
});
