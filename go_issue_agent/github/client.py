from __future__ import annotations

import json
import os
from pathlib import Path
import urllib.request

from go_issue_agent.core.shell import run_command


def fetch_issue(repo_full_name: str, issue_number: int) -> dict:
    headers = {
        "accept": "application/vnd.github+json",
        "user-agent": "graphify-go-issue-agent",
    }
    token = os.environ.get("GITHUB_TOKEN")
    if token:
        headers["authorization"] = f"Bearer {token}"

    request = urllib.request.Request(
        f"https://api.github.com/repos/{repo_full_name}/issues/{issue_number}",
        headers=headers,
    )
    with urllib.request.urlopen(request) as response:
        issue = json.loads(response.read().decode("utf-8"))
    return {
        "number": issue["number"],
        "title": issue["title"],
        "body": issue.get("body", ""),
        "url": issue.get("html_url"),
        "labels": [label if isinstance(label, str) else label["name"] for label in issue.get("labels", [])],
        "author": issue.get("user", {}).get("login"),
    }


def fetch_issue_cached(repo_full_name: str, issue_number: int, cache_dir: str) -> dict:
    cache_path = Path(cache_dir)
    cache_path.mkdir(parents=True, exist_ok=True)
    file_path = cache_path / f'{repo_full_name.replace("/", "__")}-{issue_number}.json'
    if file_path.exists():
        return json.loads(file_path.read_text(encoding="utf-8"))
    issue = fetch_issue(repo_full_name, issue_number)
    file_path.write_text(json.dumps(issue, indent=2), encoding="utf-8")
    return issue


def clone_repository(clone_url: str, repo_path: str, branch: str, logger=None) -> str:
    git_dir = Path(repo_path) / ".git"
    if git_dir.exists():
        if logger:
            logger.info(f"Using existing repository at {repo_path}")
        return repo_path
    Path(repo_path).parent.mkdir(parents=True, exist_ok=True)
    run_command("git", ["clone", "--depth", "1", "--branch", branch, clone_url, repo_path], timeout_ms=300000)
    return repo_path
