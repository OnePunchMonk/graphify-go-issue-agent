export class IntentNormaliserAgent {
  constructor({ model, logger } = {}) {
    this.model = model;
    this.logger = logger;
  }

  async run({ repoFullName, issue }) {
    if (this.model) {
      return await this.fromModel({ repoFullName, issue });
    }
    return heuristicIntent(issue);
  }

  async fromModel({ repoFullName, issue }) {
    const prompt = `Normalize this GitHub issue for an autonomous coding agent.

Repository: ${repoFullName}
Issue #${issue.number}: ${issue.title}

Issue body:
${issue.body}

Return strict JSON with:
{
  "problemType": "bug|feature|test|docs|unknown",
  "observedBehaviour": "string",
  "expectedBehaviour": "string",
  "symbols": ["symbol_or_identifier"],
  "candidateFiles": ["relative/path.go"],
  "acceptanceCriteria": ["criterion"],
  "riskNotes": ["risk"],
  "needsExternalResearch": true
}`;

    return await this.model.generateJson({
      system: "You turn GitHub issues into compact, testable engineering intent records. Do not invent facts.",
      prompt,
      temperature: 0.1
    });
  }
}

export function heuristicIntent(issue) {
  const text = `${issue.title}\n${issue.body ?? ""}`;
  const symbols = extractSymbols(text);
  const candidateFiles = extractCandidateFiles(text, symbols);
  return {
    problemType: inferProblemType(text),
    observedBehaviour: firstMatchingLine(text, /(panic|fails?|wrong|incorrect|accepts?|rejects?|error|bug)/i) ?? issue.title,
    expectedBehaviour: firstMatchingLine(text, /(should|expected|want|must|needs?|instead)/i) ?? "Match the issue's requested behaviour with the smallest compatible change.",
    symbols,
    candidateFiles,
    acceptanceCriteria: [
      "Add or update focused tests that reproduce the issue.",
      "Keep the patch scoped to the repository's existing conventions.",
      "Run targeted tests and the repository standard Go test command."
    ],
    riskNotes: [],
    needsExternalResearch: /(rfc|spec|standard|docs?|go doc|posix|unicode|http)/i.test(text)
  };
}

function inferProblemType(text) {
  if (/(panic|bug|fails?|incorrect|wrong|regression|invalid)/i.test(text)) {
    return "bug";
  }
  if (/(docs?|readme|documentation)/i.test(text)) {
    return "docs";
  }
  if (/(test|coverage)/i.test(text)) {
    return "test";
  }
  if (/(feature|support|add)/i.test(text)) {
    return "feature";
  }
  return "unknown";
}

function extractSymbols(text) {
  const symbols = new Set();
  for (const match of text.matchAll(/`([^`]{2,80})`/g)) {
    const value = match[1].trim();
    if (/^[A-Za-z0-9_./:-]+$/.test(value)) {
      symbols.add(value);
    }
  }
  for (const match of text.matchAll(/\b([A-Za-z][A-Za-z0-9_]*(?:_[A-Za-z0-9]+){1,})\b/g)) {
    symbols.add(match[1]);
  }
  for (const match of text.matchAll(/\b([A-Za-z][A-Za-z0-9_]*\.[A-Za-z][A-Za-z0-9_]*)\b/g)) {
    symbols.add(match[1]);
  }
  return [...symbols].slice(0, 24);
}

function extractCandidateFiles(text, symbols) {
  const files = new Set();
  for (const match of text.matchAll(/\b([A-Za-z0-9_./-]+\.go)\b/g)) {
    files.add(match[1]);
  }
  if (symbols.some((symbol) => /validator|hostname|country|iso3166|rfc1123/i.test(symbol))) {
    files.add("baked_in.go");
    files.add("regexes.go");
    files.add("validator_test.go");
  }
  return [...files].slice(0, 12);
}

function firstMatchingLine(text, pattern) {
  return text.split(/\r?\n/).find((line) => pattern.test(line))?.trim();
}
