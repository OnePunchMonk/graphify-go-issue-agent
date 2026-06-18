from __future__ import annotations

from pathlib import Path

from go_issue_agent.core.files import read_text, walk_files


SOURCE_EXTENSIONS = [".go", ".md", ".yaml", ".yml", ".toml", ".json"]
STOP_WORDS = {
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
    "com",
}


def build_repository_map(graph: dict, repo_path: str) -> dict:
    files = {}
    for file in walk_files(repo_path, extensions=SOURCE_EXTENSIONS):
        try:
            content = read_text(Path(repo_path) / file["relativePath"])
        except OSError:
            continue
        files[file["relativePath"]] = {
            "path": file["relativePath"],
            "name": Path(file["relativePath"]).name,
            "bytes": file["size"],
            "symbols": [],
            "tests": [],
            "imports": [],
            "validators": [],
            "headings": [],
            "content": content,
        }

    for node in graph.get("nodes", []):
        path = node.get("path")
        if not path or path not in files:
            continue
        entry = files[path]
        node_type = node["type"]
        if node_type == "function":
            entry["symbols"].append(node["name"])
        elif node_type == "test":
            entry["tests"].append(node["name"])
        elif node_type == "validator-tag":
            entry["validators"].append(node["name"])
        elif node_type == "doc-heading":
            entry["headings"].append(node["name"])

    nodes_by_id = {node["id"]: node for node in graph.get("nodes", [])}
    for edge in graph.get("edges", []):
        if edge["type"] != "imports":
            continue
        source = nodes_by_id.get(edge["source"])
        target = nodes_by_id.get(edge["target"])
        if source and target and source.get("path") in files:
            files[source["path"]]["imports"].append(target["name"])

    return {
        "generatedAt": graph.get("generatedAt"),
        "source": graph.get("source"),
        "files": [
            {
                **file,
                "content": None,
                "preview": _make_preview(file["content"]),
            }
            for file in files.values()
        ],
    }


def search_repository_map(repo_map: dict, query: str, limit: int = 12) -> list[dict]:
    terms = tokenise_search_query(query)
    ranked = []
    for file in repo_map["files"]:
        score = _score_file(file, terms)
        if score <= 0:
            continue
        ranked.append(
            {
                "path": file["path"],
                "score": round(score, 2),
                "matchedTerms": _matched_terms(file, terms)[:20],
                "symbols": file["symbols"][:12],
                "tests": file["tests"][:8],
                "validators": file["validators"][:8],
                "preview": file["preview"],
            }
        )
    ranked.sort(key=lambda item: item["score"], reverse=True)
    for index, item in enumerate(ranked[:limit], start=1):
        item["rank"] = index
    return ranked[:limit]


def build_search_query(issue: dict, intent: dict) -> str:
    return "\n".join(
        item
        for item in [
            issue.get("title"),
            issue.get("body"),
            intent.get("observedBehaviour"),
            intent.get("expectedBehaviour"),
            *(intent.get("symbols") or []),
            *(intent.get("candidateFiles") or []),
        ]
        if item
    )


def tokenise_search_query(text: str) -> set[str]:
    terms = set()
    for raw in str(text or "").replace("http://", " ").replace("https://", " ").split():
        token = "".join(ch for ch in raw.lower() if ch.isalnum() or ch in "_./:-")
        if len(token) < 3:
            continue
        for piece in [token, *token.replace(":", "/").split("/"), *token.split("_"), *token.split("."), *token.split("-")]:
            if len(piece) >= 3 and piece not in STOP_WORDS:
                terms.add(piece)
    return terms


def _score_file(file: dict, terms: set[str]) -> int:
    path = file["path"].lower()
    name = file["name"].lower()
    symbol_text = " ".join([*file["symbols"], *file["tests"], *file["validators"], *file["imports"], *file["headings"]]).lower()
    preview = file["preview"].lower()
    score = 0
    for term in terms:
        if term in path:
            score += 10
        if term in name:
            score += 14
        if term in symbol_text:
            score += 18
        if term in preview:
            score += 4
        if file["path"].endswith("_test.go") and term in {"test", "expected", "reproduce", "regression"}:
            score += 2
    return score


def _matched_terms(file: dict, terms: set[str]) -> list[str]:
    haystack = " ".join(
        [
            file["path"],
            file["name"],
            *file["symbols"],
            *file["tests"],
            *file["validators"],
            *file["imports"],
            *file["headings"],
            file["preview"],
        ]
    ).lower()
    return [term for term in terms if term in haystack]


def _make_preview(content: str) -> str:
    lines = [line for line in content.splitlines() if line.strip()]
    return "\n".join(lines[:160])
