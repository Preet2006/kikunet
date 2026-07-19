import test from "node:test";
import assert from "node:assert/strict";
import { distanceInMeters, driftInputsFromDeviations, safeZoneRisk } from "./dashboard.js";

const safeZone = { center: { lat: 19.076, lng: 72.8777 }, radius_meters: 3000 };

test("safe-zone risk is display-only and increases outside the configured radius", () => {
  assert.equal(safeZoneRisk({ lat: 19.076, lng: 72.8777 }, safeZone), 0);
  assert.ok(distanceInMeters({ lat: 19.076, lng: 72.8777 }, { lat: 19.0598, lng: 72.8404 }) > 3000);
  assert.ok(safeZoneRisk({ lat: 19.0598, lng: 72.8404 }, safeZone) > 0);
});

test("drift factor inputs are deterministic aggregates of surfaced facts", () => {
  const inputs = driftInputsFromDeviations([{ deviation_type: "location_differs_from_baseline" }], { lat: 19.0598, lng: 72.8404 }, safeZone);
  assert.equal(inputs.routine_deviation, 80);
  assert.ok(inputs.safe_zone_adherence > 0);
  assert.equal(inputs.medication_adherence, 0);
});

test("a missing medication acknowledgement contributes to the display-only adherence factor", () => {
  const inputs = driftInputsFromDeviations([{
    deviation_type: "expected_event_not_observed",
    expected: { event_type: "medication_reminder_ack" },
  }], { lat: 19.076, lng: 72.8777 }, safeZone);

  assert.equal(inputs.medication_adherence, 65);
});
