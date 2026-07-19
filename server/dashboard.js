const EARTH_RADIUS_METERS = 6371000;

export function distanceInMeters(from, to) {
  if (![from?.lat, from?.lng, to?.lat, to?.lng].every(Number.isFinite)) return null;
  const radians = (value) => (value * Math.PI) / 180;
  const deltaLat = radians(to.lat - from.lat);
  const deltaLng = radians(to.lng - from.lng);
  const a = Math.sin(deltaLat / 2) ** 2 + Math.cos(radians(from.lat)) * Math.cos(radians(to.lat)) * Math.sin(deltaLng / 2) ** 2;
  return Math.round(EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

export function safeZoneRisk(location, safeZone) {
  const distance = distanceInMeters(location, safeZone?.center);
  if (distance === null || !safeZone?.radius_meters) return 0;
  if (distance <= safeZone.radius_meters) return 0;
  return Math.min(100, Math.round(((distance - safeZone.radius_meters) / safeZone.radius_meters) * 100));
}

export function driftInputsFromDeviations(deviations, location, safeZone) {
  const routineDeviation = deviations.reduce((score, deviation) => {
    if (deviation.deviation_type === "location_differs_from_baseline") return Math.max(score, 80);
    if (deviation.deviation_type === "expected_event_not_observed") return Math.max(score, 65);
    if (deviation.deviation_type === "stationary_duration_above_baseline") return Math.max(score, 55);
    return score;
  }, 0);
  const communicationGap = deviations.some((deviation) => deviation.deviation_type === "communication_count_below_baseline") ? 70 : 0;
  const medicationAdherence = deviations.some((deviation) =>
    deviation.deviation_type === "expected_event_not_observed" && deviation.expected?.event_type === "medication_reminder_ack",
  ) ? 65 : 0;
  return { routine_deviation: routineDeviation, communication_gap: communicationGap, safe_zone_adherence: safeZoneRisk(location, safeZone), medication_adherence: medicationAdherence };
}
