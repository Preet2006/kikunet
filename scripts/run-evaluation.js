import "dotenv/config";
import { runEvaluation } from "../server/evaluation.js";

const report = await runEvaluation();

console.table(report.results.map((result) => ({
  scenario: result.scenario_id,
  expected: result.acceptable_decisions.join(" | "),
  actual: result.actual_decision ?? "(no decision)",
  confidence: result.confidence ?? "-",
  evidence: result.evidence_complete ? "complete" : "incomplete",
  structure: result.structured_output_valid ? "valid" : "invalid",
  recovery: result.recovery_evidence_complete === null
    ? "not required"
    : result.recovery_evidence_complete ? "cited" : "missing",
  verdict: result.verdict,
}))); 
console.log(`Evaluation: ${report.passed}/${report.total} matched.`);

if (report.failed > 0) process.exitCode = 1;
