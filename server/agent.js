import OpenAI from "openai";

export const DECISIONS = Object.freeze([
  "continue_monitoring",
  "conversational_prompt",
  "navigation_assist",
  "notify_caregiver",
]);

export const CONFIDENCE_LEVELS = Object.freeze(["low", "medium", "high"]);

const reasoningItemSchema = {
  type: "object",
  additionalProperties: false,
  required: ["statement", "surfaced_deviation_ids", "cited_facts"],
  properties: {
    statement: { type: "string", minLength: 1 },
    surfaced_deviation_ids: { type: "array", items: { type: "string" }, minItems: 1 },
    cited_facts: { type: "array", items: { type: "string" }, minItems: 1 },
  },
};

const decisionSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "decision",
    "confidence",
    "interpretation",
    "plausible_explanations",
    "uncertainty_assessment",
    "reasoning",
    "immediate_action",
    "follow_up_action",
    "caregiver_summary",
    "escalation_flag",
  ],
  properties: {
    decision: { type: "string", enum: DECISIONS },
    confidence: { type: "string", enum: CONFIDENCE_LEVELS },
    interpretation: { type: "array", items: reasoningItemSchema, minItems: 1 },
    plausible_explanations: { type: "array", items: reasoningItemSchema, minItems: 1 },
    uncertainty_assessment: { type: "array", items: reasoningItemSchema, minItems: 1 },
    reasoning: { type: "array", items: reasoningItemSchema, minItems: 1 },
    immediate_action: { type: "string", minLength: 1 },
    follow_up_action: { type: "string", minLength: 1 },
    caregiver_summary: { type: "string", minLength: 1 },
    escalation_flag: { type: "boolean" },
  },
};

const memoryByPersona = new Map();

function getClient() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured. Add it to .env before requesting an agent decision.");
  }

  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

function requireConfiguredModel() {
  if (!process.env.OPENAI_MODEL) {
    throw new Error("OPENAI_MODEL is not configured. Set it in .env before requesting an agent decision.");
  }
}

function buildInstructions(retry = false) {
  return `You are the autonomous reasoning agent in an elderly-safety companion.

The deterministic layer has already surfaced factual differences. You—not the deterministic
layer—must interpret those facts, consider plausible non-diagnostic explanations, assess
uncertainty, choose an intervention, and plan next steps. Do not treat a deviation type as
a fixed decision rule. Weigh the persona profile, recent history, baseline reference, and
prior agent decisions together.

Return concise, evidence-grounded decision rationale; do not provide private chain-of-thought.
Every item in interpretation, plausible_explanations, uncertainty_assessment, and reasoning
must: (1) name one or more surfaced_deviation_ids and (2) cite concrete expected, actual, or
difference facts from those deviations. When direct_user_message is present, its id is also a
valid evidence id: cite the actual message wording in cited_facts and do not require a behavior
deviation for a decision. Do not use generic claims such as "this is unusual" without the values
or wording that make it so. Plausible explanations must remain possibilities, not diagnoses.
The caregiver_summary must concisely state the actual factual trigger and chosen intervention.
Do not invent events, contacts, locations, or observations not present in context. For ambiguous,
low-confidence direct messages, use follow_up_action for one concise clarifying question only.
For a direct message explicitly expressing fear plus disorientation, choose navigation_assist or
notify_caregiver unless the supplied context contains concrete evidence that the person is safe.
When decision is conversational_prompt, immediate_action must be a ready-to-send, warm check-in
message to the elder that references the evidence. Do not describe how to draft the message.
If direct_user_message contains a section beginning "Companion observation from the shared photo:",
that observation is factual vision evidence. Quote or clearly cite its concrete visual detail in
at least one interpretation item and one reasoning item; do not substitute a generic statement
such as "the photo is concerning".

When recurrence_context.matching_prior_decision_count is greater than zero, the current
deviation IDs also appeared in prior decisions and no resolution event has been supplied.
Explicitly address that recurrence in the reasoning and weigh it when choosing an intervention.
Do not apply a fixed escalation rule: decide autonomously whether the evidence supports a
changed action or escalation.
${retry ? "Your prior response did not satisfy the required JSON contract. Return only JSON matching the schema exactly." : ""}`;
}

function recentHistory(events) {
  return events.slice(-48);
}

export function assembleAgentContext(deviationPayload, priorDecisions = []) {
  const currentDeviationIds = deviationPayload.surfaced_deviations.map((deviation) => deviation.id);
  const matchingPriorDecisionCount = priorDecisions.filter((decision) =>
    decision.surfaced_deviation_ids?.some((id) => currentDeviationIds.includes(id)),
  ).length;

  return {
    persona_profile: deviationPayload.persona,
    current_simulated_date: deviationPayload.date,
    recent_behavior_history: recentHistory(deviationPayload.recent_behavior_history ?? []),
    baseline_reference: deviationPayload.baseline_reference,
    surfaced_deviations: deviationPayload.surfaced_deviations,
    direct_user_message: deviationPayload.direct_user_message ?? null,
    prior_agent_decisions: priorDecisions.slice(-10),
    recurrence_context: {
      current_surfaced_deviation_ids: currentDeviationIds,
      matching_prior_decision_count: matchingPriorDecisionCount,
      resolution_event_supplied: false,
    },
  };
}

function allReasoningItems(decision) {
  return [
    ...decision.interpretation,
    ...decision.plausible_explanations,
    ...decision.uncertainty_assessment,
    ...decision.reasoning,
  ];
}

