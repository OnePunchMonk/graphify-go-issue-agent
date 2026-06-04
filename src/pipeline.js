import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { assertApprovedProject } from "./approved-projects.js";
import { createLogger } from "./core/logger.js";
import { writeJson, writeText } from "./core/files.js";
import { cloneRepository, fetchIssueCached } from "./github/client.js";
import { buildRepositoryGraph } from "./graph/graphify-adapter.js";
import { createModel } from "./providers/gemini.js";
import { IntentNormaliserAgent } from "./agents/intent-normaliser.js";
import { PlannerAgent } from "./agents/planner.js";
import { ResearchAgent } from "./agents/researcher.js";
import { CodeChangeAgent } from "./agents/code-change.js";
import { TesterAgent } from "./agents/tester.js";
import { ReviewerAgent } from "./agents/reviewer.js";
import { computeConfidence } from "./scoring/confidence.js";
import { generatePrDraft } from "./output/pr-draft.js";

export async function solveIssue(options) {
  const logger = createLogger({ verbose: options.verbose });
  const repoFullName = requireOption(options.repo, "--repo");
  const issueNumber = Number(requireOption(options.issue, "--issue"));
  const project = assertApprovedProject(repoFullName);
  const runId = options.runId ?? `${repoFullName.replace("/", "-")}-${issueNumber}-${timestamp()}`;
  const outDir = resolve(options.outDir ?? join("runs", runId));
  const cacheDir = join(outDir, "cache");
  const graphDir = join(outDir, "graph");
  await mkdir(outDir, { recursive: true });

  const model = createModel({ offline: options.offline, logger });
  const repoPath = await prepareRepository({ options, project, repoFullName, runId, logger });
  const issue = await loadIssue({ options, repoFullName, issueNumber, cacheDir });

  logger.info(`Building repository graph for ${repoFullName}`);
  const graph = await buildRepositoryGraph({ repoPath, outDir: graphDir, logger });

  const state = {
    repoFullName,
    project,
    issue,
    repoPath,
    graph,
    options: {
      applyPatch: options.applyPatch !== false,
      runTests: options.runTests !== false,
      stopOnFirstTestFailure: options.stopOnFirstTestFailure ?? false,
      testTimeoutMs: options.testTimeoutMs ?? 300_000
    },
    revisions: []
  };

  const intentAgent = new IntentNormaliserAgent({ model, logger });
  const plannerAgent = new PlannerAgent({ model, logger });
  const researchAgent = new ResearchAgent({ model, logger });
  const codeAgent = new CodeChangeAgent({ model, logger });
  const testerAgent = new TesterAgent({ logger });
  const reviewerAgent = new ReviewerAgent({ model, logger });

  logger.info("Normalising issue intent");
  state.intent = await intentAgent.run(state);
  await writeJson(join(outDir, "intent.json"), state.intent);

  logger.info("Planning patch from graph-ranked context");
  state.plan = await plannerAgent.run(state);
  await writeJson(join(outDir, "plan.json"), state.plan);

  logger.info("Collecting repository and standards research");
  state.research = await researchAgent.run(state);
  await writeJson(join(outDir, "research.json"), state.research);

  const maxIterations = Number(options.maxIterations ?? 3);
  const threshold = Number(options.threshold ?? 0.8);
  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    logger.info(`Code/test/review iteration ${iteration}/${maxIterations}`);
    state.proposal = await codeAgent.run(state, iteration);
    await writeJson(join(outDir, `proposal-${iteration}.json`), state.proposal);

    state.testResult = await testerAgent.run(state);
    await writeJson(join(outDir, `test-result-${iteration}.json`), state.testResult);

    state.review = await reviewerAgent.run(state, iteration);
    state.confidence = computeConfidence({
      review: state.review,
      testResult: state.testResult,
      proposal: state.proposal,
      plan: state.plan
    });
    await writeJson(join(outDir, `review-${iteration}.json`), {
      review: state.review,
      confidence: state.confidence
    });

    if (state.confidence.confidence >= threshold && state.review.decision === "approve") {
      break;
    }

    state.revisions.push({
      iteration,
      review: state.review,
      confidence: state.confidence
    });

    if (!model) {
      break;
    }
  }

  state.prDraft = generatePrDraft(state);
  await writeText(join(outDir, "PR_DRAFT.md"), renderPrDraft(state.prDraft));
  await writeJson(join(outDir, "state.json"), serialiseState(state));
  return {
    state,
    outDir,
    repoPath
  };
}

async function prepareRepository({ options, project, repoFullName, runId, logger }) {
  if (options.repoPath) {
    const repoPath = resolve(options.repoPath);
    if (!existsSync(repoPath)) {
      throw new Error(`--repo-path does not exist: ${repoPath}`);
    }
    return repoPath;
  }

  const workdir = resolve(options.workdir ?? "workspaces");
  const repoPath = join(workdir, runId, repoFullName.split("/")[1]);
  await cloneRepository({
    cloneUrl: project.cloneUrl,
    repoPath,
    branch: options.branch ?? project.defaultBranch,
    logger
  });
  return repoPath;
}

async function loadIssue({ options, repoFullName, issueNumber, cacheDir }) {
  if (options.issueFile) {
    const issue = JSON.parse(await readFile(resolve(options.issueFile), "utf8"));
    return {
      number: issue.number ?? issueNumber,
      title: issue.title,
      body: issue.body ?? "",
      url: issue.url,
      labels: issue.labels ?? [],
      author: issue.author
    };
  }
  return await fetchIssueCached(repoFullName, issueNumber, cacheDir);
}

function requireOption(value, name) {
  if (value == null || value === "") {
    throw new Error(`Missing required option ${name}`);
  }
  return value;
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function renderPrDraft(draft) {
  return `# ${draft.title}\n\n${draft.body}\n`;
}

function serialiseState(state) {
  return {
    repoFullName: state.repoFullName,
    issue: state.issue,
    repoPath: state.repoPath,
    intent: state.intent,
    plan: state.plan,
    research: state.research,
    proposal: state.proposal,
    testResult: state.testResult,
    review: state.review,
    confidence: state.confidence,
    revisions: state.revisions,
    prDraft: state.prDraft
  };
}
