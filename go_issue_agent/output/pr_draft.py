import re


def generate_pr_draft(state: dict) -> dict:
    proposal = state.get("proposal") or {}
    changed_files = proposal.get("changedFiles") or _extract_files_from_diff(proposal.get("workingDiff") or proposal.get("diff", ""))
    if (state.get("testResult") or {}).get("results"):
        tests = [
            f'{"PASS" if result.get("ok") else "FAIL"} {result.get("command")}'
            for result in state["testResult"]["results"]
        ]
    else:
        tests = ["Not run"]

    title = state["issue"]["title"]
    if not title.lower().startswith("fix"):
        title = f"fix: {title}"

    body_lines = [
        "## Summary",
        "",
        f'- {state["intent"]["expectedBehaviour"]}',
        f'- Scoped through the repository graph to {", ".join(changed_files) if changed_files else "the planned files"}.',
        "",
        "## Changes",
        "",
    ]
    if changed_files:
        body_lines.extend([f"- Updated `{file}`." for file in changed_files])
    else:
        body_lines.append("- No diff was applied in this run.")
    body_lines.extend(["", "## Validation", ""])
    body_lines.extend([f"- {line}" for line in tests])
    body_lines.extend(["", f'Fixes #{state["issue"]["number"]}'])
    return {"title": title, "body": "\n".join(body_lines)}


def _extract_files_from_diff(diff: str) -> list[str]:
    return sorted(set(re.findall(r"^\+\+\+\s+b/(.+)$", diff, re.MULTILINE)))
