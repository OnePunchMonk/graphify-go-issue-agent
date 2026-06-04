import { retrieveIssueContext } from "../graph/retriever.js";

export class PlannerAgent {
  constructor({ model, logger } = {}) {
    this.model = model;
    this.logger = logger;
  }

  async run(state) {
    const context = await retrieveIssueContext({
      graph: state.graph,
      repoPath: state.repoPath,
      issue: state.issue,
      intent: state.intent
    });

    if (this.model) {
      const plan = await this.fromModel(state, context);
      return { ...plan, context };
    }

    return heuristicPlan(state, context);
  }

  async fromModel(state, context) {
    const prompt = `Plan a small production-quality fix for this Go repository issue.

Repository: ${state.repoFullName}
Issue: #${state.issue.number} ${state.issue.title}
Intent:
${JSON.stringify(state.intent, null, 2)}

Graph-ranked context:
${JSON.stringify(context.graphNodes.slice(0, 20), null, 2)}

File excerpts:
${context.snippets.map((snippet) => `--- ${snippet.path}\n${snippet.excerpt}`).join("\n\n")}

Return strict JSON:
{
  "summary": "one sentence",
  "filesToEdit": ["relative/path.go"],
  "testsToEdit": ["relative/path_test.go"],
  "targetedCommands": ["go test -run TestName ./..."],
  "standardCommands": ["go test ./..."],
  "patchBudget": {"maxFiles": 3, "maxLinesChanged": 120},
  "risks": ["risk"],
  "reviewChecklist": ["check"]
}`;

    return await this.model.generateJson({
      system: "You are a conservative Go maintainer. Prefer minimal behavioral patches and focused tests.",
      prompt,
      temperature: 0.15
    });
  }
}

export function heuristicPlan(state, context) {
  const project = state.project;
  const files = new Set([
    ...(state.intent.candidateFiles ?? []),
    ...context.files.slice(0, 4).map((file) => file.path)
  ]);

  const tests = [...files].filter((file) => file.endsWith("_test.go"));
  if (!tests.length) {
    const likelyTest = context.files.find((file) => file.path.endsWith("_test.go"))?.path;
    if (likelyTest) {
      tests.push(likelyTest);
    } else if (state.repoFullName === "go-playground/validator") {
      tests.push("validator_test.go");
    }
  }

  return {
    summary: `Fix ${state.issue.title} with a small code change and focused tests.`,
    filesToEdit: [...files].filter((file) => !file.endsWith("_test.go")).slice(0, 4),
    testsToEdit: tests.slice(0, 3),
    targetedCommands: inferTargetedCommands(state),
    standardCommands: project.standardChecks,
    patchBudget: {
      maxFiles: 3,
      maxLinesChanged: 120
    },
    risks: [
      ...(project.riskNotes ?? []),
      ...state.intent.riskNotes
    ],
    reviewChecklist: [
      "Patch is limited to issue-related behavior.",
      "Tests cover the reported case and a nearby valid case.",
      "No exported API changes unless the issue requires them.",
      "No avoidable work added to hot paths."
    ],
    context
  };
}

function inferTargetedCommands(state) {
  const testSymbols = (state.intent.symbols ?? [])
    .filter((symbol) => /^test/i.test(symbol))
    .map((symbol) => symbol.replace(/[^A-Za-z0-9_]/g, ""));
  if (testSymbols.length) {
    return [`go test -run ${testSymbols[0]} ./...`];
  }

  const titleWords = state.issue.title
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word.length >= 5)
    .slice(0, 3)
    .join("|");
  return titleWords ? [`go test -run '${titleWords}' ./...`] : ["go test ./..."];
}
