import OpenAI from "openai";
import { acknowledgeReminder, createReminder, getActiveCompanionIntents, getSharedState, saveCompanionIntent, updateReminder } from "./shared-state.js";
import { makeAgentDecision } from "./agent.js";
import { getVisionPreset } from "./vision.js";

const TOOLS = Object.freeze([
  { type: "function", name: "get_schedule", description: "Get the current medication reminder schedule before answering schedule questions.", parameters: { type: "object", properties: {}, required: [], additionalProperties: false }, strict: true },
  { type: "function", name: "create_reminder", description: "Create a medication reminder when the person explicitly asks for one.", parameters: { type: "object", properties: { name: { type: "string" }, time: { type: "string", description: "24-hour HH:MM time" } }, required: ["name", "time"], additionalProperties: false }, strict: true },
  { type: "function", name: "update_reminder", description: "Edit an existing reminder only when its ID is known from the schedule.", parameters: { type: "object", properties: { id: { type: "string" }, name: { type: ["string", "null"] }, time: { type: ["string", "null"] } }, required: ["id", "name", "time"], additionalProperties: false }, strict: true },
  { type: "function", name: "acknowledge_reminder", description: "Mark a scheduled reminder as taken when the person says they took it.", parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false }, strict: true },
  { type: "function", name: "set_stated_intent", description: "Remember a short-lived stated destination or medicine intention when Meera says she is heading/going to a place or is about to take a medicine. Use the exact destination or medicine name she stated before responding naturally.", parameters: { type: "object", properties: { type: { type: "string", enum: ["destination", "medication"] }, value: { type: "string" } }, required: ["type", "value"], additionalProperties: false }, strict: true },
  { type: "function", name: "escalate_to_caregiver", description: "Ask the existing safety reasoner to assess a distress, fear, disorientation, or urgent wellbeing message before telling the person that a caregiver was contacted.", parameters: { type: "object", properties: { reason: { type: "string" } }, required: ["reason"], additionalProperties: false }, strict: true },
]);

function driftSummary(inputs = {}) {
  const score = Math.round((inputs.routine_deviation ?? 0) * 0.4 + (inputs.communication_gap ?? 0) * 0.25 + (inputs.safe_zone_adherence ?? 0) * 0.2 + (inputs.medication_adherence ?? 0) * 0.15);
  const band = score <= 30 ? "Stable" : score <= 55 ? "Watch" : score <= 75 ? "Elevated" : "Urgent";
  return { score, band };
}

export function buildCompanionContext(shared = getSharedState()) {
  const drift = driftSummary(shared.drift_inputs);
  return {
    medication_schedule: shared.medication_schedule,
    latest_agent_status: shared.latest_agent_trace?.decision ? {
      decision: shared.latest_agent_trace.decision.decision,
      confidence: shared.latest_agent_trace.decision.confidence,
      updated_at: shared.latest_agent_trace.updated_at,
    } : null,
    drift,
    safe_zone_status: shared.drift_inputs?.safe_zone_adherence > 0 ? "outside safe zone" : "inside safe zone",
    active_stated_intents: getActiveCompanionIntents(),
  };
}

function buildInstructions(dashboardContext) {
  return `You are Nia, Meera Shah's warm, patient safety companion. Speak naturally, briefly, and kindly. Never sound clinical, technical, rushed, or like a system log. Never say decision, escalation, confidence level, or that you logged a report.

You know only the dashboard context below. Do not invent medication names, reminder times, agent statuses, or safety facts. For any schedule question, call get_schedule before answering. Always name the medicine together with its exact reminder time; if the question is general, list the scheduled medicine names and times rather than saying only "your medicine." If a medicine is absent, say plainly that you do not have it in Meera's schedule. Use plain text only: never use Markdown characters such as **. Never claim a reminder was created, changed, acknowledged, or a caregiver contacted until its tool result confirms it.

Meera's live location is already shared with her care team. If she feels lost or uneasy, reassure her that her location is already being shared and that Ananya can use it to help. Never ask Meera where she is, and never ask her to share her phone's location.

When Meera states that she is heading or going to a place, or is about to take a medicine, call set_stated_intent with her exact stated destination or medicine name. This is short-lived context for a photo she may share next. When a photo arrives, compare it with any active stated intent and with the dashboard context; do not treat a photo in isolation.

For a destination photo, describe only visually identifiable details and compare them with the stated destination. This is best-effort visual reasoning, not precise geolocation. A clearly readable different city or station name is a significant mismatch. If there is a significant mismatch or Meera seems confused or unsafe, call escalate_to_caregiver. In the tool reason, cite both the stated intent and concrete visual evidence.

For a medicine photo with an active medicine intent or scheduled medicine, call get_schedule before replying. Compare the visible label with the real schedule only; never guess a medicine name, dosage, or safety instruction. Never say a photo definitely confirms the right medicine or dosage. Even when the label appears to match, use careful wording such as "it looks like it could be" and suggest checking the label or asking Ananya if Meera is unsure. If the photo clearly differs from the scheduled or intended medicine, caution her not to take it until it is checked; escalate only if the mismatch is significant or she seems confused. A medicine photo by itself is not an emergency.

Examples:
User: When is my iron tablet?
Nia: Let me check your reminders for you.
User: Remind me to take my BP tablet at 9pm.
Nia: Of course. I’ll set that reminder for 9:00 PM.
User: I feel scared and I do not know where I am.
Nia: I’m here with you. I’ll get extra help and let Ananya know you may need support.
User: Did I take my evening tablet?
Nia: I can check your reminder status with you.
User: I am heading to Indore.
Nia: I will keep that in mind. Show me a photo when you are there and I can help you double-check what you are seeing.
User: I am about to take my paracetamol.
Nia: I will remember that. Please show me the packet too, and we can look at the label together.

Current dashboard context: ${JSON.stringify(dashboardContext)}`;
}

