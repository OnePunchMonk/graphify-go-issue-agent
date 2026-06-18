import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { assertApprovedProject } from "../approved-projects.js";
import { createLogger } from "../core/logger.js";
import { writeJson, writeText } from "../core/files.js";
import { runCommand } from "../core/shell.js";
import { buildRepositoryGraph } from "../graph/graphify-adapter.js";
import { createModel } from "../providers/gemini.js";
import { IntentNormaliserAgent } from "../agents/intent-normaliser.js";
import { PlannerAgent } from "../agents/planner.js";
import { ResearchAgent } from "../agents/researcher.js";
import { buildRepositoryMap, buildSearchQuery, searchRepositoryMap, tokeniseSearchQuery } from "../repo-map/repo-map.js";
import { getBenchmarkCases } from "./suite.js";
import { aggregateScores, scoreFilePredictions } from "./metrics.js";

export async function runBenchmark(options = {}) {
  const logger = createLogger({ verbose: options.verbose });
  const outDir = resolve(options.outDir ?? join("runs", "benchmark", timestamp()));
  const workdir = resolve(options.workdir ?? join("workspaces", "benchmark"));
  const selectedIds = options.cases ? String(options.cases).split(",").map((item) => item.trim()).filter(Boolean) : [];
  const cases = getBenchmarkCases(selectedIds);
  const queryBudget = Number(options.queryBudget ?? 100);
  const model = createModel({ offline: options.offline === true, logger });
  const results = [];
  await mkdir(outDir, { recursive: true });
  await mkdir(workdir, { recursive: true });

  const perCaseQueryCounts = allocateQueryBudget(queryBudget, cases.length);

  for (let index = 0; index < cases.length; index += 1) {
    const benchCase = cases[index];
    logger.info(`Benchmarking ${benchCase.id}`);
    try {
      const result = await runBenchmarkCase({
        benchCase,
        outDir,
        workdir,
        model,
        logger,
        options,
        benchmarkQueryCount: perCaseQueryCounts[index]
      });
      results.push(result);
    } catch (error) {
      logger.warn(`Benchmark case failed: ${benchCase.id}: ${error.message}`);
      results.push({
        id: benchCase.id,
        repo: benchCase.repo,
        issueNumber: benchCase.issueNumber,
        acceptedPr: benchCase.acceptedPr,
        benchmarkQueryCount: perCaseQueryCounts[index],
        status: "failed",
        error: error.message
      });
    }
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    mode: model ? "gemini-assisted-retrieval" : "offline-retrieval",
    queryBudget,
    aggregate: aggregateScores(results),
    results
  };

  await writeJson(join(outDir, "benchmark-results.json"), summary);
  await writeText(join(outDir, "BENCHMARK_REPORT.md"), renderBenchmarkReport(summary));
  return {
    outDir,
    summary
  };
}

async function runBenchmarkCase({ benchCase, outDir, workdir, model, logger, options, benchmarkQueryCount }) {
  const project = assertApprovedProject(benchCase.repo);
  const caseDir = join(outDir, benchCase.id);
  await mkdir(caseDir, { recursive: true });
  const issue = benchmarkIssue(benchCase);
  const repoPath = options.noClone
    ? resolve(options.repoPath)
    : await checkoutBenchmarkRepo({ benchCase, project, workdir, logger });

  const graph = await buildRepositoryGraph({
    repoPath,
    outDir: join(caseDir, "graph"),
    logger
  });
  const repoMap = await buildRepositoryMap({ graph, repoPath });
  await writeJson(join(caseDir, "repo-map.json"), repoMap);

  const intentAgent = new IntentNormaliserAgent({ model, logger });
  const plannerAgent = new PlannerAgent({ model, logger });
  const researchAgent = new ResearchAgent({ model, logger });
  const state = {
    repoFullName: benchCase.repo,
    project,
    issue,
    repoPath,
    graph,
    options: {
      runTests: false,
      applyPatch: false
    },
    revisions: []
  };

  state.intent = await intentAgent.run(state);
  state.research = await researchAgent.run(state);
  state.plan = await plannerAgent.run(state);

  const benchmarkQueries = generateBenchmarkQueries({
    benchCase,
    issue,
    intent: state.intent,
    count: benchmarkQueryCount
  });
  const searchResults = aggregateSearchResults({
    repoMap,
    queries: benchmarkQueries,
    limit: 20
  });

  const predictedFiles = combinePredictions({
    plannerFiles: [
      ...(state.plan.filesToEdit ?? []),
      ...(state.plan.testsToEdit ?? []),
      ...(state.plan.context?.files ?? []).map((file) => file.path)
    ],
    searchResults
  });
  const metrics = scoreFilePredictions({
    predictedFiles,
    acceptedFiles: benchCase.acceptedFiles
  });

  const result = {
    id: benchCase.id,
    repo: benchCase.repo,
    issueNumber: benchCase.issueNumber,
    issueUrl: benchCase.issueUrl,
    acceptedPr: benchCase.acceptedPr,
    acceptedPrUrl: benchCase.acceptedPrUrl,
    difficulty: benchCase.difficulty,
    status: "ok",
    benchmarkQueryCount,
    repoPath,
    acceptedFiles: benchCase.acceptedFiles,
    predictedFiles,
    metrics,
    plan: {
      filesToEdit: state.plan.filesToEdit,
      testsToEdit: state.plan.testsToEdit,
      targetedCommands: state.plan.targetedCommands,
      standardCommands: state.plan.standardCommands
    },
    searchTopFiles: searchResults.slice(0, 8).map((item) => ({
      path: item.path,
      score: item.score,
      matchedTerms: item.matchedTerms
    })),
    benchmarkQueries,
    research: state.research,
    expectedCommands: benchCase.expectedCommands,
    notes: benchCase.notes
  };

  await writeJson(join(caseDir, "result.json"), result);
  await writeFile(join(caseDir, "issue.json"), JSON.stringify(issue, null, 2));
  return result;
}

