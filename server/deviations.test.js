import test from "node:test";
import assert from "node:assert/strict";
import { baselinePayload, injectScenario } from "./behavior.js";
import { calculateBaselineStats, deviationPayload, surfaceDeviations } from "./deviations.js";

test("baseline reference contains expected timing, stationary duration, and locations", () => {
  const stats = calculateBaselineStats("2026-07-17");

  assert.equal(stats.expected_time_windows.length, 2);
  assert.equal(stats.daytime_stationary_duration_minutes.average, 46.7);
  assert.equal(stats.daytime_stationary_duration_minutes.maximum, 50);
  assert.equal(stats.expected_check_in_locations.length, 3);
  assert.equal(stats.expected_family_communication.event_count, 2);
});

test("normal-day data surfaces no deviations", () => {
  const baseline = baselinePayload();
  assert.deepEqual(surfaceDeviations(baseline.events, baseline.date), []);
});

test("each injected scenario surfaces the matching raw difference", () => {
  const expectedTypes = {
    missed_routine: "expected_event_not_observed",
    prolonged_stillness: "stationary_duration_above_baseline",
    off_route_station: "location_differs_from_baseline",
    communication_silence: "communication_count_below_baseline",
  };

  for (const [scenario, expectedType] of Object.entries(expectedTypes)) {
    const source = injectScenario(scenario);
    const deviations = surfaceDeviations(source.events, source.date);
    assert.equal(deviations.length, 1, scenario);
    assert.equal(deviations[0].deviation_type, expectedType, scenario);
  }
});

test("location differences retain the expected baseline routine context", () => {
  const source = injectScenario("off_route_station");
  const [deviation] = surfaceDeviations(source.events, source.date);

  assert.deepEqual(deviation.expected_context, {
    routine: "afternoon park visit",
    expected_location: "Cedar Grove Park",
  });
  assert.equal("location_changed" in deviation.difference, false);
});

test("surfaced output is factual and does not include decision fields or judgment terms", () => {
  const payload = deviationPayload(injectScenario("prolonged_stillness"));
  const output = JSON.stringify(payload.surfaced_deviations).toLowerCase();

  assert.equal("severity" in payload.surfaced_deviations[0], false);
  assert.equal("recommendation" in payload.surfaced_deviations[0], false);
  assert.equal("action" in payload.surfaced_deviations[0], false);
  for (const term of ["severe", "dangerous", "urgent", "notify", "monitor"]) {
    assert.equal(output.includes(term), false, `output must not include ${term}`);
  }
});
