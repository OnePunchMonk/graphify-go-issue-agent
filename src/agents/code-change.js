import { applyUnifiedDiff, getWorkingDiff } from "../patch/git-diff.js";

export class CodeChangeAgent {
  constructor({ model, logger } = {}) {
    this.model = model;
    this.logger = logger;
  }

  async run(state, iteration) {
    if (!this.model) {
      return offlineProposal(state, iteration);
    }

    const proposal = await this.fromModel(state, iteration);
    if (!proposal.diff?.trim()) {
      throw new Error("CodeChangeAgent returned no diff");
    }
    if (state.options.applyPatch !== false) {
      await applyUnifiedDiff(state.repoPath, proposal.diff);
      proposal.applied = true;
      proposal.workingDiff = await getWorkingDiff(state.repoPath);
    }
    return proposal;
  }

  async fromModel(state, iteration) {
    const prompt = `Generate a minimal unified diff for this Go issue.

Repository: ${state.repoFullName}
Issue: #${state.issue.number} ${state.issue.title}
Iteration: ${iteration}

Intent:
${JSON.stringify(state.intent, null, 2)}

Plan:
${JSON.stringify(stripContext(state.plan), null, 2)}

Research:
${JSON.stringify(state.research, null, 2)}

Context snippets:
${state.plan.context.snippets.map((snippet) => `--- ${snippet.path}\n${snippet.excerpt}`).join("\n\n")}

Previous reviewer feedback:
${JSON.stringify(state.revisions ?? [], null, 2)}

Return strict JSON:
{
  "rationale": "short explanation",
  "diff": "unified diff suitable for git apply",
  "changedFiles": ["relative/path.go"],
  "expectedTests": ["command"]
}

Constraints:
- Prefer one small behavioral patch plus focused tests.
- Follow existing file conventions.
- Do not include markdown fences in the diff string.
- Do not change unrelated formatting.`;

    return await this.model.generateJson({
      system: "You are a production Go code generation agent. Output only JSON matching the requested contract.",
      prompt,
      temperature: 0.2
    });
  }
}

function offlineProposal(state, iteration) {
  return {
    rationale: "Offline mode cannot safely author a production patch; generated plan and context are ready for Gemini-backed code generation.",
    diff: "",
    changedFiles: [],
    expectedTests: state.plan.targetedCommands,
    applied: false,
    iteration
  };
}

function stripContext(plan) {
  const { context, ...rest } = plan;
  return rest;
}
