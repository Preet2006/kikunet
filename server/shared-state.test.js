import test from "node:test";
import assert from "node:assert/strict";
import { getActiveCompanionIntents, getSharedState, resetSharedState, saveAgentTrace, saveCompanionIntent, updateDeviceLocation, updateSharedState, useSimulatedLocationFallback } from "./shared-state.js";

test("shared dashboard state persists a write for both polling clients", () => {
  resetSharedState();
  updateSharedState({ distress_alert: { active: true, message: "Dummy shared-state check" } });

  const caretakerPoll = getSharedState();
  const patientPoll = getSharedState();
  assert.deepEqual(caretakerPoll.distress_alert, { active: true, message: "Dummy shared-state check" });
  assert.deepEqual(patientPoll.distress_alert, caretakerPoll.distress_alert);
});

test("changing a safe-zone radius recalculates the display-only safe-zone factor", () => {
  resetSharedState();
  updateSharedState({ current_location: { label: "Test location", lat: 19.0598, lng: 72.8404 } });
  const before = getSharedState().drift_inputs.safe_zone_adherence;
  updateSharedState({ safe_zone: { center: { lat: 19.076, lng: 72.8777 }, radius_meters: 6000, label: "Home" } });
  const after = getSharedState().drift_inputs.safe_zone_adherence;

  assert.ok(before > after);
  assert.equal(after, 0);
});

test("changing the safe-zone centre persists and recalculates the display-only factor", () => {
  resetSharedState();
  const centre = { lat: 19.0598, lng: 72.8404 };
  updateSharedState({ current_location: { label: "Test location", ...centre } });
  updateSharedState({ safe_zone: { center: centre, radius_meters: 500, label: "New home" } });

  const state = getSharedState();
  assert.deepEqual(state.safe_zone.center, centre);
  assert.equal(state.safe_zone.label, "New home");
  assert.equal(state.drift_inputs.safe_zone_adherence, 0);
});

test("medication schedule entries persist for a patient polling the shared state", () => {
  resetSharedState();
  const schedule = [{ id: "med-1", name: "Evening tablet", time: "20:30" }];
  updateSharedState({ medication_schedule: schedule });

  assert.deepEqual(getSharedState().medication_schedule, schedule);
});

test("only a patient notify_caregiver decision raises a shared distress alert", () => {
  resetSharedState();
  const persona = { id: "meera-shah", name: "Meera Shah" };
  const decision = { decision: "notify_caregiver", caregiver_summary: "Meera reported feeling lost.", immediate_action: "Contact Ananya." };
  saveAgentTrace({ source: "patient_conversation", persona, decision, timestamp: "2026-07-18T12:00:00.000Z" });
  assert.deepEqual(getSharedState().distress_alert, { active: true, message: "Meera reported feeling lost.", immediate_action: "Contact Ananya.", raised_at: "2026-07-18T12:00:00.000Z" });

  resetSharedState();
  saveAgentTrace({ source: "patient_conversation", persona, decision: { ...decision, decision: "conversational_prompt" } });
  assert.equal(getSharedState().distress_alert, false);
});

test("a companion escalation raises the same shared distress alert", () => {
  resetSharedState();
  saveAgentTrace({
    source: "patient_companion",
    persona: { id: "meera-shah", name: "Meera Shah" },
    decision: { decision: "notify_caregiver", caregiver_summary: "Meera needs support.", immediate_action: "Contact Ananya." },
  });

  assert.equal(getSharedState().distress_alert.active, true);
});

test("a caretaker can acknowledge a distress alert without clearing the agent trace", () => {
  resetSharedState();
  updateSharedState({ latest_agent_trace: { source: "patient_conversation", decision: { decision: "notify_caregiver" } }, distress_alert: { active: true, message: "Needs support" } });
  updateSharedState({ distress_alert: false });

  assert.equal(getSharedState().distress_alert, false);
  assert.equal(getSharedState().latest_agent_trace.decision.decision, "notify_caregiver");
});

test("companion retains destination and medicine intents only for the active short-lived session", () => {
  resetSharedState();
  const start = Date.now();
  saveCompanionIntent({ type: "destination", value: "Indore", timestamp: new Date(start).toISOString() });
  saveCompanionIntent({ type: "medication", value: "Paracetamol", timestamp: new Date(start + 60_000).toISOString() });

  const active = getActiveCompanionIntents(start + 10 * 60_000);
  assert.equal(active.destination.value, "Indore");
  assert.equal(active.medication.value, "Paracetamol");
  assert.deepEqual(getActiveCompanionIntents(start + 21 * 60_000), {});
});

test("a real device location updates only the display-layer safe-zone signal", () => {
  resetSharedState();
  updateDeviceLocation({
    lat: 19.0598,
    lng: 72.8404,
    accuracy_meters: 18.7,
    observed_at: "2026-07-19T10:00:00.000Z",
  });

  const state = getSharedState();
  assert.deepEqual(state.current_location, {
    label: "Meera's shared device location",
    lat: 19.0598,
    lng: 72.8404,
    source: "device",
    accuracy_meters: 19,
    observed_at: "2026-07-19T10:00:00.000Z",
  });
  assert.ok(state.drift_inputs.safe_zone_adherence > 0);
  assert.equal(state.latest_agent_trace, null);
});

test("successive device positions replace the previous point and continuously recalculate safe-zone risk", () => {
  resetSharedState();
  updateDeviceLocation({ lat: 19.0598, lng: 72.8404, observed_at: "2026-07-19T10:00:00.000Z" });
  assert.ok(getSharedState().drift_inputs.safe_zone_adherence > 0);

  updateDeviceLocation({ lat: 19.076, lng: 72.8777, observed_at: "2026-07-19T10:00:30.000Z" });
  const state = getSharedState();
  assert.equal(state.current_location.source, "device");
  assert.equal(state.current_location.observed_at, "2026-07-19T10:00:30.000Z");
  assert.equal(state.drift_inputs.safe_zone_adherence, 0);
});

test("a simulated agent trace does not replace an available device location", () => {
  resetSharedState();
  updateDeviceLocation({ lat: 19.08, lng: 72.88 });
  saveAgentTrace({
    source: "passive_monitoring",
    persona: { id: "meera-shah", name: "Meera Shah" },
    decision: { decision: "continue_monitoring" },
    recentBehaviorHistory: [{
      id: "loc-1",
      event_type: "location_check_in",
      location: "Central Railway Station",
      lat: 19.0598,
      lng: 72.8404,
    }],
  });

  const state = getSharedState();
  assert.equal(state.current_location.source, "device");
  assert.equal(state.current_location.lat, 19.08);
  assert.equal(state.current_location.lng, 72.88);
});

test("unavailable device location restores the latest simulated check-in and recalculates risk", () => {
  resetSharedState();
  updateSharedState({ current_location: { label: "Park", lat: 19.07, lng: 72.87 } });
  updateDeviceLocation({ lat: 19.0598, lng: 72.8404 });
  assert.equal(getSharedState().current_location.source, "device");

  useSimulatedLocationFallback();
  const state = getSharedState();
  assert.deepEqual(state.current_location, { label: "Park", lat: 19.07, lng: 72.87, source: "simulated" });
  assert.equal(state.drift_inputs.safe_zone_adherence, 0);
});

test("device location coordinates are validated before they affect shared state", () => {
  resetSharedState();
  assert.throws(() => updateDeviceLocation({ lat: 91, lng: 72.8 }), /Latitude must be a valid coordinate/);
  assert.equal(getSharedState().current_location.source, "simulated");
});
