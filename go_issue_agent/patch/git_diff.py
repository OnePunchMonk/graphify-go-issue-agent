from go_issue_agent.core.shell import run_command


def apply_unified_diff(repo_path: str, diff: str) -> None:
    run_command("git", ["apply", "--check"], cwd=repo_path, input_text=diff, timeout_ms=60000)
    run_command("git", ["apply"], cwd=repo_path, input_text=diff, timeout_ms=60000)


def get_working_diff(repo_path: str) -> str:
    result = run_command("git", ["diff", "--", "."], cwd=repo_path, allow_failure=True, timeout_ms=60000)
    return result["stdout"]