export function validateAgentDecision(decision, surfacedDeviations, additionalEvidenceIds = []) {
  if (!decision || typeof decision !== "object") throw new Error("Agent response is not an object.");

  const required = Object.keys(decisionSchema.properties);
  for (const key of required) {
    if (!(key in decision)) throw new Error(`Agent response is missing '${key}'.`);
  }
  if (!DECISIONS.includes(decision.decision)) throw new Error("Agent response has an unsupported decision.");
  if (!CONFIDENCE_LEVELS.includes(decision.confidence)) throw new Error("Agent response has an unsupported confidence.");
  if (typeof decision.escalation_flag !== "boolean") throw new Error("Agent response has an invalid escalation flag.");

  for (const field of ["immediate_action", "follow_up_action", "caregiver_summary"]) {
    if (typeof decision[field] !== "string" || !decision[field].trim()) {
      throw new Error(`Agent response has an invalid '${field}'.`);
    }
  }

  const knownDeviationIds = new Set([
    ...surfacedDeviations.map((deviation) => deviation.id),
    ...additionalEvidenceIds,
  ]);
  for (const item of allReasoningItems(decision)) {
    if (!item || typeof item.statement !== "string" || !item.statement.trim()) {
      throw new Error("Agent response contains a reasoning item without a statement.");
    }
    if (!Array.isArray(item.surfaced_deviation_ids) || item.surfaced_deviation_ids.length === 0) {
      throw new Error("Every reasoning item must reference a surfaced deviation.");
    }
    if (!Array.isArray(item.cited_facts) || item.cited_facts.length === 0) {
      throw new Error("Every reasoning item must cite factual evidence.");
    }
    for (const id of item.surfaced_deviation_ids) {
      if (!knownDeviationIds.has(id)) throw new Error(`Reasoning references unknown evidence '${id}'.`);
    }
  }

  return decision;
}

function fallbackDecision(surfacedDeviations, systemNote) {
  const ids = surfacedDeviations.map((deviation) => deviation.id);
  const citedFacts = surfacedDeviations.map((deviation) => JSON.stringify(deviation.difference));
  const item = {
    statement: `No model decision was available for the surfaced deviation records: ${ids.join(", ")}.`,
    surfaced_deviation_ids: ids.length > 0 ? ids : ["no-surfaced-deviation"],
    cited_facts: citedFacts.length > 0 ? citedFacts : ["No surfaced deviation records were supplied."],
  };

  return {
    decision: "continue_monitoring",
    confidence: "low",
    interpretation: [item],
    plausible_explanations: [item],
    uncertainty_assessment: [item],
    reasoning: [item],
    immediate_action: "No autonomous intervention was sent because a model decision was unavailable.",
    follow_up_action: "Retry the agent decision when the model service is available.",
    caregiver_summary: "No caregiver notification was sent because the agent decision service was unavailable.",
    escalation_flag: false,
    system_note: systemNote,
    fallback: true,
  };
}

async function requestModelDecision(context, retry) {
  requireConfiguredModel();
  const response = await getClient().responses.create({
    model: process.env.OPENAI_MODEL,
    reasoning: { effort: "medium" },
    instructions: buildInstructions(retry),
    input: JSON.stringify(context),
    text: {
      format: {
        type: "json_schema",
        name: "elderly_safety_agent_decision",
        strict: true,
        schema: decisionSchema,
      },
    },
  });

  if (!response.output_text) throw new Error("Model returned no text output.");
  return JSON.parse(response.output_text);
}

/**
 * Requests a decision from the model. A single schema/validation retry protects the
 * demo against malformed output. Supplying requestDecision is used only by tests.
 */
export async function makeAgentDecision(deviationPayload, priorDecisions = [], { requestDecision = requestModelDecision } = {}) {
  const context = assembleAgentContext(deviationPayload, priorDecisions);
  let lastError;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const decision = await requestDecision(context, attempt === 1);
      return {
        ...validateAgentDecision(
          decision,
          deviationPayload.surfaced_deviations,
          deviationPayload.direct_user_message ? [deviationPayload.direct_user_message.id] : [],
        ),
        fallback: false,
        model: process.env.OPENAI_MODEL,
      };
    } catch (error) {
      lastError = error;
      console.warn(`Agent decision attempt ${attempt + 1} failed: ${error.message}`);
    }
  }

  return fallbackDecision(deviationPayload.surfaced_deviations, `Model output fallback: ${lastError.message}`);
}

export function getPriorDecisions(personaId) {
  return memoryByPersona.get(personaId) ?? [];
}

export function recordAgentDecision(personaId, decision, { scenarioId = null, surfacedDeviations = [] } = {}) {
  const decisions = getPriorDecisions(personaId);
  const memoryRecord = {
    decision: decision.decision,
    confidence: decision.confidence,
    escalation_flag: decision.escalation_flag,
    reasoning: decision.reasoning,
    scenario_id: scenarioId,
    surfaced_deviation_ids: surfacedDeviations.map((deviation) => deviation.id),
    created_at: new Date().toISOString(),
  };
  memoryByPersona.set(personaId, [...decisions, memoryRecord].slice(-10));
  return memoryRecord;
}

export function resetAgentMemory(personaId) {
  if (personaId) memoryByPersona.delete(personaId);
  else memoryByPersona.clear();
}
