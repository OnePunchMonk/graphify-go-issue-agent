from __future__ import annotations

import shlex
import subprocess
import time


def run_command(command: str, args: list[str] | None = None, cwd=None, env=None, timeout_ms: int = 120000, input_text: str | None = None, allow_failure: bool = False):
    args = args or []
    started_at = time.time()
    merged_env = None
    if env:
        import os

        merged_env = dict(os.environ)
        merged_env.update(env)

    try:
        completed = subprocess.run(
            [command, *args],
            cwd=cwd,
            env=merged_env,
            input=input_text,
            text=True,
            capture_output=True,
            timeout=timeout_ms / 1000,
            check=False,
        )
    except subprocess.TimeoutExpired as error:
        result = {
            "command": " ".join([command, *args]),
            "cwd": cwd,
            "code": None,
            "signal": "timeout",
            "stdout": error.stdout or "",
            "stderr": error.stderr or "",
            "durationMs": int((time.time() - started_at) * 1000),
            "ok": False,
        }
        if allow_failure:
            return result
        raise RuntimeError(f'{result["command"]} failed: timeout')

    result = {
        "command": " ".join([command, *args]),
        "cwd": cwd,
        "code": completed.returncode,
        "signal": None,
        "stdout": completed.stdout,
        "stderr": completed.stderr,
        "durationMs": int((time.time() - started_at) * 1000),
        "ok": completed.returncode == 0,
    }
    if not result["ok"] and not allow_failure:
        detail = completed.stderr.strip() or completed.stdout.strip() or f'exit code {completed.returncode}'
        raise RuntimeError(f'{result["command"]} failed: {detail}')
    return result


def split_shell_command(command: str) -> list[str]:
    return shlex.split(command)
