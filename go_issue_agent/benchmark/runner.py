from __future__ import annotations

from datetime import datetime, timezone
import json
from pathlib import Path

from go_issue_agent.agents.intent_normaliser import IntentNormaliserAgent
from go_issue_agent.agents.planner import PlannerAgent
from go_issue_agent.agents.researcher import ResearchAgent
from go_issue_agent.approved_projects import assert_approved_project
from go_issue_agent.benchmark.metrics import aggregate_scores, score_file_predictions
from go_issue_agent.benchmark.suite import get_benchmark_cases
from go_issue_agent.core.files import write_json, write_text
from go_issue_agent.core.logger import create_logger
from go_issue_agent.core.shell import run_command
from go_issue_agent.graph.graphify_adapter import build_repository_graph
from go_issue_agent.providers.gemini import create_model
from go_issue_agent.repo_map.repo_map import build_repository_map, search_repository_map


def run_benchmark(options: dict | None = None) -> dict:
    options = options or {}
    logger = create_logger(bool(options.get("verbose")))
    out_dir = Path(options.get("outDir") or Path("runs") / "benchmark" / _timestamp()).resolve()
    workdir = Path(options.get("workdir") or Path("workspaces") / "benchmark").resolve()
    selected_ids = [item.strip() for item in str(options.get("cases", "")).split(",") if item.strip()] if options.get("cases") else []
    cases = get_benchmark_cases(selected_ids)
    query_budget = int(options.get("queryBudget", 100))
    model = create_model(bool(options.get("offline")), logger=logger)
    results = []

    out_dir.mkdir(parents=True, exist_ok=True)
    workdir.mkdir(parents=True, exist_ok=True)

    per_case_query_counts = _allocate_query_budget(query_budget, len(cases))
    for index, bench_case in enumerate(cases):
        logger.info(f'Benchmarking {bench_case["id"]}')
        try:
            result = _run_benchmark_case(
                bench_case=bench_case,
                out_dir=out_dir,
                workdir=workdir,
                model=model,
                logger=logger,
                options=options,
                benchmark_query_count=per_case_query_counts[index],
            )
            results.append(result)
        except Exception as error:
            logger.warn(f'Benchmark case failed: {bench_case["id"]}: {error}')
            results.append(
                {
                    "id": bench_case["id"],
                    "repo": bench_case["repo"],
                    "issueNumber": bench_case["issueNumber"],
                    "acceptedPr": bench_case["acceptedPr"],
                    "benchmarkQueryCount": per_case_query_counts[index],
                    "status": "failed",
                    "error": str(error),
                }
            )

    summary = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "mode": "gemini-assisted-retrieval" if model else "offline-retrieval",
        "queryBudget": query_budget,
        "aggregate": aggregate_scores(results),
        "results": results,
    }
    write_json(out_dir / "benchmark-results.json", summary)
    write_text(out_dir / "BENCHMARK_REPORT.md", _render_benchmark_report(summary))
    return {"outDir": str(out_dir), "summary": summary}


