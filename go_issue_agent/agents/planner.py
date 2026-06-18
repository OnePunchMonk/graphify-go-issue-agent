from __future__ import annotations

from go_issue_agent.graph.retriever import retrieve_issue_context


class PlannerAgent:
    def __init__(self, model=None, logger=None):
        self.model = model
        self.logger = logger

    def run(self, state: dict) -> dict:
        context = retrieve_issue_context(
            graph=state["graph"],
            repo_path=state["repoPath"],
            issue=state["issue"],
            intent=state["intent"],
        )
        if self.model:
            plan = self.from_model(state, context)
            plan["context"] = context
            return plan
        return heuristic_plan(state, context)

    def from_model(self, state: dict, context: dict) -> dict:
        snippets_text = "".join(
            f"--- {snippet['path']}\n{snippet['excerpt']}\n\n"
            for snippet in context["snippets"]
        )
        prompt = f"""Plan a small production-quality fix for this Go repository issue.

Repository: {state["repoFullName"]}
Issue: #{state["issue"]["number"]} {state["issue"]["title"]}
Intent:
{state["intent"]}

Graph-ranked context:
{context["graphNodes"][:20]}

File excerpts:
{snippets_text}

Return strict JSON:
{{
  "summary": "one sentence",
  "filesToEdit": ["relative/path.go"],
  "testsToEdit": ["relative/path_test.go"],
  "targetedCommands": ["go test -run TestName ./..."],
  "standardCommands": ["go test ./..."],
  "patchBudget": {{"maxFiles": 3, "maxLinesChanged": 120}},
  "risks": ["risk"],
  "reviewChecklist": ["check"]
}}"""
        return self.model.generate_json(
            system="You are a conservative Go maintainer. Prefer minimal behavioral patches and focused tests.",
            prompt=prompt,
            temperature=0.15,
        )


def heuristic_plan(state: dict, context: dict) -> dict:
    project = state["project"]
    files = list(dict.fromkeys([*(state["intent"].get("candidateFiles") or []), *[file["path"] for file in context["files"][:4]]]))
    tests = [file for file in files if file.endswith("_test.go")]
    if not tests:
        likely_test = next((file["path"] for file in context["files"] if file["path"].endswith("_test.go")), None)
        if likely_test:
            tests.append(likely_test)
        elif state["repoFullName"] == "go-playground/validator":
            tests.append("validator_test.go")
    return {
        "summary": f'Fix {state["issue"]["title"]} with a small code change and focused tests.',
        "filesToEdit": [file for file in files if not file.endswith("_test.go")][:4],
        "testsToEdit": tests[:3],
        "targetedCommands": infer_targeted_commands(state),
        "standardCommands": project["standardChecks"],
        "patchBudget": {"maxFiles": 3, "maxLinesChanged": 120},
        "risks": [*(project.get("riskNotes") or []), *(state["intent"].get("riskNotes") or [])],
        "reviewChecklist": [
            "Patch is limited to issue-related behavior.",
            "Tests cover the reported case and a nearby valid case.",
            "No exported API changes unless the issue requires them.",
            "No avoidable work added to hot paths.",
        ],
        "context": context,
    }


def infer_targeted_commands(state: dict) -> list[str]:
    test_symbols = []
    for symbol in state["intent"].get("symbols") or []:
        if symbol.lower().startswith("test"):
            cleaned = "".join(ch for ch in symbol if ch.isalnum() or ch == "_")
            test_symbols.append(cleaned)
    if test_symbols:
        return [f"go test -run {test_symbols[0]} ./..."]

    title_words = [word for word in "".join(ch if ch.isalnum() else " " for ch in state["issue"]["title"]).split() if len(word) >= 5][:3]
    return [f"go test -run '{'|'.join(title_words)}' ./..."] if title_words else ["go test ./..."]
