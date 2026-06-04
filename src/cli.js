import { resolve } from "node:path";
import { buildRepositoryGraph } from "./graph/graphify-adapter.js";
import { solveIssue } from "./pipeline.js";
import { createLogger } from "./core/logger.js";
import { assertApprovedProject, APPROVED_PROJECTS } from "./approved-projects.js";

export async function main(argv) {
  const [command, ...rest] = argv;
  if (!command || command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  const options = parseArgs(rest);
  if (command === "solve") {
    const result = await solveIssue(options);
    console.log(`Run artifacts: ${result.outDir}`);
    console.log(`Repository: ${result.repoPath}`);
    console.log(`Confidence: ${result.state.confidence?.confidence ?? "n/a"}`);
    console.log(`PR draft title: ${result.state.prDraft.title}`);
    return;
  }

  if (command === "graph") {
    const repoPath = resolve(requireOption(options.repoPath, "--repo-path"));
    const outDir = resolve(options.outDir ?? "runs/graph");
    const logger = createLogger({ verbose: options.verbose });
    await buildRepositoryGraph({ repoPath, outDir, logger });
    console.log(`Graph artifacts: ${outDir}`);
    return;
  }

  if (command === "approved") {
    for (const repo of APPROVED_PROJECTS.keys()) {
      console.log(repo);
    }
    return;
  }

  if (command === "check-repo") {
    assertApprovedProject(requireOption(options.repo, "--repo"));
    console.log("approved");
    return;
  }

  throw new Error(`Unknown command "${command}". Run "go-issue-agent help".`);
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${arg}`);
    }
    const [key, inlineValue] = arg.slice(2).split("=", 2);
    const value = inlineValue ?? args[index + 1];
    const boolKeys = new Set([
      "offline",
      "verbose",
      "no-apply",
      "no-tests",
      "stop-on-first-test-failure"
    ]);
    if (boolKeys.has(key)) {
      options[toCamel(key)] = true;
      if (inlineValue == null && args[index + 1] && !args[index + 1].startsWith("--")) {
        index += 1;
      }
      continue;
    }
    if (value == null || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }
    options[toCamel(key)] = value;
    if (inlineValue == null) {
      index += 1;
    }
  }

  if (options.noApply) {
    options.applyPatch = false;
  }
  if (options.noTests) {
    options.runTests = false;
  }
  if (options.stopOnFirstTestFailure) {
    options.stopOnFirstTestFailure = true;
  }
  return options;
}

function toCamel(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function requireOption(value, name) {
  if (!value) {
    throw new Error(`Missing required option ${name}`);
  }
  return value;
}

function printHelp() {
  console.log(`go-issue-agent

Commands:
  solve       Run the full issue-solving loop
  graph       Build graph artifacts for a local repo
  approved    List approved repositories
  check-repo  Validate a repository is approved

Examples:
  go-issue-agent solve --repo go-playground/validator --issue 1561 --repo-path ../validator
  go-issue-agent solve --repo go-playground/validator --issue 860 --offline --no-apply --no-tests --issue-file fixtures/issue-860.json --repo-path fixtures/tiny-validator
  go-issue-agent graph --repo-path ../validator --out-dir runs/validator-graph

Important options:
  --repo <owner/name>        One approved GitHub repository
  --issue <number>           Issue number
  --repo-path <path>         Use an existing local checkout
  --issue-file <path>        Use a local issue JSON file
  --workdir <path>           Clone location when --repo-path is omitted
  --out-dir <path>           Run artifact directory
  --offline                  Disable Gemini and use deterministic agents
  --no-apply                 Generate proposal without applying the diff
  --no-tests                 Skip validation commands
  --threshold <0-1>          Review confidence threshold, default 0.8
  --max-iterations <n>       Code/test/review iterations, default 3
`);
}