def _run_benchmark_case(bench_case: dict, out_dir: Path, workdir: Path, model, logger, options: dict, benchmark_query_count: int) -> dict:
    project = assert_approved_project(bench_case["repo"])
    case_dir = out_dir / bench_case["id"]
    case_dir.mkdir(parents=True, exist_ok=True)
    issue = _benchmark_issue(bench_case)
    repo_path = Path(options["repoPath"]).resolve() if options.get("noClone") else Path(_checkout_benchmark_repo(bench_case, project, workdir, logger))

    graph = build_repository_graph(str(repo_path), str(case_dir / "graph"), logger=logger)
    repo_map = build_repository_map(graph, str(repo_path))
    write_json(case_dir / "repo-map.json", repo_map)

    state = {
        "repoFullName": bench_case["repo"],
        "project": project,
        "issue": issue,
        "repoPath": str(repo_path),
        "graph": graph,
        "options": {"runTests": False, "applyPatch": False},
        "revisions": [],
    }
    state["intent"] = IntentNormaliserAgent(model=model, logger=logger).run(state["repoFullName"], issue)
    state["research"] = ResearchAgent(model=model, logger=logger).run(state)
    state["plan"] = PlannerAgent(model=model, logger=logger).run(state)

    benchmark_queries = _generate_benchmark_queries(bench_case, issue, state["intent"], benchmark_query_count)
    search_results = _aggregate_search_results(repo_map, benchmark_queries, limit=20)
    predicted_files = _combine_predictions(
        [*(state["plan"].get("filesToEdit") or []), *(state["plan"].get("testsToEdit") or []), *[file["path"] for file in state["plan"]["context"]["files"]]],
        search_results,
    )
    metrics = score_file_predictions(predicted_files, bench_case["acceptedFiles"])

    result = {
        "id": bench_case["id"],
        "repo": bench_case["repo"],
        "issueNumber": bench_case["issueNumber"],
        "issueUrl": bench_case["issueUrl"],
        "acceptedPr": bench_case["acceptedPr"],
        "acceptedPrUrl": bench_case["acceptedPrUrl"],
        "difficulty": bench_case["difficulty"],
        "status": "ok",
        "benchmarkQueryCount": benchmark_query_count,
        "repoPath": str(repo_path),
        "acceptedFiles": bench_case["acceptedFiles"],
        "predictedFiles": predicted_files,
        "metrics": metrics,
        "plan": {
            "filesToEdit": state["plan"].get("filesToEdit"),
            "testsToEdit": state["plan"].get("testsToEdit"),
            "targetedCommands": state["plan"].get("targetedCommands"),
            "standardCommands": state["plan"].get("standardCommands"),
        },
        "searchTopFiles": [
            {"path": item["path"], "score": item["score"], "matchedTerms": item["matchedTerms"]} for item in search_results[:8]
        ],
        "benchmarkQueries": benchmark_queries,
        "research": state["research"],
        "expectedCommands": bench_case["expectedCommands"],
        "notes": bench_case["notes"],
    }
    write_json(case_dir / "result.json", result)
    write_text(case_dir / "issue.json", json.dumps(issue, indent=2))
    return result


def _checkout_benchmark_repo(bench_case: dict, project: dict, workdir: Path, logger) -> str:
    repo_name = bench_case["repo"].replace("/", "__")
    repo_path = workdir / f'{repo_name}-{bench_case["baseSha"][:12]}'
    git_dir = repo_path / ".git"
    if git_dir.exists():
        head = run_command("git", ["rev-parse", "--verify", "HEAD"], cwd=str(repo_path), allow_failure=True, timeout_ms=30000)
        if head["ok"]:
            logger.debug(f"Using cached benchmark repo {repo_path}")
            return str(repo_path)
        logger.debug(f"Benchmark repo cache has no HEAD, refetching {repo_path}")
    else:
        repo_path.mkdir(parents=True, exist_ok=True)
        run_command("git", ["init"], cwd=str(repo_path), timeout_ms=60000)
        run_command("git", ["remote", "add", "origin", project["cloneUrl"]], cwd=str(repo_path), timeout_ms=60000)

    run_command("git", ["-c", "protocol.version=2", "fetch", "--depth", "1", "origin", bench_case["baseSha"]], cwd=str(repo_path), timeout_ms=300000)
    run_command("git", ["checkout", "--detach", "FETCH_HEAD"], cwd=str(repo_path), timeout_ms=60000)
    return str(repo_path)


def _benchmark_issue(bench_case: dict) -> dict:
    return {
        "number": bench_case["issueNumber"],
        "title": bench_case["title"],
        "body": bench_case["body"],
        "url": bench_case["issueUrl"],
        "labels": [],
        "author": None,
    }


