from __future__ import annotations

from go_issue_agent.patch.git_diff import apply_unified_diff, get_working_diff


class CodeChangeAgent:
    def __init__(self, model=None, logger=None):
        self.model = model
        self.logger = logger

    def run(self, state: dict, iteration: int) -> dict:
        if not self.model:
            return offline_proposal(state, iteration)
        proposal = self.from_model(state, iteration)
        if not proposal.get("diff", "").strip():
            raise RuntimeError("CodeChangeAgent returned no diff")
        if state["options"].get("applyPatch", True):
            apply_unified_diff(state["repoPath"], proposal["diff"])
            proposal["applied"] = True
            proposal["workingDiff"] = get_working_diff(state["repoPath"])
        return proposal

    def from_model(self, state: dict, iteration: int) -> dict:
        snippets_text = "".join(
            f"--- {snippet['path']}\n{snippet['excerpt']}\n\n"
            for snippet in state["plan"]["context"]["snippets"]
        )
        prompt = f"""Generate a minimal unified diff for this Go issue.

Repository: {state["repoFullName"]}
Issue: #{state["issue"]["number"]} {state["issue"]["title"]}
Iteration: {iteration}

Intent:
{state["intent"]}

Plan:
{strip_context(state["plan"])}

Research:
{state["research"]}

Context snippets:
{snippets_text}

Previous reviewer feedback:
{state.get("revisions", [])}

Return strict JSON:
{{
  "rationale": "short explanation",
  "diff": "unified diff suitable for git apply",
  "changedFiles": ["relative/path.go"],
  "expectedTests": ["command"]
}}"""
        return self.model.generate_json(
            system="You are a production Go code generation agent. Output only JSON matching the requested contract.",
            prompt=prompt,
            temperature=0.2,
        )


def offline_proposal(state: dict, iteration: int) -> dict:
    return {
        "rationale": "Offline mode cannot safely author a production patch; generated plan and context are ready for Gemini-backed code generation.",
        "diff": "",
        "changedFiles": [],
        "expectedTests": state["plan"]["targetedCommands"],
        "applied": False,
        "iteration": iteration,
    }


def strip_context(plan: dict) -> dict:
    return {key: value for key, value in plan.items() if key != "context"}
