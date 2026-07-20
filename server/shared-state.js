import { driftInputsFromDeviations, safeZoneRisk } from "./dashboard.js";

const DEFAULT_STATE = Object.freeze({
  latest_agent_trace: null,
  drift_inputs: {
    routine_deviation: 0,
    communication_gap: 0,
    safe_zone_adherence: 0,
    medication_adherence: 0,
  },
  safe_zone: { center: { lat: 19.076, lng: 72.8777 }, radius_meters: 3000, label: "Meera's home" },
  current_location: { label: "Greenfield Apartments", lat: 19.076, lng: 72.8777, source: "simulated" },
  // Kept privately so a denied/unavailable device location can always fall back safely.
  simulated_location: { label: "Greenfield Apartments", lat: 19.076, lng: 72.8777, source: "simulated" },
  medication_schedule: [
    { id: "med-1", name: "Vitamin D3", time: "09:00", dosage: "1000 IU" },
    { id: "med-2", name: "Amlodipine", time: "20:00", dosage: "5 mg" }
  ],
  companion_session: { intents: {} },
  daily_journal: {
    date: new Date().toISOString().slice(0, 10),
    summary: "Meera spent a quiet morning at home and had breakfast on time. She went for a short walk in the afternoon and seemed to be in a good mood.",
    sentences: [],
    source_event_ids: [],
    generated_at: new Date().toISOString(),
    model: "seed",
    fallback: false,
    stale: false,
  },
  daily_activity_log: [
    {
      id: "journal-seed-1",
      date: new Date().toISOString().slice(0, 10),
      type: "companion_interaction",
      occurred_at: new Date(Date.now() - 3600000).toISOString(),
      details: { summary: "Meera mentioned she enjoyed her morning tea." }
    }
  ],
  distress_alert: false,
});

const INTENT_TTL_MS = 20 * 60 * 1000;

let sharedState = structuredClone(DEFAULT_STATE);

export function getSharedState() {
  const publicState = structuredClone(sharedState);
  delete publicState.daily_activity_log;
  delete publicState.simulated_location;
  return publicState;
}

