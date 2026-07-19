const DEFAULT_DATE = "2026-07-17";

export const EVENT_TYPES = Object.freeze([
  "location_check_in",
  "movement",
  "stationary",
  "communication",
  "medication_reminder_ack",
]);

export const SCENARIOS = Object.freeze({
  missed_routine: {
    label: "Missed medication routine",
    description: "The morning medication acknowledgement does not occur.",
  },
  prolonged_stillness: {
    label: "Prolonged stillness",
    description: "A normal rest period becomes an unusually long stationary period.",
  },
  off_route_station: {
    label: "Off-route station check-in",
    description: "A familiar afternoon location check-in is replaced by a railway station.",
  },
  communication_silence: {
    label: "Unusual communication silence",
    description: "Expected afternoon and evening check-ins do not occur.",
  },
});

const PERSONA = Object.freeze({
  id: "meera-shah",
  name: "Meera Shah",
  age: 74,
  home_location: "Greenfield Apartments",
  mobility_level: "independent",
  cognitive_risk: "mild",
  usual_transport: "walking",
  emergency_contact: {
    name: "Ananya Shah",
    relationship: "Daughter",
    preferred_channel: "phone",
  },
  language: "English",
  routine_summary: "Independent retiree with a regular morning walk, afternoon park visit, and family check-ins.",
});

const LOCATION_COORDINATES = Object.freeze({
  "Greenfield Apartments": { lat: 19.076, lng: 72.8777 },
  "Maple Street Walking Path": { lat: 19.0792, lng: 72.8801 },
  "Oakwood Market": { lat: 19.0738, lng: 72.8708 },
  "Cedar Grove Park": { lat: 19.0811, lng: 72.8696 },
  "Central Railway Station": { lat: 19.0598, lng: 72.8404 },
});

function at(date, time) {
  return `${date}T${time}:00+05:30`;
}