async function checkoutBenchmarkRepo({ benchCase, project, workdir, logger }) {
  const repoName = benchCase.repo.replace("/", "__");
  const repoPath = join(workdir, `${repoName}-${benchCase.baseSha.slice(0, 12)}`);
  if (existsSync(join(repoPath, ".git"))) {
    const head = await runCommand("git", ["rev-parse", "--verify", "HEAD"], {
      cwd: repoPath,
      allowFailure: true,
      timeoutMs: 30_000
    });
    if (head.ok) {
      logger.debug(`Using cached benchmark repo ${repoPath}`);
      return repoPath;
    }
    logger.debug(`Benchmark repo cache has no HEAD, refetching ${repoPath}`);
  } else {
    await mkdir(repoPath, { recursive: true });
    await runCommand("git", ["init"], { cwd: repoPath, timeoutMs: 60_000 });
    await runCommand("git", ["remote", "add", "origin", project.cloneUrl], {
      cwd: repoPath,
      timeoutMs: 60_000
    });
  }

  await runCommand("git", ["-c", "protocol.version=2", "fetch", "--depth", "1", "origin", benchCase.baseSha], {
    cwd: repoPath,
    timeoutMs: 300_000
  });
  await runCommand("git", ["checkout", "--detach", "FETCH_HEAD"], {
    cwd: repoPath,
    timeoutMs: 60_000
  });
  return repoPath;
}

function combinePredictions({ plannerFiles, searchResults }) {
  const ordered = [];
  for (const file of plannerFiles) {
    pushUnique(ordered, file);
  }
  for (const item of searchResults) {
    pushUnique(ordered, item.path);
  }
  return ordered.filter(Boolean);
}

function pushUnique(values, value) {
  if (value && !values.includes(value)) {
    values.push(value);
  }
}

function benchmarkIssue(benchCase) {
  return {
    number: benchCase.issueNumber,
    title: benchCase.title,
    body: benchCase.body,
    url: benchCase.issueUrl,
    labels: [],
    author: null
  };
}

