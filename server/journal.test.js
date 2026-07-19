import test from "node:test";
import assert from "node:assert/strict";
import { generateDailyJournal, validateJournalResponse } from "./journal.js";
import { getSharedState, recordDailyActivity, resetSharedState, saveDailyJournal } from "./shared-state.js";

function addJournalActivity() {
  const decision = recordDailyActivity({ date: "2026-07-19", type: "agent_decision", details: { decision: "navigation_assist", caregiver_summary: "Meera was at Pune Junction after saying she was heading to Indore." } });
  const companion = recordDailyActivity({ date: "2026-07-19", type: "companion_interaction", details: { message: "I am at this station now.", tool_actions: ["escalate_to_caregiver"] } });
  const escalation = recordDailyActivity({ date: "2026-07-19", type: "caregiver_escalation", details: { message: "I am at this station now.", decision: "navigation_assist" } });
  return { decision, companion, escalation };
}

test("daily journal is generated only from cited logged activities", async () => {
  resetSharedState();
  const entries = addJournalActivity();
  const journal = await generateDailyJournal({
    date: "2026-07-19",
    requestJournal: async () => ({
      sentences: [
        { text: "Meera's recorded journey check involved Pune Junction after she had said she was heading to Indore.", event_ids: [entries.decision.id] },
        { text: "She then used Nia to ask for help at the station.", event_ids: [entries.companion.id] },
        { text: "Nia asked the safety agent to guide the next step for that recorded concern.", event_ids: [entries.escalation.id] },
      ],
    }),
  });

  assert.equal(journal.status, "ready");
  assert.equal(journal.sentences.length, 3);
  assert.equal(journal.fallback, false);
  assert.equal(journal.activity_count, 3);
});

test("daily journal rejects a sentence that cites an event outside the activity log", () => {
  const activity = [{ id: "journal-1" }];
  assert.throws(() => validateJournalResponse({ sentences: [{ text: "One.", event_ids: ["journal-2"] }, { text: "Two.", event_ids: ["journal-1"] }, { text: "Three.", event_ids: ["journal-1"] }] }, activity), /unknown event/);
});

test("daily journal reports an empty day without inventing a summary", async () => {
  resetSharedState();
  const journal = await generateDailyJournal({ date: "2026-07-19", requestJournal: async () => { throw new Error("should not be called"); } });
  assert.deepEqual(journal, { status: "empty", date: "2026-07-19", activity_count: 0 });
});

test("a new care event marks the existing journal stale and is included on regeneration", async () => {
  resetSharedState();
  const entries = addJournalActivity();
  saveDailyJournal({
    date: "2026-07-19",
    sentences: [
      { text: "A recorded review took place.", event_ids: [entries.decision.id] },
      { text: "Nia had a recorded check-in with Meera.", event_ids: [entries.companion.id] },
      { text: "A recorded support request was considered.", event_ids: [entries.escalation.id] },
    ],
  });
  const later = recordDailyActivity({ date: "2026-07-19", type: "companion_interaction", details: { message: "I am safely home now.", tool_actions: [] } });

  assert.equal(getSharedState().daily_journal.stale, true);
  const regenerated = await generateDailyJournal({
    date: "2026-07-19",
    requestJournal: async (context) => ({
      sentences: [
        { text: "The earlier review remained part of today's record.", event_ids: [entries.decision.id] },
        { text: "Nia's check-in was also retained in the care picture.", event_ids: [entries.companion.id] },
        { text: "Meera later reported that she was safely home.", event_ids: [later.id] },
      ],
    }),
  });

  assert.equal(regenerated.activity_count, 4);
  assert.ok(regenerated.sentences.some((sentence) => sentence.event_ids.includes(later.id)));
});