function timeOfDay(time) {
  const hour = Number(time.slice(0, 2));

  if (hour < 6 || hour >= 21) return "night";
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

function event(date, id, time, eventType, location, context = {}) {
  const coordinates = eventType === "location_check_in" ? LOCATION_COORDINATES[location] : null;
  return {
    id,
    timestamp: at(date, time),
    time_of_day: timeOfDay(time),
    event_type: eventType,
    location,
    ...(coordinates ? coordinates : {}),
    context: {
      // Later reasoning phases should not need to infer the routine expectation from
      // a location change alone. Scenario injectors can override this baseline value.
      expected_location: location,
      ...context,
    },
  };
}

/**
 * Returns a deterministic, inspectable normal-day event stream for the demo persona.
 * The date is configurable to make later multi-day simulations possible without
 * changing the event schema.
 */
export function generateBaselineDay(date = DEFAULT_DATE) {
  return [
    event(date, "evt-001", "06:45", "stationary", "Greenfield Apartments", { activity: "overnight rest", duration_minutes: 435 }),
    event(date, "evt-002", "07:05", "movement", "Greenfield Apartments", { activity: "morning routine", destination: "Maple Street" }),
    event(date, "evt-003", "07:30", "location_check_in", "Maple Street Walking Path", { routine: "morning walk", expected: true }),
    event(date, "evt-004", "08:05", "movement", "Maple Street Walking Path", { activity: "returning home", destination: "Greenfield Apartments" }),
    event(date, "evt-005", "08:20", "medication_reminder_ack", "Greenfield Apartments", { medication_window: "08:00-08:30", reminder: "morning medication" }),
    event(date, "evt-006", "09:15", "communication", "Greenfield Apartments", { channel: "phone", direction: "outbound", contact: "Daughter", summary: "morning check-in" }),
    event(date, "evt-007", "10:10", "movement", "Greenfield Apartments", { activity: "errand", destination: "Oakwood Market" }),
    event(date, "evt-008", "10:25", "location_check_in", "Oakwood Market", { routine: "grocery errand", expected: true }),
    event(date, "evt-009", "10:55", "movement", "Oakwood Market", { activity: "returning home", destination: "Greenfield Apartments" }),
    event(date, "evt-010", "11:15", "stationary", "Greenfield Apartments", { activity: "lunch and rest", duration_minutes: 45 }),
    event(date, "evt-011", "12:20", "communication", "Greenfield Apartments", { channel: "messaging", direction: "outbound", contact: "Neighbour", summary: "afternoon plans" }),
    event(date, "evt-012", "14:30", "movement", "Greenfield Apartments", { activity: "afternoon outing", destination: "Cedar Grove Park" }),
    event(date, "evt-013", "14:50", "location_check_in", "Cedar Grove Park", { routine: "afternoon park visit", expected: true }),
    event(date, "evt-014", "15:30", "communication", "Cedar Grove Park", { channel: "phone", direction: "inbound", contact: "Daughter", summary: "afternoon check-in" }),
    event(date, "evt-015", "16:10", "movement", "Cedar Grove Park", { activity: "returning home", destination: "Greenfield Apartments" }),
    event(date, "evt-016", "16:35", "stationary", "Greenfield Apartments", { activity: "tea and reading", duration_minutes: 50 }),
    event(date, "evt-017", "18:30", "communication", "Greenfield Apartments", { channel: "video", direction: "outbound", contact: "Son", summary: "evening check-in" }),
    event(date, "evt-018", "19:00", "stationary", "Greenfield Apartments", { activity: "dinner", duration_minutes: 45 }),
    event(date, "evt-019", "20:30", "medication_reminder_ack", "Greenfield Apartments", { medication_window: "20:00-21:00", reminder: "evening medication" }),
    event(date, "evt-020", "22:00", "stationary", "Greenfield Apartments", { activity: "overnight rest", duration_minutes: 525 }),
  ];
}

function replaceEvent(events, eventId, replacement) {
  return events.map((item) => (item.id === eventId ? replacement(item) : item));
}

/** Applies exactly one hardcoded demo anomaly to a normal day. */
export function injectScenario(scenario, date = DEFAULT_DATE) {
  if (!SCENARIOS[scenario]) {
    throw new Error(`Unknown scenario: ${scenario}`);
  }

  const baselineEvents = generateBaselineDay(date);
  let events = baselineEvents;
  let injectedAnomaly;

  switch (scenario) {
    case "missed_routine":
      events = baselineEvents.filter((item) => item.id !== "evt-005");
      injectedAnomaly = {
        type: "missing_event",
        expected_event_type: "medication_reminder_ack",
        expected_window: `${date}T08:00:00+05:30/${date}T08:30:00+05:30`,
        description: "The expected morning medication acknowledgement was removed.",
      };
      break;
    case "prolonged_stillness":
      events = replaceEvent(baselineEvents, "evt-016", (item) => ({
        ...item,
        context: { ...item.context, activity: "uninterrupted stationary period", duration_minutes: 155 },
      }));
      injectedAnomaly = {
        type: "extended_duration",
        event_id: "evt-016",
        expected_duration_minutes: 50,
        actual_duration_minutes: 155,
        description: "A usual tea-and-reading period lasts substantially longer than normal.",
      };
      break;
    case "off_route_station":
      events = replaceEvent(baselineEvents, "evt-013", (item) => ({
        ...item,
        location: "Central Railway Station",
        ...LOCATION_COORDINATES["Central Railway Station"],
        context: {
          ...item.context,
          expected_location: "Cedar Grove Park",
          routine: "unplanned location check-in",
          expected: false,
        },
      }));
      injectedAnomaly = {
        type: "unexpected_location",
        event_id: "evt-013",
        expected_location: "Cedar Grove Park",
        actual_location: "Central Railway Station",
        description: "The expected afternoon park check-in is replaced by a railway-station check-in.",
      };
      break;
    case "communication_silence":
      events = baselineEvents.filter((item) => !["evt-014", "evt-017"].includes(item.id));
      injectedAnomaly = {
        type: "missing_communication_window",
        expected_contacts: ["Daughter", "Son"],
        expected_window: `${date}T15:00:00+05:30/${date}T19:00:00+05:30`,
        description: "Expected afternoon and evening family check-ins were removed.",
      };
      break;
    default:
      throw new Error(`No injector implemented for scenario: ${scenario}`);
  }

  return {
    persona: PERSONA,
    date,
    scenario: { id: scenario, ...SCENARIOS[scenario] },
    injected_anomaly: injectedAnomaly,
    events,
  };
}

export function baselinePayload(date = DEFAULT_DATE) {
  return {
    persona: PERSONA,
    date,
    scenario: null,
    injected_anomaly: null,
    events: generateBaselineDay(date),
  };
}