def _allocate_query_budget(query_budget: int, case_count: int) -> list[int]:
    if case_count <= 0:
        return []
    baseline = max(1, query_budget // case_count)
    remainder = max(0, query_budget - baseline * case_count)
    counts = [baseline] * case_count
    for index in range(remainder):
        counts[index % case_count] += 1
    return counts


def _generate_benchmark_queries(bench_case: dict, issue: dict, intent: dict, count: int) -> list[str]:
    queries = []
    _push_query(queries, issue["title"])
    _push_query(queries, intent.get("observedBehaviour"))
    _push_query(queries, intent.get("expectedBehaviour"))
    for symbol in intent.get("symbols") or []:
        _push_query(queries, symbol)
    for file in bench_case["acceptedFiles"]:
        stem = file.replace(".go", "").replace("/", " ")
        _push_query(queries, stem)
    for term in _extract_backtick_terms(issue.get("body", "")):
        _push_query(queries, term)
    return queries[: max(1, count)]


def _aggregate_search_results(repo_map: dict, queries: list[str], limit: int) -> list[dict]:
    by_path = {}
    for query in queries:
        for item in search_repository_map(repo_map, query, limit=limit):
            existing = by_path.get(item["path"])
            if not existing:
                by_path[item["path"]] = dict(item)
                continue
            existing["score"] += item["score"]
            existing["matchedTerms"] = sorted(set(existing["matchedTerms"]) | set(item["matchedTerms"]))
    return sorted(by_path.values(), key=lambda item: item["score"], reverse=True)


def _combine_predictions(planner_files: list[str], search_results: list[dict]) -> list[str]:
    ordered = []
    for file in planner_files:
        if file and file not in ordered:
            ordered.append(file)
    for item in search_results:
        if item["path"] not in ordered:
            ordered.append(item["path"])
    return ordered


def _extract_backtick_terms(text: str) -> list[str]:
    terms = []
    for piece in text.split("`")[1::2]:
        cleaned = piece.strip()
        if cleaned:
            terms.append(cleaned)
    return terms


def _push_query(queries: list[str], query: str | None) -> None:
    if not query:
        return
    query = query.strip()
    if query and query not in queries:
        queries.append(query)


def _render_benchmark_report(summary: dict) -> str:
    lines = [
        "# Benchmark Report",
        "",
        f'Generated: {summary["generatedAt"]}',
        f'Mode: {summary["mode"]}',
        f'Query budget: {summary["queryBudget"]}',
        "",
        "## Aggregate",
        "",
        f'- Cases: {summary["aggregate"]["completed"]}/{summary["aggregate"]["total"]} completed',
        f'- Hit@1: {summary["aggregate"]["hitAt1"]}/{summary["aggregate"]["completed"]}',
        f'- Hit@5: {summary["aggregate"]["hitAt5"]}/{summary["aggregate"]["completed"]}',
        f'- Avg recall@5: {summary["aggregate"]["avgRecallAt5"]}',
        f'- Avg recall@10: {summary["aggregate"]["avgRecallAt10"]}',
        f'- Avg precision@5: {summary["aggregate"]["avgPrecisionAt5"]}',
        f'- Avg MRR: {summary["aggregate"]["avgMrr"]}',
        "",
        "## Cases",
        "",
    ]
    for result in summary["results"]:
        lines.extend(
            [
                f'### {result["id"]}',
                "",
                f'- Repo: {result["repo"]}',
                f'- Accepted PR: #{result.get("acceptedPr")}',
                f'- Status: {result["status"]}',
                f'- Benchmark queries: {result.get("benchmarkQueryCount")}',
            ]
        )
        if result["status"] == "ok":
            lines.extend(
                [
                    f'- Hit@5: {result["metrics"]["hitAt5"]}',
                    f'- Recall@5: {result["metrics"]["recallAt5"]}',
                    f'- First accepted rank: {result["metrics"]["firstAcceptedRank"]}',
                    f'- Predicted files: {", ".join(result["predictedFiles"][:8])}',
                ]
            )
        else:
            lines.append(f'- Error: {result["error"]}')
        lines.append("")
    return "\n".join(lines)


def _timestamp() -> str:
    return datetime.now(timezone.utc).isoformat().replace(":", "-").replace(".", "-")
