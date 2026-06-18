from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from go_issue_agent.agents.code_change import CodeChangeAgent
from go_issue_agent.agents.intent_normaliser import IntentNormaliserAgent
from go_issue_agent.agents.planner import PlannerAgent
from go_issue_agent.agents.researcher import ResearchAgent
from go_issue_agent.agents.reviewer import ReviewerAgent
from go_issue_agent.agents.tester import TesterAgent
from go_issue_agent.approved_projects import assert_approved_project
from go_issue_agent.core.files import write_json, write_text
from go_issue_agent.core.logger import create_logger
from go_issue_agent.github.client import clone_repository, fetch_issue_cached
from go_issue_agent.graph.graphify_adapter import build_repository_graph
from go_issue_agent.output.pr_draft import generate_pr_draft
from go_issue_agent.providers.gemini import create_model
from go_issue_agent.scoring.confidence import compute_confidence


def solve_issue(options: dict) -> dict:
    logger = create_logger(bool(options.get("verbose")))
    repo_full_name = _require_option(options.get("repo"), "--repo")
    issue_number = int(_require_option(options.get("issue"), "--issue"))
    project = assert_approved_project(repo_full_name)
    run_id = options.get("runId") or f'{repo_full_name.replace("/", "-")}-{issue_number}-{_timestamp()}'
    out_dir = Path(options.get("outDir") or Path("runs") / run_id).resolve()
    cache_dir = out_dir / "cache"
    graph_dir = out_dir / "graph"
    out_dir.mkdir(parents=True, exist_ok=True)

    model = create_model(bool(options.get("offline")), logger=logger)
    repo_path = _prepare_repository(options, project, repo_full_name, run_id, logger)
    issue = _load_issue(options, repo_full_name, issue_number, cache_dir)

    logger.info(f"Building repository graph for {repo_full_name}")
    graph = build_repository_graph(str(repo_path), str(graph_dir), logger=logger)

    state = {
        "repoFullName": repo_full_name,
        "project": project,
        "issue": issue,
        "repoPath": str(repo_path),
        "graph": graph,
        "options": {
            "applyPatch": options.get("applyPatch", True),
            "runTests": options.get("runTests", True),
            "stopOnFirstTestFailure": bool(options.get("stopOnFirstTestFailure", False)),
            "testTimeoutMs": int(options.get("testTimeoutMs", 300000)),
        },
        "revisions": [],
    }

    intent_agent = IntentNormaliserAgent(model=model, logger=logger)
    planner_agent = PlannerAgent(model=model, logger=logger)
    research_agent = ResearchAgent(model=model, logger=logger)
    code_agent = CodeChangeAgent(model=model, logger=logger)
    tester_agent = TesterAgent(logger=logger)
    reviewer_agent = ReviewerAgent(model=model, logger=logger)

    logger.info("Normalising issue intent")
    state["intent"] = intent_agent.run(repo_full_name, issue)
    write_json(out_dir / "intent.json", state["intent"])

    logger.info("Planning patch from graph-ranked context")
    state["plan"] = planner_agent.run(state)
    write_json(out_dir / "plan.json", state["plan"])

    logger.info("Collecting repository and standards research")
    state["research"] = research_agent.run(state)
    write_json(out_dir / "research.json", state["research"])

    max_iterations = int(options.get("maxIterations", 3))
    threshold = float(options.get("threshold", 0.8))
    for iteration in range(1, max_iterations + 1):
        logger.info(f"Code/test/review iteration {iteration}/{max_iterations}")
        state["proposal"] = code_agent.run(state, iteration)
        write_json(out_dir / f"proposal-{iteration}.json", state["proposal"])

        state["testResult"] = tester_agent.run(state)
        write_json(out_dir / f"test-result-{iteration}.json", state["testResult"])

        state["review"] = reviewer_agent.run(state, iteration)
        state["confidence"] = compute_confidence(state["review"], state["testResult"], state["proposal"], state["plan"])
        write_json(out_dir / f"review-{iteration}.json", {"review": state["review"], "confidence": state["confidence"]})

        if state["confidence"]["confidence"] >= threshold and state["review"]["decision"] == "approve":
            break

        state["revisions"].append({"iteration": iteration, "review": state["review"], "confidence": state["confidence"]})
        if not model:
            break

    state["prDraft"] = generate_pr_draft(state)
    write_text(out_dir / "PR_DRAFT.md", f'# {state["prDraft"]["title"]}\n\n{state["prDraft"]["body"]}\n')
    write_json(out_dir / "state.json", _serialise_state(state))
    return {"state": state, "outDir": str(out_dir), "repoPath": str(repo_path)}


def _prepare_repository(options: dict, project: dict, repo_full_name: str, run_id: str, logger):
    repo_path = options.get("repoPath")
    if repo_path:
        resolved = Path(repo_path).resolve()
        if not resolved.exists():
            raise FileNotFoundError(f"--repo-path does not exist: {resolved}")
        return resolved
    workdir = Path(options.get("workdir") or "workspaces").resolve()
    resolved = workdir / run_id / repo_full_name.split("/")[1]
    clone_repository(project["cloneUrl"], str(resolved), options.get("branch") or project["defaultBranch"], logger=logger)
    return resolved


def _load_issue(options: dict, repo_full_name: str, issue_number: int, cache_dir: Path) -> dict:
    if options.get("issueFile"):
        issue = json.loads(Path(options["issueFile"]).resolve().read_text(encoding="utf-8"))
        return {
            "number": issue.get("number", issue_number),
            "title": issue["title"],
            "body": issue.get("body", ""),
            "url": issue.get("url"),
            "labels": issue.get("labels", []),
            "author": issue.get("author"),
        }
    return fetch_issue_cached(repo_full_name, issue_number, str(cache_dir))


def _require_option(value, name: str):
    if value is None or value == "":
        raise ValueError(f"Missing required option {name}")
    return value


def _timestamp() -> str:
    return datetime.now(timezone.utc).isoformat().replace(":", "-").replace(".", "-")


def _serialise_state(state: dict) -> dict:
    return {
        "repoFullName": state["repoFullName"],
        "issue": state["issue"],
        "repoPath": state["repoPath"],
        "intent": state.get("intent"),
        "plan": state.get("plan"),
        "research": state.get("research"),
        "proposal": state.get("proposal"),
        "testResult": state.get("testResult"),
        "review": state.get("review"),
        "confidence": state.get("confidence"),
        "revisions": state.get("revisions"),
        "prDraft": state.get("prDraft"),
    }
