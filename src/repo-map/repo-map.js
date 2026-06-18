import { basename, join } from "node:path";
import { readText, walkFiles } from "../core/files.js";

const SOURCE_EXTENSIONS = [
  ".go",
  ".md",
  ".yaml",
  ".yml",
  ".toml",
  ".json"
];

export async function buildRepositoryMap({ graph, repoPath }) {
  const files = new Map();
  for (const file of walkFiles(repoPath, { extensions: SOURCE_EXTENSIONS })) {
    const content = await safeRead(join(repoPath, file.relativePath));
    if (!content) {
      continue;
    }
    files.set(file.relativePath, {
      path: file.relativePath,
      name: basename(file.relativePath),
      bytes: file.size,
      symbols: [],
      tests: [],
      imports: [],
      validators: [],
      headings: [],
      content
    });
  }

  for (const node of graph.nodes ?? []) {
    if (!node.path || !files.has(node.path)) {
      continue;
    }
    const entry = files.get(node.path);
    if (node.type === "function") {
      entry.symbols.push(node.name);
    } else if (node.type === "test") {
      entry.tests.push(node.name);
    } else if (node.type === "validator-tag") {
      entry.validators.push(node.name);
    } else if (node.type === "doc-heading") {
      entry.headings.push(node.name);
    }
  }

  for (const edge of graph.edges ?? []) {
    if (edge.type !== "imports") {
      continue;
    }
    const source = graph.nodes?.find((node) => node.id === edge.source);
    const target = graph.nodes?.find((node) => node.id === edge.target);
    if (source?.path && target?.name && files.has(source.path)) {
      files.get(source.path).imports.push(target.name);
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    source: graph.source,
    files: [...files.values()].map((file) => ({
      ...file,
      content: undefined,
      preview: makePreview(file.content)
    }))
  };
}

export function searchRepositoryMap({ repoMap, query, limit = 12 }) {
  const terms = tokeniseSearchQuery(query);
  return repoMap.files
    .map((file) => ({
      file,
      score: scoreFile(file, terms),
      matchedTerms: matchedTerms(file, terms)
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((item, index) => ({
      rank: index + 1,
      path: item.file.path,
      score: Number(item.score.toFixed(2)),
      matchedTerms: item.matchedTerms,
      symbols: item.file.symbols.slice(0, 12),
      tests: item.file.tests.slice(0, 8),
      validators: item.file.validators.slice(0, 8),
      preview: item.file.preview
    }));
}

export function buildSearchQuery({ issue, intent }) {
  return [
    issue.title,
    issue.body,
    intent.observedBehaviour,
    intent.expectedBehaviour,
    ...(intent.symbols ?? []),
    ...(intent.candidateFiles ?? [])
  ].filter(Boolean).join("\n");
}

function scoreFile(file, terms) {
  const path = file.path.toLowerCase();
  const name = file.name.toLowerCase();
  const symbolText = [
    ...file.symbols,
    ...file.tests,
    ...file.validators,
    ...file.imports,
    ...file.headings
  ].join(" ").toLowerCase();
  const preview = file.preview.toLowerCase();
  let score = 0;

  for (const term of terms) {
    if (path.includes(term)) {
      score += 10;
    }
    if (name.includes(term)) {
      score += 14;
    }
    if (symbolText.includes(term)) {
      score += 18;
    }
    if (preview.includes(term)) {
      score += 4;
    }
    if (file.path.endsWith("_test.go") && /test|expected|reproduce|regression/.test(term)) {
      score += 2;
    }
  }

  return score;
}

function matchedTerms(file, terms) {
  const haystack = [
    file.path,
    file.name,
    ...file.symbols,
    ...file.tests,
    ...file.validators,
    ...file.imports,
    ...file.headings,
    file.preview
  ].join(" ").toLowerCase();
  return [...terms].filter((term) => haystack.includes(term)).slice(0, 20);
}

export function tokeniseSearchQuery(text) {
  return new Set(
    String(text ?? "")
      .replace(/https?:\/\/\S+/g, " ")
      .split(/[^A-Za-z0-9_./:-]+/)
      .map((term) => term.trim().toLowerCase())
      .filter((term) => term.length >= 3)
      .flatMap((term) => {
        const pieces = [term];
        pieces.push(...term.split(/[_./:-]+/));
        return pieces;
      })
      .filter((term) => term.length >= 3)
      .filter((term) => !STOP_WORDS.has(term))
  );
}

function makePreview(content) {
  return content
    .split("\n")
    .filter((line) => line.trim())
    .slice(0, 160)
    .join("\n");
}

async function safeRead(path) {
  try {
    return await readText(path);
  } catch {
    return null;
  }
}

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "that",
  "this",
  "with",
  "from",
  "into",
  "when",
  "should",
  "expected",
  "actual",
  "behavior",
  "behaviour",
  "issue",
  "fixes",
  "github",
  "com"
]);
