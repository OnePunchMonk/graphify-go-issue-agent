import { runCommand } from "../core/shell.js";

export async function applyUnifiedDiff(repoPath, diff) {
  await runCommand("git", ["apply", "--check"], {
    cwd: repoPath,
    input: diff,
    timeoutMs: 60_000
  });
  await runCommand("git", ["apply"], {
    cwd: repoPath,
    input: diff,
    timeoutMs: 60_000
  });
}

export async function getWorkingDiff(repoPath) {
  const result = await runCommand("git", ["diff", "--", "."], {
    cwd: repoPath,
    allowFailure: true,
    timeoutMs: 60_000
  });
  return result.stdout;
}