function clientRequest({ input, instructions }) {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured.");
  if (!process.env.OPENAI_MODEL) throw new Error("OPENAI_MODEL is not configured.");
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY }).responses.create({ model: process.env.OPENAI_MODEL, reasoning: { effort: "low" }, instructions, tools: TOOLS, input });
}

async function executeTool(call, { conversationContext, priorDecisions, visionPreset = null, hasVision = false }) {
  const args = JSON.parse(call.arguments || "{}");
  switch (call.name) {
    case "get_schedule": return { schedule: getSharedState().medication_schedule };
    case "create_reminder": return { reminder: createReminder(args) };
    case "update_reminder": return { reminder: updateReminder(args) };
    case "acknowledge_reminder": return { reminder: acknowledgeReminder(args.id) };
    case "set_stated_intent": return { stated_intent: saveCompanionIntent(args) };
    case "escalate_to_caregiver": {
      const intentEvidence = Object.values(getActiveCompanionIntents()).map((intent) => `Stated ${intent.type}: ${intent.value}.`).join(" ");
      const contextWithVisionEvidence = {
        ...conversationContext,
        direct_user_message: {
          ...conversationContext.direct_user_message,
          text: `${conversationContext.direct_user_message.text}${intentEvidence ? `\n\n${intentEvidence}` : ""}${visionPreset ? `\n\nPreset photo detail: ${visionPreset.visible_details}` : ""}${hasVision ? `\n\nCompanion observation from the shared photo: ${args.reason}` : ""}`,
        },
      };
      const agentDecision = await makeAgentDecision(contextWithVisionEvidence, priorDecisions);
      return { agent_decision: agentDecision, escalation_permitted: agentDecision.decision === "notify_caregiver" };
    }
    default: throw new Error(`Unsupported companion tool '${call.name}'.`);
  }
}

const IMAGE_DATA_URL = /^data:(image\/(?:png|jpe?g|webp));base64,[a-z0-9+/=]+$/i;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

export function validateVisionImage(imageDataUrl) {
  if (!imageDataUrl) return null;
  if (typeof imageDataUrl !== "string" || !IMAGE_DATA_URL.test(imageDataUrl)) {
    throw new Error("Photo must be a PNG, JPEG, or WebP image.");
  }
  const encoded = imageDataUrl.slice(imageDataUrl.indexOf(",") + 1);
  if (Buffer.byteLength(encoded, "base64") > MAX_IMAGE_BYTES) {
    throw new Error("Photo is too large. Please choose an image smaller than 6 MB.");
  }
  return imageDataUrl;
}

export function buildCompanionInput({ message, dashboardContext, imageDataUrl = null, visionPreset = null }) {
  const content = [{ type: "input_text", text: JSON.stringify({
    message,
    dashboard_context: dashboardContext,
    selected_demo_photo: visionPreset ? { id: visionPreset.id, label: visionPreset.label, visible_details: visionPreset.visible_details } : null,
  }) }];
  if (imageDataUrl) content.push({ type: "input_image", image_url: imageDataUrl, detail: "low" });
  return [{ role: "user", content }];
}

/** Executes the Responses API function-calling loop and returns a natural companion reply. */
export async function makeCompanionResponse({ message, imageDataUrl = null, visionPresetId = null, conversationContext, priorDecisions = [], requestResponse = clientRequest }) {
  const dashboardContext = buildCompanionContext();
  const instructions = buildInstructions(dashboardContext);
  const validImage = validateVisionImage(imageDataUrl);
  const visionPreset = getVisionPreset(visionPresetId);
  let input = buildCompanionInput({ message, dashboardContext, imageDataUrl: validImage, visionPreset });
  const actions = [];
  let escalationDecision = null;

  for (let turn = 0; turn < 4; turn += 1) {
    const response = await requestResponse({ input, instructions });
    const calls = (response.output ?? []).filter((item) => item.type === "function_call");
    if (calls.length === 0) {
      return { text: response.output_text || "I’m here with you. Could you say that once more?", tool_actions: actions, agent_decision: escalationDecision, model: process.env.OPENAI_MODEL, fallback: false };
    }
    input.push(...response.output);
    for (const call of calls) {
      try {
        const result = await executeTool(call, { conversationContext, priorDecisions, visionPreset, hasVision: Boolean(validImage) });
        if (result.agent_decision) escalationDecision = result.agent_decision;
        actions.push({ name: call.name, success: true, result });
        input.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify({ success: true, ...result }) });
      } catch (error) {
        actions.push({ name: call.name, success: false, error: error.message });
        input.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify({ success: false, error: error.message }) });
      }
    }
  }
  return { text: "I’m sorry, I couldn’t complete that just now. Please try again, or ask Ananya for help.", tool_actions: actions, agent_decision: escalationDecision, model: process.env.OPENAI_MODEL, fallback: true };
}
