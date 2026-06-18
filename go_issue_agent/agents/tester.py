from go_issue_agent.core.shell import run_command, split_shell_command


class TesterAgent:
    def __init__(self, logger=None):
        self.logger = logger

    def run(self, state: dict) -> dict:
        commands = list(dict.fromkeys([*(state["plan"].get("targetedCommands") or []), *(state["plan"].get("standardCommands") or [])]))
        results = []
        if not state["options"].get("runTests", True):
            return {"skipped": True, "reason": "runTests=false", "results": results}

        for command in [command for command in commands if command]:
            if self.logger:
                self.logger.info(f"Running validation: {command}")
            binary, *args = split_shell_command(command)
            result = run_command(
                binary,
                args,
                cwd=state["repoPath"],
                allow_failure=True,
                timeout_ms=state["options"].get("testTimeoutMs", 300000),
            )
            results.append(result)
            if not result["ok"] and state["options"].get("stopOnFirstTestFailure"):
                break
        return {"skipped": False, "results": results, "ok": bool(results) and all(result["ok"] for result in results)}