function requireCoordinate(value, name, { min, max }) {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be a valid coordinate.`);
  }
  return value;
}

function validTimestamp(value) {
  return typeof value === "string" && !Number.isNaN(new Date(value).getTime());
}

function normalizeLocation(location, source = "simulated") {
  const lat = requireCoordinate(location?.lat, "Latitude", { min: -90, max: 90 });
  const lng = requireCoordinate(location?.lng, "Longitude", { min: -180, max: 180 });
  const normalizedSource = source === "device" ? "device" : "simulated";
  const label = typeof location?.label === "string" && location.label.trim()
    ? location.label.trim().slice(0, 120)
    : normalizedSource === "device" ? "Meera's shared device location" : "Simulated check-in location";
  const accuracy = Number(location?.accuracy_meters);
  return {
    label,
    lat,
    lng,
    source: normalizedSource,
    ...(normalizedSource === "device" && Number.isFinite(accuracy) && accuracy >= 0 ? { accuracy_meters: Math.round(accuracy) } : {}),
    ...(validTimestamp(location?.observed_at) ? { observed_at: new Date(location.observed_at).toISOString() } : {}),
  };
}

function refreshSafeZoneRisk() {
  sharedState.drift_inputs.safe_zone_adherence = safeZoneRisk(sharedState.current_location, sharedState.safe_zone);
}

export function updateSharedState(update) {
  const allowedKeys = ["latest_agent_trace", "drift_inputs", "safe_zone", "medication_schedule", "companion_session", "daily_journal", "distress_alert"];
  for (const key of allowedKeys) {
    if (Object.hasOwn(update, key)) sharedState[key] = structuredClone(update[key]);
  }
  if (Object.hasOwn(update, "current_location")) {
    const source = update.current_location?.source === "device" ? "device" : "simulated";
    const location = normalizeLocation(update.current_location, source);
    sharedState.current_location = location;
    if (source === "simulated") sharedState.simulated_location = structuredClone(location);
  }
  if (Object.hasOwn(update, "safe_zone") || Object.hasOwn(update, "current_location")) {
    refreshSafeZoneRisk();
  }
  return getSharedState();
}

/** Stores a browser-provided location without exposing it to the decision agent. */
export function updateDeviceLocation(location) {
  sharedState.current_location = normalizeLocation({
    ...location,
    label: "Meera's shared device location",
    observed_at: location?.observed_at ?? new Date().toISOString(),
  }, "device");
  refreshSafeZoneRisk();
  return getSharedState();
}

/** Restores the most recent synthetic check-in when browser location is unavailable. */
export function useSimulatedLocationFallback() {
  sharedState.current_location = structuredClone(sharedState.simulated_location);
  refreshSafeZoneRisk();
  return getSharedState();
}

function normalizeJournalDate(date) {
  const normalized = date ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) throw new Error("Journal date must use YYYY-MM-DD format.");
  return normalized;
}

/** Stores a compact factual event for the daily caregiver journal. */
export function recordDailyActivity({ date, type, details = {}, occurredAt = new Date().toISOString() }) {
  const journalDate = normalizeJournalDate(date);
  if (!["agent_decision", "companion_interaction", "caregiver_escalation"].includes(type)) {
    throw new Error("Unsupported daily activity type.");
  }
  const entry = {
    id: `journal-${Date.now()}-${sharedState.daily_activity_log.length + 1}`,
    date: journalDate,
    type,
    occurred_at: occurredAt,
    details: structuredClone(details),
  };
  sharedState.daily_activity_log = [...sharedState.daily_activity_log, entry].slice(-120);
  if (sharedState.daily_journal?.date === journalDate) {
    sharedState.daily_journal = { ...sharedState.daily_journal, stale: true };
  }
  return structuredClone(entry);
}

export function getDailyActivity(date) {
  const journalDate = normalizeJournalDate(date);
  return structuredClone(sharedState.daily_activity_log.filter((entry) => entry.date === journalDate));
}

export function getLatestDailyActivityDate() {
  return sharedState.daily_activity_log.at(-1)?.date ?? null;
}

export function saveDailyJournal(journal) {
  const date = normalizeJournalDate(journal?.date);
  if (!Array.isArray(journal.sentences) || journal.sentences.length < 3 || journal.sentences.length > 5) {
    throw new Error("Daily journal must contain 3 to 5 sentences.");
  }
  sharedState.daily_journal = {
    date,
    summary: journal.sentences.map((sentence) => sentence.text.trim()).join(" "),
    sentences: structuredClone(journal.sentences),
    source_event_ids: journal.sentences.flatMap((sentence) => sentence.event_ids),
    generated_at: journal.generated_at ?? new Date().toISOString(),
    model: journal.model ?? null,
    fallback: Boolean(journal.fallback),
    stale: false,
  };
  return structuredClone(sharedState.daily_journal);
}

function clearExpiredCompanionIntents(now = Date.now()) {
  const intents = sharedState.companion_session?.intents ?? {};
  const active = Object.fromEntries(Object.entries(intents).filter(([, intent]) => new Date(intent.expires_at).getTime() > now));
  sharedState.companion_session = { intents: active };
  return active;
}

/** Stores a short-lived intent from the active patient companion session. */
export function saveCompanionIntent({ type, value, timestamp = new Date().toISOString() }) {
  if (!['destination', 'medication'].includes(type)) throw new Error("Intent type must be 'destination' or 'medication'.");
  if (!value?.trim()) throw new Error("Intent value is required.");
  const statedAt = new Date(timestamp);
  if (Number.isNaN(statedAt.getTime())) throw new Error("Intent timestamp is invalid.");
  const intents = clearExpiredCompanionIntents();
  const intent = {
    type,
    value: value.trim(),
    stated_at: statedAt.toISOString(),
    expires_at: new Date(statedAt.getTime() + INTENT_TTL_MS).toISOString(),
  };
  sharedState.companion_session = { intents: { ...intents, [type]: intent } };
  return structuredClone(intent);
}

export function getActiveCompanionIntents(now = Date.now()) {
  return structuredClone(clearExpiredCompanionIntents(now));
}

function requireScheduleTime(time) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time ?? "")) throw new Error("Reminder time must use HH:MM format.");
}

export function createReminder({ name, time }) {
  if (!name?.trim()) throw new Error("Reminder name is required.");
  requireScheduleTime(time);
  const reminder = { id: `med-${Date.now()}`, name: name.trim(), time };
  sharedState.medication_schedule.push(reminder);
  return structuredClone(reminder);
}

export function updateReminder({ id, name = null, time = null }) {
  const index = sharedState.medication_schedule.findIndex((reminder) => reminder.id === id);
  if (index < 0) throw new Error("That reminder is not in the current schedule.");
  if (name !== null && !name.trim()) throw new Error("Reminder name cannot be empty.");
  if (time !== null) requireScheduleTime(time);
  sharedState.medication_schedule[index] = {
    ...sharedState.medication_schedule[index],
    ...(name !== null ? { name: name.trim() } : {}),
    ...(time !== null ? { time } : {}),
  };
  return structuredClone(sharedState.medication_schedule[index]);
}

export function acknowledgeReminder(id) {
  const reminder = sharedState.medication_schedule.find((entry) => entry.id === id);
  if (!reminder) throw new Error("That reminder is not in the current schedule.");
  reminder.acknowledged_at = new Date().toISOString();
  return structuredClone(reminder);
}

export function saveAgentTrace({ source, persona, decision, surfacedDeviations = [], recentBehaviorHistory = [], timestamp = new Date().toISOString() }) {
  const changedCheckIn = recentBehaviorHistory.find((event) =>
    event.event_type === "location_check_in" && surfacedDeviations.some((deviation) => deviation.actual?.event_id === event.id),
  );
  const latestCheckIn = [...recentBehaviorHistory].reverse().find((event) => event.event_type === "location_check_in" && typeof event.lat === "number");
  const currentLocation = changedCheckIn ?? latestCheckIn;
  if (currentLocation) {
    const simulatedLocation = normalizeLocation({
      label: currentLocation.location,
      lat: currentLocation.lat,
      lng: currentLocation.lng,
    });
    sharedState.simulated_location = simulatedLocation;
    if (sharedState.current_location?.source !== "device") {
      sharedState.current_location = structuredClone(simulatedLocation);
    }
  }
  sharedState.drift_inputs = driftInputsFromDeviations(surfacedDeviations, sharedState.current_location, sharedState.safe_zone);
  sharedState.latest_agent_trace = {
    source,
    persona: { id: persona.id, name: persona.name },
    decision,
    surfaced_deviation_ids: surfacedDeviations.map((deviation) => deviation.id),
    updated_at: timestamp,
  };
  if (["patient_conversation", "patient_companion"].includes(source) && decision.decision === "notify_caregiver") {
    sharedState.distress_alert = {
      active: true,
      message: decision.caregiver_summary,
      immediate_action: decision.immediate_action,
      raised_at: timestamp,
    };
  }
  return getSharedState();
}

export function resetSharedState() {
  sharedState = structuredClone(DEFAULT_STATE);
  return getSharedState();
}
