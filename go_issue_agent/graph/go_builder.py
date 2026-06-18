from __future__ import annotations

import re
from pathlib import Path

from go_issue_agent.core.files import read_text, walk_files
from go_issue_agent.graph.graph import add_edge, add_node, create_graph, make_node_id, render_graph_report


CALL_EXCLUDES = {
    "if",
    "for",
    "switch",
    "return",
    "range",
    "go",
    "defer",
    "select",
    "append",
    "make",
    "new",
    "len",
    "cap",
    "copy",
    "delete",
    "panic",
    "recover",
}


def build_go_graph(repo_root: str) -> dict:
    graph = create_graph(repo_root, source="go-static-fallback")
    files = walk_files(repo_root, extensions=[".go", ".md", ".txt", ".yaml", ".yml"])
    symbols: dict[str, str] = {}

    for file in files:
        content = read_text(file["path"])
        file_id = make_node_id("file", [file["relativePath"]])
        add_node(
            graph,
            {
                "id": file_id,
                "type": "file",
                "name": Path(file["relativePath"]).name,
                "path": file["relativePath"],
                "metadata": {"bytes": file["size"]},
            },
        )
        if file["relativePath"].endswith(".go"):
            _extract_go_file(graph, symbols, file, content, file_id)
        else:
            _extract_doc_file(graph, file, content, file_id)

    _connect_calls(graph, symbols)
    graph["report"] = render_graph_report(graph)
    graph["stats"] = {"files": len(files)}
    return graph


def _extract_doc_file(graph: dict, file: dict, content: str, file_id: str) -> None:
    for match in re.finditer(r"^(#{1,6})\s+(.+)$", content, re.MULTILINE):
        title = match.group(2).strip()
        line = _line_number_at(content, match.start())
        node_id = make_node_id("doc-heading", [file["relativePath"], title])
        add_node(
            graph,
            {
                "id": node_id,
                "type": "doc-heading",
                "name": title,
                "path": file["relativePath"],
                "line": line,
                "metadata": {"level": len(match.group(1))},
            },
        )
        add_edge(graph, {"source": file_id, "target": node_id, "type": "contains"})


def _extract_go_file(graph: dict, symbols: dict[str, str], file: dict, content: str, file_id: str) -> None:
    package_match = re.search(r"^package\s+([A-Za-z_][A-Za-z0-9_]*)", content, re.MULTILINE)
    package_name = package_match.group(1) if package_match else "unknown"
    package_id = make_node_id("package", [package_name])
    add_node(graph, {"id": package_id, "type": "package", "name": package_name, "metadata": {}})
    add_edge(graph, {"source": file_id, "target": package_id, "type": "declares_package"})

    for import_path in _extract_imports(content):
        import_id = make_node_id("import", [import_path])
        add_node(graph, {"id": import_id, "type": "import", "name": import_path, "metadata": {}})
        add_edge(graph, {"source": file_id, "target": import_id, "type": "imports"})

    for match in re.finditer(r"^func\s+(?:\(([^)]*)\)\s*)?([A-Za-z_][A-Za-z0-9_]*)\s*\(", content, re.MULTILINE):
        receiver = _normalise_receiver(match.group(1))
        name = match.group(2)
        line = _line_number_at(content, match.start())
        qualified = f"{receiver}.{name}" if receiver else name
        node_id = make_node_id("function", [file["relativePath"], qualified])
        body = _extract_function_body(content, match.start())
        calls = _extract_calls(body)
        node_type = "test" if file["relativePath"].endswith("_test.go") or name.startswith("Test") else "function"
        add_node(
            graph,
            {
                "id": node_id,
                "type": node_type,
                "name": qualified,
                "path": file["relativePath"],
                "line": line,
                "metadata": {"package": package_name, "receiver": receiver, "calls": calls},
            },
        )
        symbols[name] = node_id
        symbols[qualified] = node_id
        add_edge(graph, {"source": file_id, "target": node_id, "type": "contains"})
        add_edge(graph, {"source": node_id, "target": package_id, "type": "belongs_to"})

    for match in re.finditer(r'^\s*"([^"]+)"\s*:\s*([A-Za-z_][A-Za-z0-9_]*),', content, re.MULTILINE):
        tag = match.group(1)
        implementation = match.group(2)
        if not _looks_like_validator_tag(tag):
            continue
        tag_id = make_node_id("validator-tag", [tag])
        add_node(
            graph,
            {
                "id": tag_id,
                "type": "validator-tag",
                "name": tag,
                "path": file["relativePath"],
                "line": _line_number_at(content, match.start()),
                "metadata": {"implementation": implementation},
            },
        )
        add_edge(graph, {"source": file_id, "target": tag_id, "type": "contains"})
        add_edge(graph, {"source": tag_id, "target": make_node_id("symbol-ref", [implementation]), "type": "implemented_by"})

    for match in re.finditer(r"^var\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*regexp\.MustCompile\(", content, re.MULTILINE):
        regex_id = make_node_id("regex", [match.group(1)])
        add_node(
            graph,
            {
                "id": regex_id,
                "type": "regex",
                "name": match.group(1),
                "path": file["relativePath"],
                "line": _line_number_at(content, match.start()),
                "metadata": {},
            },
        )
        add_edge(graph, {"source": file_id, "target": regex_id, "type": "contains"})


def _connect_calls(graph: dict, symbols: dict[str, str]) -> None:
    callable_nodes = [node for node in graph["nodes"] if node.get("metadata", {}).get("calls")]
    for node in callable_nodes:
        for call in node["metadata"]["calls"]:
            target = symbols.get(call)
            if target:
                add_edge(graph, {"source": node["id"], "target": target, "type": "calls"})

    for edge in [item for item in graph["edges"] if item["type"] == "implemented_by"]:
        symbol = edge["target"].replace("symbol-ref:", "", 1)
        target = symbols.get(symbol)
        if target:
            edge["target"] = target
        else:
            add_node(graph, {"id": edge["target"], "type": "symbol-ref", "name": symbol, "metadata": {}})


def _extract_imports(content: str) -> list[str]:
    imports = set()
    block = re.search(r"import\s*\(([\s\S]*?)\)", content, re.MULTILINE)
    if block:
        for match in re.finditer(r'"([^"]+)"', block.group(1)):
            imports.add(match.group(1))
    for match in re.finditer(r'^import\s+"([^"]+)"', content, re.MULTILINE):
        imports.add(match.group(1))
    return sorted(imports)


def _extract_calls(body: str) -> list[str]:
    calls = set()
    for match in re.finditer(r"\b([A-Za-z_][A-Za-z0-9_]*)\s*\(", body):
        name = match.group(1)
        if name not in CALL_EXCLUDES:
            calls.add(name)
    return sorted(calls)


def _extract_function_body(content: str, start: int) -> str:
    brace_start = content.find("{", start)
    if brace_start < 0:
        return ""
    depth = 0
    for index in range(brace_start, len(content)):
        if content[index] == "{":
            depth += 1
        elif content[index] == "}":
            depth -= 1
            if depth == 0:
                return content[brace_start : index + 1]
    return content[brace_start:]


def _normalise_receiver(receiver: str | None) -> str | None:
    if not receiver:
        return None
    cleaned = receiver.replace("*", "").strip()
    parts = re.split(r"\s+", cleaned)
    return parts[-1] if parts else None


def _line_number_at(content: str, index: int) -> int:
    return content[:index].count("\n") + 1


def _looks_like_validator_tag(tag: str) -> bool:
    return bool(re.match(r"^[a-z][a-z0-9_|\-.]+$", tag, re.IGNORECASE)) and len(tag) <= 80
