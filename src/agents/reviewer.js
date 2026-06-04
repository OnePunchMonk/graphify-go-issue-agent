import { getWorkingDiff } from "../patch/git-diff.js";

export class ReviewerAgent {
  constructor({ model, logger } = {}) {
    this.model = model;
    this.logger = logger;
  }

  async run(state, iteration) {
    const workingDiff = await getWorkingDiff(state.repoPath).catch(() => "");
    if (this.model) {
      return await this.fromModel(state, iteration, workingDiff);
    }
    return heuristicReview(state, workingDiff);
  }

  async fromModel(state, iteration, workingDiff) {
    const prompt = `Review this attempted fix as a strict Go maintainer.

Repository: ${state.repoFullName}
Issue: #${state.issue.number} ${state.issue.title}
Iteration: ${iteration}

Intent:
${JSON.stringify(state.intent, null, 2)}

Plan:
${JSON.stringify(stripContext(state.plan), null, 2)}

Test results:
${JSON.stringify(state.testResult, null, 2)}

Diff:
${workingDiff}

Return strict JSON:
{
  "score": 0.0,
  "decision": "approve|needs_changes",
  "findings": [{"severity": "blocker|major|minor", "message": "specific issue"}],
  "missingTests": ["test gap"],
  "confidenceRationale": "evidence-based explanation"
}`;

    return await this.model.generateJson({
      system: "You review code changes for correctness, minimality, convention fit, and test evidence. Be concrete.",
      prompt,
      temperature: 0.1
    });
  }
}

function heuristicReview(state, workingDiff) {
  const findings = [];
  if (!workingDiff.trim()) {
    findings.push({
      severity: "major",
      message: "No code diff has been applied yet."
    });
  }
  if (!state.testResult?.skipped && state.testResult?.results?.some((result) => !result.ok)) {
    findings.push({
      severity: "blocker",
      message: "At least one validation command failed."
    });
  }
  if (state.testResult?.skipped) {
    findings.push({
      severity: "major",
      message: "Validation was skipped."
    });
  }

  const score = findings.some((finding) => finding.severity === "blocker")
    ? 0.25
    : findings.length
      ? 0.45
      : 0.75;

  return {
    score,
    decision: score >= 0.7 ? "approve" : "needs_changes",
    findings,
    missingTests: state.testResult?.skipped ? ["Run targeted and standard tests before PR output."] : [],
    confidenceRationale: "Heuristic review based on diff presence and command results."
  };
}

function stripContext(plan) {
  const { context, ...rest } = plan;
  return rest;
}