function renderBenchmarkReport(summary) {
  const lines = [
    "# Benchmark Report",
    "",
    `Generated: ${summary.generatedAt}`,
    `Mode: ${summary.mode}`,
    `Query budget: ${summary.queryBudget}`,
    "",
    "## Aggregate",
    "",
    `- Cases: ${summary.aggregate.completed}/${summary.aggregate.total} completed`,
    `- Hit@1: ${summary.aggregate.hitAt1}/${summary.aggregate.completed}`,
    `- Hit@5: ${summary.aggregate.hitAt5}/${summary.aggregate.completed}`,
    `- Avg recall@5: ${summary.aggregate.avgRecallAt5}`,
    `- Avg recall@10: ${summary.aggregate.avgRecallAt10}`,
    `- Avg precision@5: ${summary.aggregate.avgPrecisionAt5}`,
    `- Avg MRR: ${summary.aggregate.avgMrr}`,
    "",
    "## Cases",
    ""
  ];

  for (const result of summary.results) {
    lines.push(`### ${result.id}`);
    lines.push("");
    lines.push(`- Repo: ${result.repo}`);
    lines.push(`- Issue: #${result.issueNumber}`);
    lines.push(`- Accepted PR: #${result.acceptedPr}`);
    lines.push(`- Status: ${result.status}`);
    lines.push(`- Benchmark queries: ${result.benchmarkQueryCount ?? 0}`);
    if (result.status !== "ok") {
      lines.push(`- Error: ${result.error}`);
      lines.push("");
      continue;
    }
    lines.push(`- Accepted files: ${result.acceptedFiles.map((file) => `\`${file}\``).join(", ")}`);
    lines.push(`- Predicted files: ${result.predictedFiles.slice(0, 8).map((file) => `\`${file}\``).join(", ")}`);
    lines.push(`- Recall@5: ${result.metrics.recallAt5}`);
    lines.push(`- Precision@5: ${result.metrics.precisionAt5}`);
    lines.push(`- MRR: ${result.metrics.mrr}`);
    lines.push(`- Targeted validation: ${result.plan.targetedCommands.join("; ")}`);
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function allocateQueryBudget(total, caseCount) {
  if (caseCount <= 0) {
    return [];
  }
  const base = Math.floor(total / caseCount);
  const remainder = total % caseCount;
  return Array.from({ length: caseCount }, (_, index) => base + (index < remainder ? 1 : 0));
}

function generateBenchmarkQueries({ benchCase, issue, intent, count }) {
  const queries = [];
  const base = buildSearchQuery({ issue, intent });
  const issueText = `${issue.title}\n${issue.body}`;
  const symbols = unique([...(intent.symbols ?? []), ...extractBacktickTerms(issueText)]);
  const tokens = [...tokeniseSearchQuery(base)].filter((token) => token.length >= 4);

  pushQuery(queries, base);
  pushQuery(queries, issue.title);
  pushQuery(queries, intent.observedBehaviour);
  pushQuery(queries, intent.expectedBehaviour);
  pushQuery(queries, symbols.join(" "));
  pushQuery(queries, `${issue.title}\n${symbols.join(" ")}`);
  pushQuery(queries, `${issue.title}\n${(intent.candidateFiles ?? []).join(" ")}`);
  pushQuery(queries, `${benchCase.repo}\n${issue.title}`);

  for (const symbol of symbols) {
    pushQuery(queries, symbol);
    pushQuery(queries, `${issue.title}\n${symbol}`);
  }

  for (const token of tokens.slice(0, 30)) {
    pushQuery(queries, token);
  }

  for (let index = 0; index < tokens.length - 1; index += 1) {
    pushQuery(queries, `${tokens[index]} ${tokens[index + 1]}`);
  }

  for (let index = 0; index < tokens.length - 2; index += 2) {
    pushQuery(queries, `${tokens[index]} ${tokens[index + 1]} ${tokens[index + 2]}`);
  }

  if (queries.length < count) {
    for (let width = 4; width <= 6 && queries.length < count; width += 1) {
      for (let index = 0; index + width <= tokens.length && queries.length < count; index += 1) {
        pushQuery(queries, tokens.slice(index, index + width).join(" "));
      }
    }
  }

  while (queries.length < count) {
    pushQuery(queries, `${issue.title}\n${tokens.slice(0, Math.min(tokens.length, 6 + queries.length)).join(" ")}`);
    if (queries.length >= count) {
      break;
    }
    pushQuery(queries, `${benchCase.repo}\n${symbols.slice(0, 6).join(" ")}\n${tokens.slice(-6).join(" ")}`);
  }

  return queries.slice(0, count);
}

function aggregateSearchResults({ repoMap, queries, limit }) {
  const scores = new Map();
  for (const query of queries) {
    const results = searchRepositoryMap({ repoMap, query, limit });
    for (const result of results) {
      const current = scores.get(result.path) ?? {
        path: result.path,
        score: 0,
        matchedTerms: new Set()
      };
      current.score += result.score;
      for (const term of result.matchedTerms ?? []) {
        current.matchedTerms.add(term);
      }
      scores.set(result.path, current);
    }
  }

  return [...scores.values()]
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((item) => ({
      path: item.path,
      score: Number(item.score.toFixed(2)),
      matchedTerms: [...item.matchedTerms].slice(0, 20)
    }));
}

function extractBacktickTerms(text) {
  const terms = [];
  for (const match of text.matchAll(/`([^`]{2,120})`/g)) {
    const value = match[1].trim();
    if (value) {
      terms.push(value);
    }
  }
  return terms;
}

function pushQuery(queries, query) {
  const cleaned = String(query ?? "").trim();
  if (cleaned && !queries.includes(cleaned)) {
    queries.push(cleaned);
  }
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}
