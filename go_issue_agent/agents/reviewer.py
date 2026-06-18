from go_issue_agent.patch.git_diff import get_working_diff


class ReviewerAgent:
    def __init__(self, model=None, logger=None):
        self.model = model
        self.logger = logger

    def run(self, state: dict, iteration: int) -> dict:
        try:
            working_diff = get_working_diff(state["repoPath"])
        except Exception:
            working_diff = ""
        if self.model:
            return self.from_model(state, iteration, working_diff)
        return heuristic_review(state, working_diff)

    def from_model(self, state: dict, iteration: int, working_diff: str) -> dict:
        prompt = f"""Review this attempted fix as a strict Go maintainer.

Repository: {state["repoFullName"]}
Issue: #{state["issue"]["number"]} {state["issue"]["title"]}
Iteration: {iteration}

Intent:
{state["intent"]}

Plan:
{strip_context(state["plan"])}

Test results:
{state.get("testResult")}

Diff:
{working_diff}

Return strict JSON:
{{
  "score": 0.0,
  "decision": "approve|needs_changes",
  "findings": [{{"severity": "blocker|major|minor", "message": "specific issue"}}],
  "missingTests": ["test gap"],
  "confidenceRationale": "evidence-based explanation"
}}"""
        return self.model.generate_json(
            system="You review code changes for correctness, minimality, convention fit, and test evidence. Be concrete.",
            prompt=prompt,
            temperature=0.1,
        )


def heuristic_review(state: dict, working_diff: str) -> dict:
    findings = []
    if not working_diff.strip():
        findings.append({"severity": "major", "message": "No code diff has been applied yet."})
    if not state.get("testResult", {}).get("skipped") and any(not result["ok"] for result in state.get("testResult", {}).get("results", [])):
        findings.append({"severity": "blocker", "message": "At least one validation command failed."})
    if state.get("testResult", {}).get("skipped"):
        findings.append({"severity": "major", "message": "Validation was skipped."})
    score = 0.25 if any(finding["severity"] == "blocker" for finding in findings) else 0.45 if findings else 0.75
    return {
        "score": score,
        "decision": "approve" if score >= 0.7 else "needs_changes",
        "findings": findings,
        "missingTests": ["Run targeted and standard tests before PR output."] if state.get("testResult", {}).get("skipped") else [],
        "confidenceRationale": "Heuristic review based on diff presence and command results.",
    }


def strip_context(plan: dict) -> dict:
    return {key: value for key, value in plan.items() if key != "context"}
