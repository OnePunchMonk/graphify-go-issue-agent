import argparse
from pathlib import Path
import sys

from go_issue_agent.approved_projects import APPROVED_PROJECTS, assert_approved_project
from go_issue_agent.benchmark.runner import run_benchmark
from go_issue_agent.core.logger import create_logger
from go_issue_agent.graph.graphify_adapter import build_repository_graph
from go_issue_agent.pipeline import solve_issue


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="go-issue-agent")
    subparsers = parser.add_subparsers(dest="command")

    solve = subparsers.add_parser("solve", help="Run the full issue-solving loop")
    _add_common_options(solve)
    solve.add_argument("--repo", required=True)
    solve.add_argument("--issue", required=True)
    solve.add_argument("--issue-file")
    solve.add_argument("--branch")
    solve.add_argument("--threshold", type=float, default=0.8)
    solve.add_argument("--max-iterations", type=int, default=3)
    solve.add_argument("--test-timeout-ms", type=int, default=300000)
    solve.add_argument("--stop-on-first-test-failure", action="store_true")

    graph = subparsers.add_parser("graph", help="Build graph artifacts for a local repo")
    graph.add_argument("--repo-path", required=True)
    graph.add_argument("--out-dir", default="runs/graph")
    graph.add_argument("--verbose", action="store_true")

    benchmark = subparsers.add_parser("benchmark", help="Run the issue/PR file-identification benchmark suite")
    benchmark.add_argument("--repo-path")
    benchmark.add_argument("--workdir", default="workspaces/benchmark")
    benchmark.add_argument("--out-dir")
    benchmark.add_argument("--cases")
    benchmark.add_argument("--query-budget", type=int, default=100)
    benchmark.add_argument("--offline", action="store_true")
    benchmark.add_argument("--no-clone", action="store_true")
    benchmark.add_argument("--verbose", action="store_true")

    subparsers.add_parser("approved", help="List approved repositories")
    check_repo = subparsers.add_parser("check-repo", help="Validate a repository is approved")
    check_repo.add_argument("--repo", required=True)
    return parser


def _add_common_options(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--repo-path")
    parser.add_argument("--workdir", default="workspaces")
    parser.add_argument("--out-dir")
    parser.add_argument("--offline", action="store_true")
    parser.add_argument("--verbose", action="store_true")
    parser.add_argument("--no-apply", action="store_true")
    parser.add_argument("--no-tests", action="store_true")


def args_to_options(args) -> dict:
    options = vars(args).copy()
    if options.pop("no_apply", False):
        options["applyPatch"] = False
    if options.pop("no_tests", False):
        options["runTests"] = False
    if "max_iterations" in options:
        options["maxIterations"] = options.pop("max_iterations")
    if "out_dir" in options:
        options["outDir"] = options.pop("out_dir")
    if "repo_path" in options:
        options["repoPath"] = options.pop("repo_path")
    if "issue_file" in options:
        options["issueFile"] = options.pop("issue_file")
    if "test_timeout_ms" in options:
        options["testTimeoutMs"] = options.pop("test_timeout_ms")
    if "stop_on_first_test_failure" in options:
        options["stopOnFirstTestFailure"] = options.pop("stop_on_first_test_failure")
    if "query_budget" in options:
        options["queryBudget"] = options.pop("query_budget")
    if "no_clone" in options:
        options["noClone"] = options.pop("no_clone")
    return options


def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(argv)
    if not args.command:
        parser.print_help()
        return 0

    options = args_to_options(args)
    if args.command == "solve":
        result = solve_issue(options)
        print(f'Run artifacts: {result["outDir"]}')
        print(f'Repository: {result["repoPath"]}')
        print(f'Confidence: {result["state"].get("confidence", {}).get("confidence", "n/a")}')
        print(f'PR draft title: {result["state"]["prDraft"]["title"]}')
        return 0

    if args.command == "graph":
        repo_path = Path(args.repo_path).resolve()
        out_dir = Path(args.out_dir).resolve()
        logger = create_logger(bool(args.verbose))
        build_repository_graph(str(repo_path), str(out_dir), logger=logger)
        print(f"Graph artifacts: {out_dir}")
        return 0

    if args.command == "benchmark":
        result = run_benchmark(options)
        print(f'Benchmark artifacts: {result["outDir"]}')
        print(f'Completed: {result["summary"]["aggregate"]["completed"]}/{result["summary"]["aggregate"]["total"]}')
        print(f'Query budget: {result["summary"]["queryBudget"]}')
        completed = max(1, result["summary"]["aggregate"]["completed"])
        print(f'Hit@5: {result["summary"]["aggregate"]["hitAt5"]}/{completed}')
        print(f'Avg recall@5: {result["summary"]["aggregate"]["avgRecallAt5"]}')
        return 0

    if args.command == "approved":
        for repo in APPROVED_PROJECTS:
            print(repo)
        return 0

    if args.command == "check-repo":
        assert_approved_project(args.repo)
        print("approved")
        return 0

    parser.error(f'Unknown command "{args.command}"')
    return 2


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(str(error), file=sys.stderr)
        raise
