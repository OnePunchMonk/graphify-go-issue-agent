import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { runCommand } from "../core/shell.js";
import { writeJson, writeText } from "../core/files.js";
import { renderGraphReport } from "./graph.js";
import { buildGoGraph } from "./go-builder.js";

export async function buildRepositoryGraph({ repoPath, outDir, logger }) {
  await mkdir(outDir, { recursive: true });
  const existing = await readExistingGraph(repoPath);
  if (existing) {
    logger?.info("Using existing Graphify graph artifact from repository.");
    await persistGraph(outDir, existing);
    return existing;
  }

  const graphifyGraph = await tryGraphifyCli({ repoPath, outDir, logger });
  if (graphifyGraph) {
    return graphifyGraph;
  }

  logger?.info("Graphify CLI unavailable or failed; building deterministic Go graph fallback.");
  const graph = await buildGoGraph(repoPath);
  await persistGraph(outDir, graph);
  return graph;
}

async function readExistingGraph(repoPath) {
  const candidates = [
    join(repoPath, "graphify-out", "graph.json"),
    join(repoPath, "graph.json")
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return JSON.parse(await readFile(candidate, "utf8"));
    }
  }
  return null;
}

async function tryGraphifyCli({ repoPath, outDir, logger }) {
  const command = process.env.GRAPHIFY_CMD ?? "graphify";
  const attempts = [
    [repoPath, "--out", outDir, "--no-viz"],
    [repoPath, "--output", outDir, "--no-viz"],
    [repoPath, "--no-viz"]
  ];

  for (const args of attempts) {
    const result = await runCommand(command, args, {
      allowFailure: true,
      timeoutMs: 300_000
    }).catch((error) => ({
      ok: false,
      stderr: error.message
    }));

    if (!result.ok) {
      logger?.debug(`Graphify attempt failed: ${command} ${args.join(" ")} ${result.stderr ?? ""}`);
      continue;
    }

    const graphPath = findGraphifyOutput(repoPath, outDir);
    if (graphPath) {
      const graph = JSON.parse(await readFile(graphPath, "utf8"));
      graph.source = graph.source ?? "graphify-cli";
      await persistGraph(outDir, graph);
      return graph;
    }
  }

  return null;
}

function findGraphifyOutput(repoPath, outDir) {
  const candidates = [
    join(outDir, "graph.json"),
    join(repoPath, "graphify-out", "graph.json"),
    join(repoPath, "graph.json")
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

async function persistGraph(outDir, graph) {
  await writeJson(join(outDir, "graph.json"), graph);
  const report = graph.report ?? renderGraphReport(graph);
  await writeText(join(outDir, "GRAPH_REPORT.md"), report);
}
