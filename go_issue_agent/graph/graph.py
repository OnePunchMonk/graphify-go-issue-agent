from collections import Counter
from datetime import datetime, timezone


def create_graph(repo_root: str, source: str = "go-static"):
    return {
        "schemaVersion": "0.1",
        "source": source,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "repoRoot": repo_root,
        "nodes": [],
        "edges": [],
    }


def add_node(graph: dict, node: dict) -> None:
    if not any(existing["id"] == node["id"] for existing in graph["nodes"]):
        graph["nodes"].append({"metadata": {}, **node})


def add_edge(graph: dict, edge: dict) -> None:
    if not any(
        existing["source"] == edge["source"]
        and existing["target"] == edge["target"]
        and existing["type"] == edge["type"]
        for existing in graph["edges"]
    ):
        graph["edges"].append({"metadata": {}, **edge})


def make_node_id(node_type: str, parts: list[str]) -> str:
    return f'{node_type}:{":".join(part for part in parts if part)}'


def graph_stats(graph: dict) -> dict:
    by_type = Counter(node["type"] for node in graph["nodes"])
    return {"nodes": len(graph["nodes"]), "edges": len(graph["edges"]), "byType": dict(by_type)}


def render_graph_report(graph: dict) -> str:
    stats = graph_stats(graph)
    file_nodes = [node for node in graph["nodes"] if node["type"] == "file"]
    high_degree = []
    for node in graph["nodes"]:
        degree = sum(1 for edge in graph["edges"] if edge["source"] == node["id"] or edge["target"] == node["id"])
        high_degree.append((degree, node))
    high_degree.sort(key=lambda item: item[0], reverse=True)

    lines = [
        "# Graph Report",
        "",
        f'Source: {graph["source"]}',
        f'Generated: {graph["generatedAt"]}',
        "",
        "## Stats",
        "",
        f'- Nodes: {stats["nodes"]}',
        f'- Edges: {stats["edges"]}',
    ]
    for node_type, count in stats["byType"].items():
        lines.append(f"- {node_type}: {count}")

    lines.extend(["", "## High-Connectivity Nodes", ""])
    for degree, node in high_degree[:12]:
        extra = f' path={node["path"]}' if node.get("path") else ""
        lines.append(f'- {node.get("name", node["id"])} ({node["type"]}) degree={degree}{extra}')

    lines.extend(["", "## Files Indexed", ""])
    for node in file_nodes[:80]:
        lines.append(f'- {node["path"]}')
    return "\n".join(lines) + "\n"
