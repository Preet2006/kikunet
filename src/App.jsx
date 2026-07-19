import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Circle, CircleMarker, MapContainer, TileLayer, useMap, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";

const API_URL = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:3001";
const DEMO_SCENARIOS = [
  ["missed_routine", "Missed routine"],
  ["prolonged_stillness", "Prolonged stillness"],
  ["off_route_station", "Off-route station"],
  ["communication_silence", "Communication silence"],
];
const EVENT_LABELS = { location_check_in: "Location check-in", movement: "Movement", stationary: "Stationary", communication: "Communication", medication_reminder_ack: "Medication acknowledged" };
const DECISION_LABELS = { continue_monitoring: "Keeping a watchful eye", conversational_prompt: "A gentle check-in", navigation_assist: "Helping Meera find her way", notify_caregiver: "Caregiver support needed" };

function formatTime(timestamp) {
  return new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit" }).format(new Date(timestamp));
}
function formatLocationTime(timestamp) {
  return new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", second: "2-digit" }).format(new Date(timestamp));
}
function eventSummary(event) {
  if (event.context.activity) return event.context.activity;
  if (event.context.routine) return event.context.routine;
  if (event.context.reminder) return event.context.reminder;
  return EVENT_LABELS[event.event_type];
}
function AgentTrace({ decision }) {
  if (!decision) return <p className="muted">No agent decision has been shared yet.</p>;
  return <div className="agent-trace">
    <div className="trace-title"><span className={`confidence confidence--${decision.confidence}`}>{decision.confidence} confidence</span><h3>{DECISION_LABELS[decision.decision] ?? decision.decision}</h3></div>
    <p className="summary">{decision.caregiver_summary}</p>
    <ol>{decision.reasoning?.map((item, index) => <li key={`${index}-${item.statement}`}><p>{item.statement}</p><span>Evidence: {item.cited_facts?.join(" · ")}</span></li>)}</ol>
    <div className="action-grid"><div><b>Immediate action</b><p>{decision.immediate_action}</p></div><div><b>Follow-up</b><p>{decision.follow_up_action}</p></div></div>
  </div>;
}
function AppHeader({ role }) {
  return <header className="app-header"><div><p className="eyebrow">Kikunet · Safety companion</p><h1>{role === "caretaker" ? "Caretaker dashboard" : "Meera’s companion"}</h1>{role === "caretaker" && <p>A shared view of Meera’s behavioral timeline and the reasoning agent’s latest support plan.</p>}</div></header>;
}
function RoleNavigation({ role }) {
  return <nav className="role-navigation" aria-label="Screen switcher"><a className={role === "caretaker" ? "active" : ""} href="/caretaker">Caretaker view</a><a className={role === "patient" ? "active" : ""} href="/patient">Patient view</a></nav>;
}
function driftScore(inputs = {}) {
  const score = Math.round((inputs.routine_deviation ?? 0) * .4 + (inputs.communication_gap ?? 0) * .25 + (inputs.safe_zone_adherence ?? 0) * .2 + (inputs.medication_adherence ?? 0) * .15);
  if (score <= 30) return { score, label: "Stable", tone: "stable" };
  if (score <= 55) return { score, label: "Watch", tone: "watch" };
  if (score <= 75) return { score, label: "Elevated", tone: "elevated" };
  return { score, label: "Urgent", tone: "urgent" };
}
function DriftScore({ inputs }) {
  const seededInputs = { routine_deviation: 60, communication_gap: 40, safe_zone_adherence: 20, medication_adherence: 35 };
  const usingSeed = Object.values(inputs ?? {}).every((value) => Number(value) === 0);
  const activeInputs = usingSeed ? seededInputs : inputs;
  const { score, label, tone } = driftScore(activeInputs);
  const [selected, setSelected] = useState(null);
  const factors = [
    { key: "routine_deviation", name: "Routine deviation", weight: 0.4, reason: "Meera's afternoon has been less predictable than her usual routine, so this is the largest contributor today." },
    { key: "communication_gap", name: "Communication gap", weight: 0.25, reason: "Fewer family check-ins have been recorded than expected, leaving a longer gap in contact." },
    { key: "safe_zone_adherence", name: "Safe-zone distance", weight: 0.2, reason: "Meera is a short distance beyond her preferred safe area, which adds a small amount of concern." },
    { key: "medication_adherence", name: "Medication adherence", weight: 0.15, reason: "A recent medication reminder has not yet been acknowledged, so it remains part of today's picture." },
  ].map((factor) => ({ ...factor, value: activeInputs?.[factor.key] ?? 0, contribution: Math.round((activeInputs?.[factor.key] ?? 0) * factor.weight) }));
  return <section className="drift-card"><div><p className="section-label">Daily wellbeing overview</p><h2>Daily drift score</h2></div><div className={`score-orb score-orb--${tone}`}><strong>{score}</strong><span>{label}</span></div><details open><summary>View contributing factors</summary><div className="factor-list">{factors.map((factor) => <div className={selected === factor.key ? "factor-item factor-item--selected" : "factor-item"} key={factor.key}><button type="button" onClick={() => setSelected(selected === factor.key ? null : factor.key)}><span>{factor.name}</span><b>{factor.value}/100</b><small>Contributes {factor.contribution} points to the {score}-point drift score</small><i><em style={{ width: `${factor.value}%` }} /></i></button>{selected === factor.key && <p><strong>Why this contributes:</strong> {factor.reason}</p>}</div>)}</div></details></section>;
}
function SafeZoneViewport({ safeZone, location }) {
  const map = useMap();
  useEffect(() => {
    const home = [safeZone.center.lat, safeZone.center.lng];
    const current = [location.lat, location.lng];
    if (home[0] === current[0] && home[1] === current[1]) map.setView(home, 14);
    else map.fitBounds([home, current], { padding: [34, 34], maxZoom: 14 });
  }, [map, safeZone.center.lat, safeZone.center.lng, location.lat, location.lng]);
  return null;
}
function SafeZoneCenterPicker({ onSelect }) {
  useMapEvents({
    click(event) {
      onSelect({ lat: event.latlng.lat, lng: event.latlng.lng });
    },
  });
  return null;
}
function SafeZoneMap({ shared, refreshShared, locationSharing }) {
  const safeZone = shared.safe_zone;
  const location = shared.current_location;
  const outside = (shared.drift_inputs?.safe_zone_adherence ?? 0) > 0;
  const isLiveDeviceLocation = location?.source === "device" && locationSharing === "sharing";
  const waitingForFreshDeviceLocation = location?.source === "device" && !isLiveDeviceLocation;
  const displayedOutside = isLiveDeviceLocation ? outside : false;
  const [radius, setRadius] = useState(safeZone?.radius_meters ?? 3000);
  const [centerLat, setCenterLat] = useState(safeZone?.center?.lat ?? "");
  const [centerLng, setCenterLng] = useState(safeZone?.center?.lng ?? "");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setRadius(safeZone?.radius_meters ?? 3000);
    setCenterLat(safeZone?.center?.lat ?? "");
    setCenterLng(safeZone?.center?.lng ?? "");
  }, [safeZone?.radius_meters, safeZone?.center?.lat, safeZone?.center?.lng]);
  const selectSafeZoneCenter = ({ lat, lng }) => {
    setCenterLat(lat.toFixed(6));
    setCenterLng(lng.toFixed(6));
  };
  const saveRadius = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await fetch(`${API_URL}/api/shared-state`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          safe_zone: {
            ...safeZone,
            center: { lat: Number(centerLat), lng: Number(centerLng) },
            radius_meters: Number(radius),
          },
        }),
      });
      if (!response.ok) throw new Error("Unable to update the safe zone.");
      await refreshShared();
    } finally {
      setSaving(false);
    }
  };
  if (!safeZone || !location) return null;
  const selectedLat = Number(centerLat);
  const selectedLng = Number(centerLng);
  const hasSelectedCenter = Number.isFinite(selectedLat) && Number.isFinite(selectedLng);
  const selectedCenter = hasSelectedCenter ? { lat: selectedLat, lng: selectedLng } : safeZone.center;
  const selectedRadius = Number(radius);
  const hasUnsavedCenter = hasSelectedCenter && (selectedCenter.lat !== safeZone.center.lat || selectedCenter.lng !== safeZone.center.lng);
  const locationDescription = waitingForFreshDeviceLocation
    ? "Checking this device’s current location before updating the safe-zone status."
    : displayedOutside
    ? `${location.label} is outside the configured safe zone.`
    : `${location.label} is inside the configured safe zone.`;
  const accuracyDescription = isLiveDeviceLocation && Number.isFinite(location.accuracy_meters)
    ? `Updated ${formatLocationTime(location.observed_at)} · device accuracy is approximately ${location.accuracy_meters} metres.`
    : "Showing the latest recorded check-in location.";
  const fallbackLocationNote = {
    connecting: "Checking whether this device can share its current location.",
    "requesting-permission": "Looking for this device’s current location.",
    "permission-denied": "Location permission was denied in this browser. Allow it, then refresh this page.",
    unavailable: "This browser could not get a current location. The latest recorded check-in is shown instead.",
    unsupported: "This browser does not support location sharing. The latest recorded check-in is shown instead.",
    "insecure-context": "Live location needs HTTPS or localhost. The latest recorded check-in is shown instead.",
    "connection-error": "The browser location could not reach the dashboard. The latest recorded check-in is shown instead.",
  };
  return <section className="map-card"><div className="map-heading"><div><p className="section-label">{isLiveDeviceLocation ? "Live device location" : waitingForFreshDeviceLocation ? "Updating device location" : "Recorded check-in location"}</p><h2>Safe zone</h2><p>{locationDescription}</p><small className="location-source-note">{isLiveDeviceLocation ? accuracyDescription : (fallbackLocationNote[locationSharing] ?? "Showing the latest simulated check-in until a device location is available.")}</small></div><span className={displayedOutside ? "zone-state zone-state--outside" : waitingForFreshDeviceLocation ? "zone-state zone-state--updating" : "zone-state"}>{displayedOutside ? "Outside zone" : waitingForFreshDeviceLocation ? "Updating" : "Inside zone"}</span></div><p className="map-selection-note">Click anywhere on the map to choose a new safe-zone centre, then select <strong>Update safe zone</strong> to save it.</p><div className="map-wrap"><MapContainer center={[safeZone.center.lat, safeZone.center.lng]} zoom={13} scrollWheelZoom={false}><SafeZoneViewport safeZone={safeZone} location={waitingForFreshDeviceLocation ? safeZone.center : location} /><SafeZoneCenterPicker onSelect={selectSafeZoneCenter} /><TileLayer attribution="© OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" /><Circle center={[safeZone.center.lat, safeZone.center.lng]} radius={safeZone.radius_meters} pathOptions={{ color: displayedOutside ? "#bd4a45" : "#237c75", fillOpacity: .12 }} /><CircleMarker center={[safeZone.center.lat, safeZone.center.lng]} radius={7} pathOptions={{ color: "#176d67", fillColor: "#176d67", fillOpacity: 1 }} />{hasUnsavedCenter && <><Circle center={[selectedCenter.lat, selectedCenter.lng]} radius={Number.isFinite(selectedRadius) ? selectedRadius : safeZone.radius_meters} pathOptions={{ color: "#bf7d1d", dashArray: "5 7", fillOpacity: .06 }} /><CircleMarker center={[selectedCenter.lat, selectedCenter.lng]} radius={8} pathOptions={{ color: "#bf7d1d", fillColor: "#fff7e7", fillOpacity: 1, weight: 3 }} /></>}{!waitingForFreshDeviceLocation && <CircleMarker center={[location.lat, location.lng]} radius={9} pathOptions={{ color: displayedOutside ? "#bd4a45" : "#176d67", fillColor: displayedOutside ? "#bd4a45" : "#176d67", fillOpacity: 1 }} />}</MapContainer></div><form className="zone-form" onSubmit={saveRadius}><label>Safe-zone latitude <input type="number" min="-90" max="90" step="any" value={centerLat} onChange={(event) => setCenterLat(event.target.value)} required /> </label><label>Safe-zone longitude <input type="number" min="-180" max="180" step="any" value={centerLng} onChange={(event) => setCenterLng(event.target.value)} required /> </label><label>Safe-zone radius <input type="number" min="250" step="250" value={radius} onChange={(event) => setRadius(event.target.value)} required /> metres</label><button disabled={saving}>{saving ? "Saving…" : "Update safe zone"}</button></form></section>;
}
function MedicationSchedule({ schedule = [], refreshShared }) {
  const [name, setName] = useState(""); const [time, setTime] = useState(""); const [dosage, setDosage] = useState(""); const [editingId, setEditingId] = useState(null); const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  const saveSchedule = async (nextSchedule) => { setSaving(true); setError(""); try { const response = await fetch(`${API_URL}/api/shared-state`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ medication_schedule: nextSchedule }) }); if (!response.ok) throw new Error("Unable to save medication schedule."); await refreshShared(); } catch (err) { setError(err.message); } finally { setSaving(false); } };
  const submit = async (event) => { event.preventDefault(); if (!name.trim() || !time) return; const item = { id: editingId ?? `med-${Date.now()}`, name: name.trim(), time, dosage: dosage.trim() || undefined }; const next = editingId ? schedule.map((entry) => entry.id === editingId ? item : entry) : [...schedule, item]; await saveSchedule(next); setName(""); setTime(""); setDosage(""); setEditingId(null); };
  const edit = (entry) => { setEditingId(entry.id); setName(entry.name); setTime(entry.time); setDosage(entry.dosage ?? ""); };
  const remove = (id) => saveSchedule(schedule.filter((entry) => entry.id !== id));
  return <section className="medication-card"><div><p className="section-label">Shared medication schedule</p><h2>Medication reminders</h2><p>Scheduling only — this does not provide dosage or medical advice.</p></div><form className="medication-form" onSubmit={submit}><label>Medicine name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Paracetamol" maxLength="80" /></label><label>Dosage / quantity<input value={dosage} onChange={(event) => setDosage(event.target.value)} placeholder="e.g. 500 mg, 1 tablet" maxLength="40" /></label><label>Time<input type="time" value={time} onChange={(event) => setTime(event.target.value)} /></label><button disabled={saving || !name.trim() || !time}>{editingId ? "Save" : "Add"}</button>{editingId && <button className="text-button" type="button" onClick={() => { setEditingId(null); setName(""); setTime(""); setDosage(""); }}>Cancel</button>}</form>{error && <p className="error-message">{error}</p>}<div className="medication-list">{schedule.length === 0 ? <p className="muted">No reminders are scheduled yet.</p> : schedule.map((entry) => <article key={entry.id}><div><strong>{entry.name}</strong>{entry.dosage && <small className="med-dosage">{entry.dosage}</small>}<span>{entry.time}</span></div><div><button className="small-button" type="button" onClick={() => edit(entry)}>Edit</button><button className="small-button small-button--danger" type="button" onClick={() => remove(entry.id)} disabled={saving}>Remove</button></div></article>)}</div></section>;
}
function DemoControlPanel({ health, schedule, runScenario, resetDemo, runDistress, runEvaluation, addDemoReminder, evaluation }) {
  const [busy, setBusy] = useState("");
  const [actionError, setActionError] = useState("");
  const perform = async (name, action) => { setBusy(name); setActionError(""); try { await action(); } catch (error) { setActionError(error.message ?? "That demo action could not be completed."); } finally { setBusy(""); } };
  if (actionError) return <section className="demo-control-panel demo-control-panel--error" role="alert"><p className="section-label">Demo action unavailable</p><h2>That step did not complete</h2><p>{actionError}</p><button type="button" onClick={() => setActionError("")}>Try again</button></section>;
  return <section className="demo-control-panel"><div><p className="section-label">Demo control panel</p><h2>Drive the full safety loop</h2><p>Use the role switcher above to move between caretaker and patient views during a recording.</p></div><div className="scenario-buttons">{DEMO_SCENARIOS.map(([id, label]) => <button key={id} onClick={() => perform(id, () => runScenario(id))} disabled={Boolean(busy) || health.status !== "ready"}>{label}</button>)}</div><div className="demo-actions"><button type="button" onClick={() => perform("distress", runDistress)} disabled={Boolean(busy) || health.status !== "ready"}>Run distress input</button><button type="button" onClick={() => perform("reminder", addDemoReminder)} disabled={Boolean(busy)}>Set 10-second reminder</button><button type="button" onClick={() => perform("reset", resetDemo)} disabled={Boolean(busy)}>Reset demo</button><button type="button" onClick={() => perform("evaluation", runEvaluation)} disabled={Boolean(busy) || health.status !== "ready"}>Run evaluation</button></div>{busy && <p className="muted">Preparing demo step…</p>}{evaluation && <p className="evaluation-summary">Evaluation: <strong>{evaluation.passed}/{evaluation.total}</strong> scenarios matched.</p>}{schedule.some((entry) => entry.due_at) && <p className="demo-reminder-note">A demo reminder is scheduled for the patient screen.</p>}</section>;
}
function DailyJournal({ journal, health, refreshShared }) {
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [emptyMessage, setEmptyMessage] = useState("");
  const generate = async () => {
    setStatus("loading"); setError(""); setEmptyMessage("");
    try {
      const response = await fetch(`${API_URL}/api/journal/generate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Unable to prepare today’s summary.");
      if (data.status === "empty") setEmptyMessage("There are no recorded care updates to summarize yet today.");
      await refreshShared(); setStatus("ready");
    } catch (journalError) { setError(journalError.message ?? "Unable to prepare today’s summary."); setStatus("error"); }
  };
  return <section className="daily-journal-card"><div className="daily-journal-heading"><div><p className="section-label">Today’s summary</p><h2>A quick update for Ananya</h2></div><button type="button" onClick={generate} disabled={status === "loading" || health.status !== "ready"}>{status === "loading" ? "Preparing…" : journal?.stale ? "Refresh summary" : "Generate summary"}</button></div>{journal ? <><p className="daily-journal-summary">{journal.summary}</p><div className="daily-journal-meta"><span>{journal.stale ? "New care updates are ready to include." : `Updated ${formatTime(journal.generated_at)}`}</span>{journal.fallback && <span>Prepared from the recorded care updates.</span>}</div></> : <p className="muted">{emptyMessage || "Generate a short, grounded overview after today’s care updates."}</p>}{error && <p className="error-message">{error}</p>}</section>;
}
function Caretaker({ health, shared, refreshShared, locationSharing }) {
  const [analysis, setAnalysis] = useState(null); const [status, setStatus] = useState("idle"); const [error, setError] = useState("");
  const runScenario = async (scenarioId) => { setStatus("loading"); setError(""); try { const response = await fetch(`${API_URL}/api/agent/decide`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scenario_id: scenarioId }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); setAnalysis(data); await refreshShared(); setStatus("ready"); } catch (err) { setError(err.message ?? "Unable to run analysis."); setStatus("error"); } };
  const [evaluation, setEvaluation] = useState(null);
  const resetDemo = async () => { const response = await fetch(`${API_URL}/api/agent/memory/reset`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); if (!response.ok) throw new Error("Unable to reset demo."); setAnalysis(null); setEvaluation(null); setError(""); await refreshShared(); };
  const runDistress = async () => { const response = await fetch(`${API_URL}/api/agent/conversation`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: "I am scared and I do not know where I am." }) }); if (!response.ok) throw new Error("Unable to run distress input."); await refreshShared(); };
  const runEvaluation = async () => { const response = await fetch(`${API_URL}/api/evaluation/run`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "Unable to run evaluation."); setEvaluation(data); };
  const addDemoReminder = async () => { const dueAt = new Date(Date.now() + 10000); const entry = { id: `demo-${dueAt.getTime()}`, name: "Demo medication reminder", time: dueAt.toTimeString().slice(0, 5), due_at: dueAt.toISOString() }; const response = await fetch(`${API_URL}/api/shared-state`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ medication_schedule: [...(shared.medication_schedule ?? []), entry] }) }); if (!response.ok) throw new Error("Unable to set demo reminder."); await refreshShared(); };
  const timeline = useMemo(() => analysis?.recent_behavior_history ?? [], [analysis]);
  return <main className="screen caretaker-screen"><AppHeader role="caretaker" /><RoleNavigation role="caretaker" />
    <section className="screen-intro"><p className="section-label">Shared view · polls every 3 seconds</p><h2>What changed, and what does the agent recommend?</h2><p>The factual deviation layer stays separate from the agent’s judgment. This dashboard only displays the shared result.</p></section>
    <div className="dashboard-overview"><DriftScore inputs={shared.drift_inputs} /><SafeZoneMap shared={shared} refreshShared={refreshShared} locationSharing={locationSharing} /></div>
    {error && <p className="error-message">{error}</p>}
    <section className="shared-status"><div><p className="section-label">Last agent status</p><p>{shared.latest_agent_trace ? `Updated from ${shared.latest_agent_trace.source.replaceAll("_", " ")}` : "Waiting for an analysis or patient message"}</p></div><AgentTrace decision={shared.latest_agent_trace?.decision} /></section>
    <DailyJournal journal={shared.daily_journal} health={health} refreshShared={refreshShared} />
    <MedicationSchedule schedule={shared.medication_schedule} refreshShared={refreshShared} />
    {status === "loading" && <section className="empty-state"><h2>The reasoning agent is reviewing context…</h2><p>It receives baseline facts, recent behavior, and surfaced deviations.</p></section>}
    {analysis && <section className="timeline-panel"><div className="panel-heading"><div><p className="section-label">Behavior timeline</p><h2>{analysis.persona.name} · simulated day</h2></div><span>{timeline.length} events</span></div><div className="timeline">{timeline.map((event) => { const flagged = analysis.surfaced_deviations.some((deviation) => deviation.actual?.event_id === event.id || deviation.expected?.event_id === event.id); return <article className={flagged ? "timeline-event flagged" : "timeline-event"} key={event.id}><time>{formatTime(event.timestamp)}</time><i /><div><span>{EVENT_LABELS[event.event_type]} {flagged && <b>Surfaced deviation</b>}</span><h3>{event.location}</h3><p>{eventSummary(event)}</p></div></article>; })}</div></section>}
  </main>;
}
function useDeviceLocationSharing({ refreshShared }) {
  const [status, setStatus] = useState("connecting");

  useEffect(() => {
    let active = true;
    let watchId = null;
    let refreshId = null;
    let fallbackRequested = false;

    const activateFallback = async (nextStatus) => {
      if (!active || fallbackRequested) return;
      fallbackRequested = true;
      try {
        const response = await fetch(`${API_URL}/api/location/fallback`, { method: "POST" });
        if (!response.ok) throw new Error("Unable to use the recorded check-in location.");
        await refreshShared();
        if (active) setStatus(nextStatus);
      } catch {
        if (active) setStatus("connection-error");
      }
    };
    const publishPosition = async (position) => {
      fallbackRequested = false;
      try {
        const response = await fetch(`${API_URL}/api/location/device`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy_meters: position.coords.accuracy,
            observed_at: new Date(position.timestamp || Date.now()).toISOString(),
          }),
        });
        if (!response.ok) throw new Error("Unable to share this device location.");
        await refreshShared();
        if (active) setStatus("sharing");
      } catch {
        if (active) setStatus("connection-error");
      }
    };
    const handleLocationError = (error) => {
      const nextStatus = error?.code === 1 ? "permission-denied" : "unavailable";
      activateFallback(nextStatus);
    };

    if (!window.isSecureContext) {
      activateFallback("insecure-context");
      return () => { active = false; };
    }
    if (!("geolocation" in window.navigator)) {
      activateFallback("unsupported");
      return () => { active = false; };
    }

    setStatus("requesting-permission");
    const options = {
      enableHighAccuracy: true,
      // A newly opened tab must ask the device for a fresh point, not reuse its cache.
      maximumAge: 0,
      timeout: 20_000,
    };
    const requestFreshPosition = () => window.navigator.geolocation.getCurrentPosition(publishPosition, handleLocationError, options);
    requestFreshPosition();
    watchId = window.navigator.geolocation.watchPosition(publishPosition, handleLocationError, options);
    // WatchPosition reacts to movement. This extra check keeps the shared location fresh
    // when a browser has temporarily paused movement callbacks in the background.
    refreshId = window.setInterval(requestFreshPosition, 30_000);
    return () => {
      active = false;
      if (watchId !== null) window.navigator.geolocation.clearWatch(watchId);
      if (refreshId !== null) window.clearInterval(refreshId);
    };
  }, [refreshShared]);

  return status;
}

function LocationSharingNotice({ status }) {
  const copy = {
    sharing: ["Location sharing is on", "Your location is being shared with Ananya to help keep you safe."],
    "requesting-permission": ["Location sharing", "Connecting this device to Ananya’s dashboard."],
    "permission-denied": ["Using your usual check-in location", "This device’s location is unavailable, so Ananya can see the latest recorded check-in."],
    unavailable: ["Using your usual check-in location", "This device’s location is unavailable, so Ananya can see the latest recorded check-in."],
    unsupported: ["Using your usual check-in location", "This device cannot share its location, so Ananya can see the latest recorded check-in."],
    "insecure-context": ["Location sharing needs a secure connection", "Open the app on HTTPS or localhost to share this device’s current location."],
    connected: ["Live location connected", "The patient device’s current location is visible on Ananya’s dashboard."],
    "connection-error": ["Location sharing paused", "The dashboard will continue showing the latest recorded check-in."],
    connecting: ["Location sharing", "Connecting this device to Ananya’s dashboard."],
  };
  const [heading, description] = copy[status] ?? copy.connecting;
  return <section className={`location-sharing-note location-sharing-note--${status}`} aria-live="polite"><span aria-hidden="true" /> <div><p className="section-label">{heading}</p><p>{description}</p></div></section>;
}

function Patient({ health, shared, refreshShared, locationSharing }) {
  return <main className="screen patient-screen"><AppHeader role="patient" /><RoleNavigation role="patient" />
    <section className="companion-hero"><div className="companion-avatar" aria-hidden="true">M</div><div><p className="section-label">Your companion</p><h2>Hello, Meera. How are you feeling today?</h2><p>You can tell me if you’re worried, lost, unwell, or simply want someone to check in.</p></div></section>
    <MedicationReminderList schedule={shared.medication_schedule} refreshShared={refreshShared} />
    <IntentVerificationCompanionPanel health={health} refreshShared={refreshShared} shared={shared} />
    <CompanionHistory />
  </main>;
}
function CompanionAgentPanel({ health, refreshShared }) {
  const [message, setMessage] = useState(""); const [response, setResponse] = useState(null); const [state, setState] = useState("idle"); const [error, setError] = useState(""); const [voiceState, setVoiceState] = useState("idle");
  useEffect(() => {
    if (!response) return;
    saveCompanionHistoryTurn(response);
  }, [response]);
  const speak = (text) => { try { if ("speechSynthesis" in window) { window.speechSynthesis.cancel(); window.speechSynthesis.speak(new SpeechSynthesisUtterance(text)); } } catch { setVoiceState("speech-unavailable"); } };
  const submit = async (text = message) => { if (!text.trim()) return; setState("loading"); setError(""); try { const result = await fetch(`${API_URL}/api/companion/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: text.trim() }) }); const data = await result.json(); if (!result.ok) throw new Error(data.error ?? "I couldn’t respond just now."); setResponse(data); setMessage(""); await refreshShared(); speak(data.companion_response.text); setState("ready"); } catch (requestError) { setError(requestError.message); setState("error"); } };
  const MicIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="2" width="6" height="11" rx="3" /><path d="M5 10a7 7 0 0 0 14 0" /><line x1="12" y1="19" x2="12" y2="22" /><line x1="8" y1="22" x2="16" y2="22" /></svg>;
  const startListening = () => { const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition; if (!Recognition) { setVoiceState("unsupported"); return; } const recognition = new Recognition(); recognition.lang = "en-IN"; recognition.interimResults = false; recognition.maxAlternatives = 1; setVoiceState("listening"); recognition.onresult = (event) => { const transcript = event.results[0][0].transcript; setMessage(transcript); setVoiceState("heard"); submit(transcript); }; recognition.onerror = () => setVoiceState("unavailable"); recognition.onend = () => setVoiceState((current) => current === "listening" ? "idle" : current); recognition.start(); };
  return <section className="companion-agent-panel"><div className="companion-agent-heading"><div className="companion-avatar" aria-hidden="true">N</div><div><p className="section-label">Nia, your companion</p><h2>I’m here with you, Meera.</h2><p>Ask about your reminders, set one, or tell me how you are feeling.</p></div></div><form onSubmit={(event) => { event.preventDefault(); submit(); }}><textarea value={message} onChange={(event) => setMessage(event.target.value)} maxLength="500" placeholder="For example: When is my evening tablet?" aria-label="Message to Nia" /><div className="companion-agent-actions"><button className="mic-button" type="button" onClick={startListening} disabled={state === "loading" || voiceState === "listening"} aria-label="Speak to Nia">{voiceState === "listening" ? <><MicIcon /><span>Listening…</span></> : <MicIcon />}</button><button type="submit" disabled={!message.trim() || state === "loading" || health.status !== "ready"}>{state === "loading" ? "Nia is thinking…" : "Send"}</button></div></form>{voiceState === "unsupported" && <p className="voice-note">Voice input is not available in this browser. You can still type your message.</p>}{voiceState === "unavailable" && <p className="voice-note">I couldn’t hear that. Please try the microphone again or type your message.</p>}{voiceState === "speech-unavailable" && <p className="voice-note">Nia’s reply is shown here because speech playback is unavailable.</p>}{error && <p className="error-message">{error}</p>}{response && <div className="companion-response"><p className="user-bubble">{response.direct_user_message.text}</p><div className="companion-bubble"><p>{response.companion_response.text}</p>{response.companion_response.tool_actions.length > 0 && <div className="tool-action-list">{response.companion_response.tool_actions.map((action, index) => <span key={`${action.name}-${index}`}>{action.success ? action.name.replaceAll("_", " ") : "Unable to complete action"}</span>)}</div>}{response.companion_response.agent_decision && <AgentTrace decision={response.companion_response.agent_decision} />}</div></div>}</section>;
}

