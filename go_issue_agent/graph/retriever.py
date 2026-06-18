from __future__ import annotations

from pathlib import Path

from go_issue_agent.core.files import read_text


def build_issue_query(issue: dict, intent: dict | None = None) -> str:
    intent = intent or {}
    parts = [
        issue.get("title"),
        issue.get("body"),
        intent.get("observedBehaviour"),
        intent.get("expectedBehaviour"),
        *(intent.get("symbols") or []),
        *(intent.get("candidateFiles") or []),
    ]
    return "\n".join(part for part in parts if part)


def retrieve_issue_context(graph: dict, repo_path: str, issue: dict, intent: dict, max_files: int = 8) -> dict:
    query = build_issue_query(issue, intent)
    terms = _tokenise(query)
    scored = _score_nodes(graph, terms)
    file_scores: dict[str, int] = {}

    for item in scored:
        path = item["node"].get("path")
        if path:
            file_scores[path] = file_scores.get(path, 0) + item["score"]

    for file in intent.get("candidateFiles") or []:
        file_scores[file] = file_scores.get(file, 0) + 50

    files = [{"path": path, "score": score} for path, score in sorted(file_scores.items(), key=lambda item: item[1], reverse=True)[:max_files]]
    snippets = []
    for file in files:
        full_path = Path(repo_path) / file["path"]
        if not full_path.exists():
            continue
        content = read_text(full_path)
        snippets.append({"path": file["path"], "score": file["score"], "excerpt": _make_excerpt(content, terms)})

    return {
        "queryTerms": sorted(terms),
        "files": files,
        "snippets": snippets,
        "graphNodes": [
            {
                "id": item["node"]["id"],
                "type": item["node"]["type"],
                "name": item["node"].get("name"),
                "path": item["node"].get("path"),
                "line": item["node"].get("line"),
                "score": item["score"],
            }
            for item in scored[:40]
        ],
    }


def _score_nodes(graph: dict, terms: set[str]) -> list[dict]:
    scored = []
    for node in graph.get("nodes", []):
        haystack = " ".join(
            str(value).lower()
            for value in [
                node.get("id"),
                node.get("type"),
                node.get("name"),
                node.get("path"),
                node.get("metadata"),
            ]
            if value is not None
        )
        score = 0
        for term in terms:
            if len(term) < 2:
                continue
            if term in haystack:
                score += 6 if len(term) > 8 else 3
            if str(node.get("name", "")).lower() == term:
                score += 20
            if term in str(node.get("path", "")).lower():
                score += 5
        if score > 0:
            scored.append({"node": node, "score": score})
    return sorted(scored, key=lambda item: item["score"], reverse=True)


def _tokenise(text: str) -> set[str]:
    terms = set()
    for raw in text.replace("http://", " ").replace("https://", " ").split():
        for part in raw.replace("\n", " ").split():
            for piece in _split_term(part.lower()):
                cleaned = "".join(ch for ch in piece if ch.isalnum() or ch in "_./-")
                if len(cleaned) >= 3:
                    terms.add(cleaned)
    return terms


def _split_term(term: str) -> list[str]:
    pieces = [term]
    for separator in ["_", "-", "/"]:
        expanded = []
        for piece in pieces:
            expanded.extend(piece.split(separator))
        pieces.extend(expanded)
    return [piece for piece in pieces if len(piece) >= 3]


def _make_excerpt(content: str, terms: set[str]) -> str:
    lines = content.splitlines()
    matching = []
    for index, line in enumerate(lines):
        lower = line.lower()
        if any(term in lower for term in terms):
            matching.append(index)

    selected = set()
    for index in matching[:12]:
        for line in range(max(0, index - 3), min(len(lines) - 1, index + 4) + 1):
            selected.add(line)

    ordered = sorted(selected)
    if not ordered:
        return "\n".join(f"{index + 1}: {line}" for index, line in enumerate(lines[:80]))
    return "\n".join(f"{line + 1}: {lines[line]}" for line in ordered)
