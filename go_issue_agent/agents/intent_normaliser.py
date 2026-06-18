from __future__ import annotations

import re


class IntentNormaliserAgent:
    def __init__(self, model=None, logger=None):
        self.model = model
        self.logger = logger

    def run(self, repo_full_name: str, issue: dict) -> dict:
        if self.model:
            return self.from_model(repo_full_name, issue)
        return heuristic_intent(issue)

    def from_model(self, repo_full_name: str, issue: dict) -> dict:
        prompt = f"""Normalize this GitHub issue for an autonomous coding agent.

Repository: {repo_full_name}
Issue #{issue["number"]}: {issue["title"]}

Issue body:
{issue.get("body", "")}

Return strict JSON with:
{{
  "problemType": "bug|feature|test|docs|unknown",
  "observedBehaviour": "string",
  "expectedBehaviour": "string",
  "symbols": ["symbol_or_identifier"],
  "candidateFiles": ["relative/path.go"],
  "acceptanceCriteria": ["criterion"],
  "riskNotes": ["risk"],
  "needsExternalResearch": true
}}"""
        return self.model.generate_json(
            system="You turn GitHub issues into compact, testable engineering intent records. Do not invent facts.",
            prompt=prompt,
            temperature=0.1,
        )


def heuristic_intent(issue: dict) -> dict:
    text = f'{issue.get("title", "")}\n{issue.get("body", "")}'
    symbols = _extract_symbols(text)
    candidate_files = _extract_candidate_files(text, symbols)
    return {
        "problemType": _infer_problem_type(text),
        "observedBehaviour": _first_matching_line(text, r"(panic|fails?|wrong|incorrect|accepts?|rejects?|error|bug)") or issue.get("title", ""),
        "expectedBehaviour": _first_matching_line(text, r"(should|expected|want|must|needs?|instead)") or "Match the issue's requested behaviour with the smallest compatible change.",
        "symbols": symbols,
        "candidateFiles": candidate_files,
        "acceptanceCriteria": [
            "Add or update focused tests that reproduce the issue.",
            "Keep the patch scoped to the repository's existing conventions.",
            "Run targeted tests and the repository standard Go test command.",
        ],
        "riskNotes": [],
        "needsExternalResearch": bool(re.search(r"(rfc|spec|standard|docs?|go doc|posix|unicode|http)", text, re.IGNORECASE)),
    }


def _infer_problem_type(text: str) -> str:
    if re.search(r"(panic|bug|fails?|incorrect|wrong|regression|invalid)", text, re.IGNORECASE):
        return "bug"
    if re.search(r"(docs?|readme|documentation)", text, re.IGNORECASE):
        return "docs"
    if re.search(r"(test|coverage)", text, re.IGNORECASE):
        return "test"
    if re.search(r"(feature|support|add)", text, re.IGNORECASE):
        return "feature"
    return "unknown"


def _extract_symbols(text: str) -> list[str]:
    symbols = []
    seen = set()
    for match in re.finditer(r"`([^`]{2,80})`", text):
        value = match.group(1).strip()
        if re.match(r"^[A-Za-z0-9_./:-]+$", value) and value not in seen:
            symbols.append(value)
            seen.add(value)
    for pattern in [r"\b([A-Za-z][A-Za-z0-9_]*(?:_[A-Za-z0-9]+){1,})\b", r"\b([A-Za-z][A-Za-z0-9_]*\.[A-Za-z][A-Za-z0-9_]*)\b"]:
        for match in re.finditer(pattern, text):
            value = match.group(1)
            if value not in seen:
                symbols.append(value)
                seen.add(value)
    return symbols[:24]


def _extract_candidate_files(text: str, symbols: list[str]) -> list[str]:
    files = []
    seen = set()
    for match in re.finditer(r"\b([A-Za-z0-9_./-]+\.go)\b", text):
        value = match.group(1)
        if value not in seen:
            files.append(value)
            seen.add(value)
    if any(re.search(r"(validator|hostname|country|iso3166|rfc1123)", symbol, re.IGNORECASE) for symbol in symbols):
        for value in ["baked_in.go", "regexes.go", "validator_test.go"]:
            if value not in seen:
                files.append(value)
                seen.add(value)
    return files[:12]


def _first_matching_line(text: str, pattern: str) -> str | None:
    regex = re.compile(pattern, re.IGNORECASE)
    for line in text.splitlines():
        if regex.search(line):
            return line.strip()
    return None
