from __future__ import annotations

import os
import re


class ResearchAgent:
    def __init__(self, model=None, logger=None):
        self.model = model
        self.logger = logger

    def run(self, state: dict) -> dict:
        local_signals = collect_local_signals(state)
        if self.model and state["intent"].get("needsExternalResearch"):
            return self.from_model(state, local_signals)
        return {
            "authorities": local_signals["authorities"],
            "projectConventions": local_signals["projectConventions"],
            "notes": [
                "External research is requested, but offline mode is active; verify standards before final PR submission."
                if state["intent"].get("needsExternalResearch")
                else "Issue appears repository-local; prefer local tests and existing implementation patterns."
            ],
        }

    def from_model(self, state: dict, local_signals: dict) -> dict:
        prompt = f"""Research only the minimum outside context needed for this Go issue.

Repository: {state["repoFullName"]}
Issue: #{state["issue"]["number"]} {state["issue"]["title"]}
Intent:
{state["intent"]}
Local signals:
{local_signals}

Return strict JSON:
{{
  "authorities": [{{"title": "source or standard", "url": "url if known", "relevance": "why it matters"}}],
  "projectConventions": ["repo-local convention"],
  "notes": ["short actionable note"]
}}

Do not invent external facts. If you are not sure, say verification is needed."""
        return self.model.generate_json(
            system="You are a software standards and repository-convention researcher. Keep context minimal.",
            prompt=prompt,
            temperature=0.1,
            google_search=os.environ.get("GEMINI_ENABLE_SEARCH") == "1",
        )


def collect_local_signals(state: dict) -> dict:
    docs = [
        f'{node["path"]}: {node["name"]}'
        for node in state["graph"].get("nodes", [])
        if node["type"] == "doc-heading"
    ][:20]
    authorities = []
    issue_text = f'{state["issue"]["title"]}\n{state["issue"].get("body", "")}'
    for match in re.finditer(r"https?://\S+", issue_text):
        authorities.append({"title": "Issue-linked source", "url": match.group(0).rstrip("),."), "relevance": "Linked from the issue text"})
    for match in re.finditer(r"\bRFC\s?(\d+)\b", issue_text, re.IGNORECASE):
        authorities.append(
            {
                "title": f"RFC {match.group(1)}",
                "url": f"https://www.rfc-editor.org/rfc/rfc{match.group(1)}",
                "relevance": "Referenced by the issue text",
            }
        )
    return {"authorities": authorities, "projectConventions": docs}
