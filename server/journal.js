import OpenAI from "openai";
import { getDailyActivity } from "./shared-state.js";

const sentenceSchema = {
  type: "object",
  additionalProperties: false,
  required: ["text", "event_ids"],
  properties: {
    text: { type: "string", minLength: 1 },
    event_ids: { type: "array", minItems: 1, items: { type: "string" } },
  },
};

const journalSchema = {
  type: "object",
  additionalProperties: false,
  required: ["sentences"],
  properties: {
    sentences: { type: "array", minItems: 3, maxItems: 5, items: sentenceSchema },
  },
};

function requireJournalConfig() {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured.");
  if (!process.env.OPENAI_MODEL) throw new Error("OPENAI_MODEL is not configured.");
}

function journalInstructions(retry = false) {
  return `You write a concise end-of-day update for Ananya, Meera Shah's caregiver.

Use only the factual activity-log entries supplied in the input. Do not add symptoms, motives,
locations, medication facts, caregiver actions, outcomes, or a calm/uneventful day unless they
are explicitly in those entries. Do not repeat raw logs or use bullet points. Write a warm,
natural 3-to-5 sentence caregiver summary that a busy person can read quickly. It may explain
what Nia did, but it must not imply that an action succeeded unless the log says so.

Return each sentence separately with one or more event_ids that support it. Every event_id must
come from the supplied activity log, and every sentence must be fully grounded in its cited
entries. Do not mention the IDs in the sentence text. ${retry ? "Your previous response did not satisfy the citation contract. Return only the requested JSON." : ""}`;
}

export function assembleJournalContext(date) {
  const activity = getDailyActivity(date);
  return {
    date,
    activity_log: activity.map((entry) => ({
      id: entry.id,
      type: entry.type,
      occurred_at: entry.occurred_at,
      details: entry.details,
    })),
  };
}

export function validateJournalResponse(response, activity) {
  if (!response || !Array.isArray(response.sentences)) throw new Error("Journal response is missing sentences.");
  if (response.sentences.length < 3 || response.sentences.length > 5) throw new Error("Journal requires 3 to 5 sentences.");
  const knownIds = new Set(activity.map((entry) => entry.id));
  for (const sentence of response.sentences) {
    if (!sentence?.text?.trim()) throw new Error("Journal contains an empty sentence.");
    if (!Array.isArray(sentence.event_ids) || sentence.event_ids.length === 0) throw new Error("Every journal sentence needs evidence.");
    for (const id of sentence.event_ids) if (!knownIds.has(id)) throw new Error(`Journal references unknown event '${id}'.`);
  }
  return response;
}

async function requestJournalModel(context, retry) {
  requireJournalConfig();
  const response = await new OpenAI({ apiKey: process.env.OPENAI_API_KEY }).responses.create({
    model: process.env.OPENAI_MODEL,
    reasoning: { effort: "low" },
    instructions: journalInstructions(retry),
    input: JSON.stringify(context),
    text: {
      format: {
        type: "json_schema",
        name: "caregiver_daily_journal",
        strict: true,
        schema: journalSchema,
      },
    },
  });
  if (!response.output_text) throw new Error("Model returned no journal text.");
  return JSON.parse(response.output_text);
}

function fallbackSentence(entry) {
  const details = entry.details ?? {};
  if (entry.type === "agent_decision") return `An agent review recorded: ${details.caregiver_summary ?? `the decision ${details.decision ?? "was completed"}`}`;
  if (entry.type === "caregiver_escalation") return `Nia asked for caregiver support after Meera shared: “${details.message ?? "a safety concern"}”`;
  return `Meera had a companion check-in about: “${details.message ?? "a recorded concern"}”`;
}

function groundedFallback(activity) {
  const source = activity.slice(-3);
  const sentences = source.map((entry) => ({ text: fallbackSentence(entry), event_ids: [entry.id] }));
  while (sentences.length < 3) {
    const reference = activity[activity.length - 1];
    sentences.push({ text: "This update reflects the care events recorded for Meera today.", event_ids: [reference.id] });
  }
  return { sentences, fallback: true };
}

/** Generates a grounded daily journal. Persistence is intentionally handled by the route. */
export async function generateDailyJournal({ date, requestJournal = requestJournalModel } = {}) {
  const context = assembleJournalContext(date);
  if (context.activity_log.length === 0) return { status: "empty", date, activity_count: 0 };

  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await requestJournal(context, attempt === 1);
      const validated = validateJournalResponse(response, context.activity_log);
      return {
        status: "ready",
        date,
        sentences: validated.sentences,
        activity_count: context.activity_log.length,
        model: process.env.OPENAI_MODEL,
        fallback: false,
      };
    } catch (error) {
      lastError = error;
      console.warn(`Journal generation attempt ${attempt + 1} failed: ${error.message}`);
    }
  }

  return {
    status: "ready",
    date,
    ...groundedFallback(context.activity_log),
    activity_count: context.activity_log.length,
    model: process.env.OPENAI_MODEL,
    system_note: `Model output fallback: ${lastError.message}`,
  };
}
