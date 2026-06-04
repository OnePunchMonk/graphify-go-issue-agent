import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { runCommand } from "../core/shell.js";

export async function fetchIssue(repoFullName, issueNumber) {
  const headers = {
    "accept": "application/vnd.github+json",
    "user-agent": "graphify-go-issue-agent"
  };
  if (process.env.GITHUB_TOKEN) {
    headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const response = await fetch(`https://api.github.com/repos/${repoFullName}/issues/${issueNumber}`, {
    headers
  });
  if (!response.ok) {
    throw new Error(`GitHub issue fetch failed (${response.status}): ${await response.text()}`);
  }
  const issue = await response.json();
  return {
    number: issue.number,
    title: issue.title,
    body: issue.body ?? "",
    url: issue.html_url,
    labels: (issue.labels ?? []).map((label) => typeof label === "string" ? label : label.name),
    author: issue.user?.login
  };
}

export async function fetchIssueCached(repoFullName, issueNumber, cacheDir) {
  await mkdir(cacheDir, { recursive: true });
  const cachePath = join(cacheDir, `${repoFullName.replace("/", "__")}-${issueNumber}.json`);
  if (existsSync(cachePath)) {
    return JSON.parse(await readFile(cachePath, "utf8"));
  }
  const issue = await fetchIssue(repoFullName, issueNumber);
  await writeFile(cachePath, JSON.stringify(issue, null, 2));
  return issue;
}

export async function cloneRepository({ cloneUrl, repoPath, branch, logger }) {
  if (existsSync(join(repoPath, ".git"))) {
    logger?.info(`Using existing repository at ${repoPath}`);
    return repoPath;
  }

  await mkdir(repoPath, { recursive: true });
  await runCommand("git", ["clone", "--depth", "1", "--branch", branch, cloneUrl, repoPath], {
    timeoutMs: 300_000
  });
  return repoPath;
}
