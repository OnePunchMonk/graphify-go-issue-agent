from __future__ import annotations

import json
import os
from pathlib import Path

from go_issue_agent.core.files import write_json, write_text
from go_issue_agent.core.shell import run_command
from go_issue_agent.graph.go_builder import build_go_graph
from go_issue_agent.graph.graph import render_graph_report


def build_repository_graph(repo_path: str, out_dir: str, logger=None) -> dict:
    out_path = Path(out_dir)
    out_path.mkdir(parents=True, exist_ok=True)

    existing = _read_existing_graph(repo_path)
    if existing:
        if logger:
            logger.info("Using existing Graphify graph artifact from repository.")
        _persist_graph(out_path, existing)
        return existing

    graphify_graph = _try_graphify_cli(repo_path, out_path, logger)
    if graphify_graph:
        return graphify_graph

    if logger:
        logger.info("Graphify CLI unavailable or failed; building deterministic Go graph fallback.")
    graph = build_go_graph(repo_path)
    _persist_graph(out_path, graph)
    return graph


def _read_existing_graph(repo_path: str) -> dict | None:
    for candidate in [Path(repo_path) / "graphify-out" / "graph.json", Path(repo_path) / "graph.json"]:
        if candidate.exists():
            return json.loads(candidate.read_text(encoding="utf-8"))
    return None


def _try_graphify_cli(repo_path: str, out_dir: Path, logger=None) -> dict | None:
    command = os.environ.get("GRAPHIFY_CMD", "graphify")
    attempts = [
        [repo_path, "--out", str(out_dir), "--no-viz"],
        [repo_path, "--output", str(out_dir), "--no-viz"],
        [repo_path, "--no-viz"],
    ]
    for args in attempts:
        try:
            result = run_command(command, args, allow_failure=True, timeout_ms=300000)
        except Exception as error:  # pragma: no cover - defensive shell path
            result = {"ok": False, "stderr": str(error)}
        if not result["ok"]:
            if logger:
                logger.debug(f'Graphify attempt failed: {command} {" ".join(args)} {result.get("stderr", "")}')
            continue
        graph_path = _find_graphify_output(repo_path, out_dir)
        if graph_path:
            graph = json.loads(graph_path.read_text(encoding="utf-8"))
            graph["source"] = graph.get("source") or "graphify-cli"
            _persist_graph(out_dir, graph)
            return graph
    return None


def _find_graphify_output(repo_path: str, out_dir: Path) -> Path | None:
    for candidate in [out_dir / "graph.json", Path(repo_path) / "graphify-out" / "graph.json", Path(repo_path) / "graph.json"]:
        if candidate.exists():
            return candidate
    return None


def _persist_graph(out_dir: Path, graph: dict) -> None:
    write_json(out_dir / "graph.json", graph)
    report = graph.get("report") or render_graph_report(graph)
    write_text(out_dir / "GRAPH_REPORT.md", report)