function VisionCompanionAgentPanel({ health, refreshShared }) {
  const presets = [
    { id: "station", label: "Station scene", src: "/vision-presets/unfamiliar-station.png" },
    { id: "medicine", label: "Medicine bottle", src: "/vision-presets/medicine-bottle.png" },
    { id: "home", label: "Home interior", src: "/vision-presets/home-interior.png" },
  ];
  const photoInputRef = useRef(null);
  const [message, setMessage] = useState("");
  const [response, setResponse] = useState(null);
  const [state, setState] = useState("idle");
  const [error, setError] = useState("");
  const [voiceState, setVoiceState] = useState("idle");
  const [photo, setPhoto] = useState(null);

  useEffect(() => {
    if (!response) return;
    saveCompanionHistoryTurn(response);
  }, [response]);

  const readPhoto = (file, label = file?.name) => new Promise((resolve, reject) => {
    if (!file?.type.match(/^image\/(png|jpeg|webp)$/)) return reject(new Error("Please choose a PNG, JPEG, or WebP photo."));
    if (file.size > 6 * 1024 * 1024) return reject(new Error("Please choose a photo smaller than 6 MB."));
    const reader = new FileReader();
    reader.onload = () => resolve({ dataUrl: reader.result, label });
    reader.onerror = () => reject(new Error("I couldn’t read that photo."));
    reader.readAsDataURL(file);
  });

  const chooseUpload = async (event) => {
    try { setError(""); setPhoto(await readPhoto(event.target.files?.[0])); }
    catch (photoError) { setError(photoError.message); }
    finally { event.target.value = ""; }
  };
  const choosePreset = async (preset) => {
    try {
      setError("");
      const presetResponse = await fetch(preset.src);
      if (!presetResponse.ok) throw new Error();
      const blob = await presetResponse.blob();
      setPhoto(await readPhoto(new File([blob], `${preset.id}.png`, { type: blob.type || "image/png" }), preset.label));
    } catch { setError("I couldn’t prepare that photo. Please try again."); }
  };
  const speak = (text) => { try { if ("speechSynthesis" in window) { window.speechSynthesis.cancel(); window.speechSynthesis.speak(new SpeechSynthesisUtterance(text)); } } catch { setVoiceState("speech-unavailable"); } };
  const submit = async (text = message) => {
    if (!text.trim() && !photo) return;
    const messageForRequest = text.trim() || `I shared a ${photo.label}. Please help me understand what I am seeing.`;
    setState("loading"); setError("");
    try {
      const result = await fetch(`${API_URL}/api/companion/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: messageForRequest, image_data_url: photo?.dataUrl ?? null }) });
      const data = await result.json();
      if (!result.ok) throw new Error(data.error ?? "I couldn’t respond just now.");
      setResponse(data); setMessage(""); setPhoto(null); await refreshShared(); speak(data.companion_response.text); setState("ready");
    } catch (requestError) { setError(requestError.message); setState("error"); }
  };
  const MicIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="2" width="6" height="11" rx="3" /><path d="M5 10a7 7 0 0 0 14 0" /><line x1="12" y1="19" x2="12" y2="22" /><line x1="8" y1="22" x2="16" y2="22" /></svg>;
  const startListening = () => {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) { setVoiceState("unsupported"); return; }
    const recognition = new Recognition(); recognition.lang = "en-IN"; recognition.interimResults = false; recognition.maxAlternatives = 1; setVoiceState("listening");
    recognition.onresult = (event) => { const transcript = event.results[0][0].transcript; setMessage(transcript); setVoiceState("heard"); submit(transcript); };
    recognition.onerror = () => setVoiceState("unavailable"); recognition.onend = () => setVoiceState((current) => current === "listening" ? "idle" : current); recognition.start();
  };

  return <section className="companion-agent-panel vision-companion-panel"><div className="companion-agent-heading"><div className="companion-avatar" aria-hidden="true">N</div><div><p className="section-label">Nia, your companion</p><h2>I’m here with you, Meera.</h2><p>Ask about reminders, tell me how you feel, or show me what you see.</p></div></div><form onSubmit={(event) => { event.preventDefault(); submit(); }}><textarea value={message} onChange={(event) => setMessage(event.target.value)} maxLength="500" placeholder="For example: I don’t know where I am." aria-label="Message to Nia" />{photo && <div className="photo-selection"><img src={photo.dataUrl} alt="Photo selected to share with Nia" /><span>{photo.label}</span><button type="button" onClick={() => setPhoto(null)}>Remove</button></div>}<input ref={photoInputRef} className="photo-file-input" type="file" accept="image/png,image/jpeg,image/webp" capture="environment" onChange={chooseUpload} /><div className="companion-agent-actions"><div className="companion-input-tools"><button className="mic-button" type="button" onClick={startListening} disabled={state === "loading" || voiceState === "listening"}>{voiceState === "listening" ? <><MicIcon /><span>Listening…</span></> : <MicIcon />}</button><button className="photo-button" type="button" onClick={() => photoInputRef.current?.click()} disabled={state === "loading"}>Use camera or photo</button></div><button type="submit" disabled={(!message.trim() && !photo) || state === "loading" || health.status !== "ready"}>{state === "loading" ? "Nia is thinking…" : "Send"}</button></div></form><div className="vision-presets"><p>Try a photo</p><div>{presets.map((preset) => <button type="button" key={preset.id} onClick={() => choosePreset(preset)} disabled={state === "loading"}><img src={preset.src} alt="" /><span>{preset.label}</span></button>)}</div></div>{voiceState === "unsupported" && <p className="voice-note">Voice input is not available in this browser. You can still type your message.</p>}{voiceState === "unavailable" && <p className="voice-note">I couldn’t hear that. Please try the microphone again or type your message.</p>}{voiceState === "speech-unavailable" && <p className="voice-note">Nia’s reply is shown here because speech playback is unavailable.</p>}{error && <p className="error-message">{error}</p>}{response && <div className="companion-response"><p className="user-bubble">{response.direct_user_message.text}</p><div className="companion-bubble"><p>{response.companion_response.text}</p></div></div>}</section>;
}

function IntentVerificationCompanionPanel({ health, refreshShared, shared }) {
  const photoInputRef = useRef(null);
  const [message, setMessage] = useState("");
  const [response, setResponse] = useState(null);
  const [state, setState] = useState("idle");
  const [error, setError] = useState("");
  const [voiceState, setVoiceState] = useState("idle");
  const [photo, setPhoto] = useState(null);
  const intents = shared.companion_session?.intents ?? {};

  useEffect(() => {
    if (!response) return;
    saveCompanionHistoryTurn(response);
  }, [response]);

  const readPhoto = (file, label = file?.name, presetId = null) => new Promise((resolve, reject) => {
    if (!file?.type.match(/^image\/(png|jpeg|webp)$/)) return reject(new Error("Please choose a PNG, JPEG, or WebP photo."));
    if (file.size > 6 * 1024 * 1024) return reject(new Error("Please choose a photo smaller than 6 MB."));
    const reader = new FileReader();
    reader.onload = () => resolve({ dataUrl: reader.result, label, presetId });
    reader.onerror = () => reject(new Error("I couldn’t read that photo."));
    reader.readAsDataURL(file);
  });
  const chooseUpload = async (event) => {
    try { setError(""); setPhoto(await readPhoto(event.target.files?.[0])); }
    catch (photoError) { setError(photoError.message); }
    finally { event.target.value = ""; }
  };
  const speak = (text) => { try { if ("speechSynthesis" in window) { window.speechSynthesis.cancel(); window.speechSynthesis.speak(new SpeechSynthesisUtterance(text)); } } catch { setVoiceState("speech-unavailable"); } };
  const submit = async (text = message) => {
    if (!text.trim() && !photo) return;
    const selectedPhoto = photo;
    const messageForRequest = text.trim() || `I’ve shared a ${selectedPhoto.label}. Can you help me double-check it?`;
    setState("loading"); setError("");
    try {
      const result = await fetch(`${API_URL}/api/companion/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: messageForRequest, image_data_url: selectedPhoto?.dataUrl ?? null, vision_preset_id: selectedPhoto?.presetId ?? null }) });
      const data = await result.json();
      if (!result.ok) throw new Error(data.error ?? "I couldn’t respond just now.");
      setResponse(data); setMessage(""); setPhoto(null); await refreshShared(); speak(data.companion_response.text); setState("ready");
    } catch (requestError) { setError(requestError.message); setState("error"); }
  };
  const MicIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="2" width="6" height="11" rx="3" /><path d="M5 10a7 7 0 0 0 14 0" /><line x1="12" y1="19" x2="12" y2="22" /><line x1="8" y1="22" x2="16" y2="22" /></svg>;
  const startListening = () => {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) { setVoiceState("unsupported"); return; }
    const recognition = new Recognition(); recognition.lang = "en-IN"; recognition.interimResults = false; recognition.maxAlternatives = 1; setVoiceState("listening");
    recognition.onresult = (event) => { const transcript = event.results[0][0].transcript; setMessage(transcript); setVoiceState("heard"); submit(transcript); };
    recognition.onerror = () => setVoiceState("unavailable"); recognition.onend = () => setVoiceState((current) => current === "listening" ? "idle" : current); recognition.start();
  };

  return <section className="companion-agent-panel intent-verification-panel"><div className="companion-agent-heading"><div className="companion-avatar" aria-hidden="true">N</div><div><p className="section-label">Nia, your companion</p><h2>I'm here with you, Meera.</h2><p>Tell me how you're feeling, or share what you see.</p></div></div>{(intents.destination || intents.medication) && <div className="remembered-intent"><span>Nia is keeping in mind</span>{intents.destination && <p>Your destination: {intents.destination.value}</p>}{intents.medication && <p>Your medicine: {intents.medication.value}</p>}</div>}<form onSubmit={(event) => { event.preventDefault(); submit(); }}><textarea value={message} onChange={(event) => setMessage(event.target.value)} maxLength="500" placeholder="For example: I’m heading to Indore." aria-label="Message to Nia" />{photo && <div className="photo-selection"><img src={photo.dataUrl} alt="Photo selected to share with Nia" /><span>{photo.label}</span><button type="button" onClick={() => setPhoto(null)}>Remove</button></div>}<input ref={photoInputRef} className="photo-file-input" type="file" accept="image/png,image/jpeg,image/webp" capture="environment" onChange={chooseUpload} /><div className="companion-agent-actions"><div className="companion-input-tools"><button className="mic-button" type="button" onClick={startListening} disabled={state === "loading" || voiceState === "listening"} aria-label="Speak to Nia">{voiceState === "listening" ? <><MicIcon /><span>Listening…</span></> : <MicIcon />}</button><button className="photo-button" type="button" onClick={() => photoInputRef.current?.click()} disabled={state === "loading"}>Use camera</button></div><button type="submit" disabled={(!message.trim() && !photo) || state === "loading" || health.status !== "ready"}>{state === "loading" ? "Nia is thinking…" : "Send"}</button></div></form>{voiceState === "unsupported" && <p className="voice-note">Voice input is not available in this browser. You can still type your message.</p>}{voiceState === "unavailable" && <p className="voice-note">I couldn’t hear that. Please try the microphone again or type your message.</p>}{voiceState === "speech-unavailable" && <p className="voice-note">Nia’s reply is shown here because speech playback is unavailable.</p>}{error && <p className="error-message">{error}</p>}{response && <div className="companion-response"><p className="user-bubble">{response.direct_user_message.text}</p><div className="companion-bubble"><p>{response.companion_response.text}</p></div></div>}</section>;
}
const COMPANION_HISTORY_KEY = "kikunet-companion-history-v1";
function localDateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function historyTimestamp(entry) {
  if (entry?.created_at && !Number.isNaN(new Date(entry.created_at).getTime())) return new Date(entry.created_at).toISOString();
  const timestampFromId = Number(String(entry?.id ?? "").split("-")[0]);
  return Number.isFinite(timestampFromId) && timestampFromId > 0 ? new Date(timestampFromId).toISOString() : new Date().toISOString();
}
function normalizeHistoryEntry(entry) {
  return {
    id: String(entry?.id ?? `legacy-${Date.now()}`),
    message: String(entry?.message ?? ""),
    reply: String(entry?.reply ?? ""),
    created_at: historyTimestamp(entry),
  };
}
function readCompanionHistory() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(COMPANION_HISTORY_KEY) ?? "[]");
    return Array.isArray(saved) ? saved.map(normalizeHistoryEntry) : [];
  } catch { return []; }
}
function saveCompanionHistoryTurn(response) {
  const history = readCompanionHistory();
  const createdAt = new Date().toISOString();
  const entry = {
    id: `${Date.now()}-${response.direct_user_message.id}`,
    message: response.direct_user_message.text,
    reply: response.companion_response.text.replaceAll("**", ""),
    created_at: createdAt,
  };
  window.localStorage.setItem(COMPANION_HISTORY_KEY, JSON.stringify([...history, entry].slice(-100)));
}
function conversationDateLabel(dateKey) {
  if (dateKey === localDateKey(new Date())) return "Today";
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (dateKey === localDateKey(yesterday)) return "Yesterday";
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${dateKey}T12:00:00`));
}
function CompanionHistory() {
  const [history, setHistory] = useState(() => readCompanionHistory());
  const [selectedDate, setSelectedDate] = useState(null);
  useEffect(() => { const timer = window.setInterval(() => setHistory(readCompanionHistory()), 400); return () => window.clearInterval(timer); }, []);
  const groupedHistory = useMemo(() => history.slice().sort((left, right) => new Date(left.created_at) - new Date(right.created_at)).reduce((groups, item) => {
    const key = localDateKey(item.created_at);
    groups[key] = [...(groups[key] ?? []), item];
    return groups;
  }, {}), [history]);
  const dates = Object.keys(groupedHistory).sort((left, right) => right.localeCompare(left));
  const datesKey = dates.join("|");
  useEffect(() => {
    if (!selectedDate || !dates.includes(selectedDate)) setSelectedDate(dates[0] ?? null);
  }, [datesKey, selectedDate]);
  if (history.length === 0) return null;
  const visibleHistory = groupedHistory[selectedDate] ?? groupedHistory[dates[0]] ?? [];
  const visibleDate = selectedDate ?? dates[0];
  return <div className="companion-history-layout"><aside className="companion-date-nav" aria-label="Conversation dates"><p className="section-label">Conversation dates</p><div>{dates.map((date) => <button type="button" className={date === visibleDate ? "active" : ""} key={date} onClick={() => setSelectedDate(date)}><span>{conversationDateLabel(date)}</span><small>{groupedHistory[date].length}</small></button>)}</div></aside><section className="companion-history" aria-label={`Conversation with Nia on ${conversationDateLabel(visibleDate)}`}><div className="companion-history-heading"><p className="section-label">{conversationDateLabel(visibleDate)}</p><span>{visibleHistory.length} {visibleHistory.length === 1 ? "message" : "messages"}</span></div>{visibleHistory.map((item) => <div className="history-turn" key={item.id}><p className="user-bubble">{item.message}</p><div className="companion-bubble"><p>{item.reply}</p></div></div>)}</section></div>;
}
function reminderIsDue(entry, now) {
  if (typeof entry === "string") {
    const [hours, minutes] = entry.split(":").map(Number);
    return now.getHours() * 60 + now.getMinutes() >= hours * 60 + minutes;
  }
  if (entry.due_at) return new Date(entry.due_at).getTime() <= now.getTime();
  const [hours, minutes] = entry.time.split(":").map(Number);
  return now.getHours() * 60 + now.getMinutes() >= hours * 60 + minutes;
}
function PatientReminders({ schedule = [] }) {
  const [now, setNow] = useState(() => new Date());
  const spokenReminderIds = useRef(new Set());
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 1000); return () => window.clearInterval(timer); }, []);
  useEffect(() => {
    schedule.filter((entry) => reminderIsDue(entry, now) && !spokenReminderIds.current.has(entry.id)).forEach((entry) => {
      spokenReminderIds.current.add(entry.id);
      if ("speechSynthesis" in window) {
        try { window.speechSynthesis.speak(new SpeechSynthesisUtterance(`It is time for your ${entry.name}.`)); } catch { /* Reminder remains visible if browser speech is unavailable. */ }
      }
    });
  }, [schedule, now]);
  return <section className="patient-reminders"><p className="section-label">Today’s reminders</p><h2>Medication reminders</h2>{schedule.length === 0 ? <p className="muted">Your caretaker has not scheduled a reminder yet.</p> : <div>{schedule.map((entry) => { const due = reminderIsDue(entry.time, now); return <article className={due ? "patient-reminder patient-reminder--due" : "patient-reminder"} key={entry.id}><span>{due ? "Due now" : "Upcoming"}</span><strong>{entry.name}</strong><time>{entry.time}</time></article>; })}</div>}</section>;
}
function MedicationReminderList({ schedule = [], refreshShared }) {
  const [acknowledgingIds, setAcknowledgingIds] = useState([]);
  const markTaken = async (id) => {
    const reminder = schedule.find((entry) => entry.id === id);
    if (!reminder || reminder.acknowledged_at || acknowledgingIds.includes(id)) return;
    setAcknowledgingIds((ids) => [...ids, id]);
    try {
      const medication_schedule = schedule.map((entry) => entry.id === id ? { ...entry, acknowledged_at: new Date().toISOString() } : entry);
      const response = await fetch(`${API_URL}/api/shared-state`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ medication_schedule }) });
      if (!response.ok) throw new Error("Unable to mark the medicine as taken.");
      await refreshShared();
    } catch {
      setAcknowledgingIds((ids) => ids.filter((entryId) => entryId !== id));
    }
  };
  return <section className="patient-reminders"><p className="section-label">Today's reminders</p><h2>Medication reminders</h2>{schedule.length === 0 ? <p className="muted">Your caretaker has not scheduled a reminder yet.</p> : <div>{schedule.map((entry) => { const taken = Boolean(entry.acknowledged_at) || acknowledgingIds.includes(entry.id); const due = !taken && reminderIsDue(entry, new Date()); const className = taken ? "patient-reminder patient-reminder--taken" : due ? "patient-reminder patient-reminder--due" : "patient-reminder"; return <article className={className} key={entry.id}><span>{taken ? "Taken" : due ? "Due now" : "Upcoming"}</span><div className="reminder-info"><strong>{entry.name}</strong>{entry.dosage && <small className="reminder-dosage">{entry.dosage}</small>}</div><time>{entry.time}</time><button className={taken ? "reminder-tick reminder-tick--taken" : "reminder-tick"} type="button" onClick={() => markTaken(entry.id)} disabled={taken} aria-label={taken ? `${entry.name} marked as taken` : `Mark ${entry.name} as taken`} title={taken ? "Taken" : "Mark as taken"}>✓</button></article>; })}</div>}</section>;
}
function CaretakerDistressWarning({ alert, refreshShared }) {
  const [acknowledging, setAcknowledging] = useState(false);
  if (!alert?.active) return null;
  const acknowledge = async () => { setAcknowledging(true); try { await fetch(`${API_URL}/api/shared-state`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ distress_alert: false }) }); await refreshShared(); } finally { setAcknowledging(false); } };
  return <section className="distress-warning" role="alert"><div><p className="section-label">Patient distress alert</p><h2>Meera may need support now</h2><p>{alert.message}</p>{alert.immediate_action && <small>Agent action: {alert.immediate_action}</small>}</div><button onClick={acknowledge} disabled={acknowledging}>{acknowledging ? "Acknowledging…" : "Acknowledge"}</button></section>;
}
export default function App() {
  const role = window.location.pathname.startsWith("/patient") ? "patient" : "caretaker";
  const [health, setHealth] = useState({ status: "checking", message: "Connecting…" }); const [shared, setShared] = useState({ latest_agent_trace: null });
  const refreshShared = useCallback(async () => { const response = await fetch(`${API_URL}/api/shared-state`); if (!response.ok) throw new Error("Shared state is unavailable."); const data = await response.json(); setShared(data); return data; }, []);
  const locationSharing = useDeviceLocationSharing({ refreshShared });
  useEffect(() => { let mounted = true; const check = async () => { try { const response = await fetch(`${API_URL}/api/health`); const data = await response.json(); if (mounted) setHealth({ status: "ready", message: data.message }); await refreshShared(); } catch { if (mounted) setHealth({ status: "error", message: "Backend unavailable" }); } }; check(); const poller = window.setInterval(() => { refreshShared().catch(() => {}); }, 3000); return () => { mounted = false; window.clearInterval(poller); }; }, [refreshShared]);
  return role === "patient" ? <Patient health={health} shared={shared} refreshShared={refreshShared} locationSharing={locationSharing} /> : <><Caretaker health={health} shared={shared} refreshShared={refreshShared} locationSharing={locationSharing} /><CaretakerDistressWarning alert={shared.distress_alert} refreshShared={refreshShared} /></>;
}
