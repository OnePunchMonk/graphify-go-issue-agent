import { join } from "node:path";
import { readText } from "../core/files.js";

export function buildIssueQuery(issue, intent = {}) {
  return [
    issue.title,
    issue.body,
    intent.observedBehaviour,
    intent.expectedBehaviour,
    ...(intent.symbols ?? []),
    ...(intent.candidateFiles ?? [])
  ].filter(Boolean).join("\n");
}

export async function retrieveIssueContext({ graph, repoPath, issue, intent, maxFiles = 8 }) {
  const query = buildIssueQuery(issue, intent);
  const terms = tokenise(query);
  const scored = scoreNodes(graph, terms);
  const fileScores = new Map();

  for (const item of scored) {
    const path = item.node.path;
    if (!path) {
      continue;
    }
    fileScores.set(path, (fileScores.get(path) ?? 0) + item.score);
  }

  for (const file of intent?.candidateFiles ?? []) {
    fileScores.set(file, (fileScores.get(file) ?? 0) + 50);
  }

  const files = [...fileScores.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, maxFiles)
    .map(([path, score]) => ({ path, score }));

  const snippets = [];
  for (const file of files) {
    const content = await safeRead(join(repoPath, file.path));
    if (!content) {
      continue;
    }
    snippets.push({
      path: file.path,
      score: file.score,
      excerpt: makeExcerpt(content, terms)
    });
  }

  return {
    queryTerms: [...terms],
    files,
    snippets,
    graphNodes: scored.slice(0, 40).map(({ node, score }) => ({
      id: node.id,
      type: node.type,
      name: node.name,
      path: node.path,
      line: node.line,
      score
    }))
  };
}

function scoreNodes(graph, terms) {
  const scored = [];
  for (const node of graph.nodes ?? []) {
    const haystack = [
      node.id,
      node.type,
      node.name,
      node.path,
      JSON.stringify(node.metadata ?? {})
    ].filter(Boolean).join(" ").toLowerCase();
    let score = 0;
    for (const term of terms) {
      if (!term || term.length < 2) {
        continue;
      }
      if (haystack.includes(term)) {
        score += term.length > 8 ? 6 : 3;
      }
      if (node.name?.toLowerCase() === term) {
        score += 20;
      }
      if (node.path?.toLowerCase().includes(term)) {
        score += 5;
      }
    }
    if (score > 0) {
      scored.push({ node, score });
    }
  }
  return scored.sort((left, right) => right.score - left.score);
}

function tokenise(text) {
  return new Set(
    String(text ?? "")
      .replace(/https?:\/\/\S+/g, " ")
      .split(/[^A-Za-z0-9_./-]+/)
      .map((term) => term.trim().toLowerCase())
      .filter((term) => term.length >= 3)
      .flatMap((term) => splitTerm(term))
  );
}

function splitTerm(term) {
  const terms = [term];
  if (term.includes("_")) {
    terms.push(...term.split("_"));
  }
  if (term.includes("-")) {
    terms.push(...term.split("-"));
  }
  if (term.includes("/")) {
    terms.push(...term.split("/"));
  }
  return terms.filter((item) => item.length >= 3);
}

function makeExcerpt(content, terms) {
  const lines = content.split("\n");
  const matching = [];
  for (let index = 0; index < lines.length; index += 1) {
    const lower = lines[index].toLowerCase();
    if ([...terms].some((term) => lower.includes(term))) {
      matching.push(index);
    }
  }

  const selected = new Set();
  for (const index of matching.slice(0, 12)) {
    for (let line = Math.max(0, index - 3); line <= Math.min(lines.length - 1, index + 4); line += 1) {
      selected.add(line);
    }
  }

  const ordered = [...selected].sort((left, right) => left - right);
  if (!ordered.length) {
    return lines.slice(0, 80).map((line, index) => `${index + 1}: ${line}`).join("\n");
  }

  return ordered.map((line) => `${line + 1}: ${lines[line]}`).join("\n");
}

async function safeRead(path) {
  try {
    return await readText(path);
  } catch {
    return null;
  }
}
