import { baselinePayload, generateBaselineDay } from "./behavior.js";

const DAYTIME_STATIONARY = (event) =>
  event.event_type === "stationary" && event.context.activity !== "overnight rest";

const FAMILY_CHECK_IN = (event) =>
  event.event_type === "communication" && ["Daughter", "Son"].includes(event.context.contact);

function round(value) {
  return Math.round(value * 10) / 10;
}

function byId(events) {
  return new Map(events.map((event) => [event.id, event]));
}

function inTimestampRange(timestamp, start, end) {
  return timestamp >= start && timestamp <= end;
}

/**
 * Calculates factual baseline reference values. These values describe the persona's
 * usual observed pattern; they do not classify or rank any deviation.
 */
export function calculateBaselineStats(date) {
  const events = generateBaselineDay(date);
  const daytimeStationary = events.filter(DAYTIME_STATIONARY);
  const durations = daytimeStationary.map((event) => event.context.duration_minutes);
  const familyCheckIns = events.filter(FAMILY_CHECK_IN).filter((event) => event.time_of_day !== "morning");

  return {
    expected_time_windows: events
      .filter((event) => event.event_type === "medication_reminder_ack")
      .map((event) => ({
        event_id: event.id,
        event_type: event.event_type,
        expected_timestamp: event.timestamp,
        medication_window: event.context.medication_window,
      })),
    daytime_stationary_duration_minutes: {
      average: round(durations.reduce((total, duration) => total + duration, 0) / durations.length),
      maximum: Math.max(...durations),
    },
    expected_check_in_locations: events
      .filter((event) => event.event_type === "location_check_in")
      .map((event) => ({ event_id: event.id, timestamp: event.timestamp, location: event.location })),
    expected_family_communication: {
      start_timestamp: familyCheckIns[0].timestamp,
      end_timestamp: familyCheckIns.at(-1).timestamp,
      contacts: familyCheckIns.map((event) => event.context.contact),
      event_count: familyCheckIns.length,
    },
  };
}

/**
 * Compares a stream against the baseline and returns raw expected-versus-actual
 * differences. It intentionally contains no severity, interpretation, or action.
 */
export function surfaceDeviations(events, date) {
  const baselineEvents = generateBaselineDay(date);
  const actualById = byId(events);
  const stats = calculateBaselineStats(date);
  const deviations = [];

  for (const expectedEvent of baselineEvents.filter((event) => event.event_type === "medication_reminder_ack")) {
    if (!actualById.has(expectedEvent.id)) {
      deviations.push({
        id: `deviation-${expectedEvent.id}-not-observed`,
        deviation_type: "expected_event_not_observed",
        event_type: expectedEvent.event_type,
        expected: {
          event_id: expectedEvent.id,
          timestamp: expectedEvent.timestamp,
          time_of_day: expectedEvent.time_of_day,
          location: expectedEvent.location,
          medication_window: expectedEvent.context.medication_window,
        },
        actual: { observed: false },
        difference: { event_count: -1 },
      });
    }
  }

  for (const event of events.filter(DAYTIME_STATIONARY)) {
    const actualDuration = event.context.duration_minutes;
    if (actualDuration > stats.daytime_stationary_duration_minutes.maximum) {
      deviations.push({
        id: `deviation-${event.id}-duration`,
        deviation_type: "stationary_duration_above_baseline",
        event_type: event.event_type,
        expected: {
          baseline_average_minutes: stats.daytime_stationary_duration_minutes.average,
          baseline_maximum_minutes: stats.daytime_stationary_duration_minutes.maximum,
        },
        actual: {
          event_id: event.id,
          timestamp: event.timestamp,
          time_of_day: event.time_of_day,
          location: event.location,
          duration_minutes: actualDuration,
        },
        difference: {
          duration_above_baseline_maximum_minutes:
            actualDuration - stats.daytime_stationary_duration_minutes.maximum,
        },
      });
    }
  }

  for (const expectedEvent of baselineEvents.filter((event) => event.event_type === "location_check_in")) {
    const actualEvent = actualById.get(expectedEvent.id);
    if (actualEvent && actualEvent.location !== expectedEvent.location) {
      deviations.push({
        id: `deviation-${actualEvent.id}-location`,
        deviation_type: "location_differs_from_baseline",
        event_type: actualEvent.event_type,
        expected: {
          event_id: expectedEvent.id,
          timestamp: expectedEvent.timestamp,
          location: expectedEvent.location,
        },
        expected_context: {
          routine: expectedEvent.context.routine,
          expected_location: expectedEvent.location,
        },
        actual: {
          event_id: actualEvent.id,
          timestamp: actualEvent.timestamp,
          time_of_day: actualEvent.time_of_day,
          location: actualEvent.location,
        },
        difference: {
          expected_location: expectedEvent.location,
          actual_location: actualEvent.location,
        },
      });
    }
  }

  const familyCheckIns = events.filter(FAMILY_CHECK_IN).filter((event) =>
    inTimestampRange(
      event.timestamp,
      stats.expected_family_communication.start_timestamp,
      stats.expected_family_communication.end_timestamp,
    ),
  );

  if (familyCheckIns.length < stats.expected_family_communication.event_count) {
    deviations.push({
      id: "deviation-family-communication-count",
      deviation_type: "communication_count_below_baseline",
      event_type: "communication",
      expected: {
        time_window: {
          start_timestamp: stats.expected_family_communication.start_timestamp,
          end_timestamp: stats.expected_family_communication.end_timestamp,
        },
        contacts: stats.expected_family_communication.contacts,
        event_count: stats.expected_family_communication.event_count,
      },
      actual: {
        event_count: familyCheckIns.length,
        observed_contacts: familyCheckIns.map((event) => event.context.contact),
      },
      difference: { event_count: familyCheckIns.length - stats.expected_family_communication.event_count },
    });
  }

  return deviations;
}

export function deviationPayload(sourcePayload) {
  return {
    persona: sourcePayload.persona,
    date: sourcePayload.date,
    scenario: sourcePayload.scenario,
    recent_behavior_history: sourcePayload.events,
    baseline_reference: calculateBaselineStats(sourcePayload.date),
    surfaced_deviations: surfaceDeviations(sourcePayload.events, sourcePayload.date),
  };
}

export function baselineDeviationPayload(date) {
  return deviationPayload(baselinePayload(date));
}
