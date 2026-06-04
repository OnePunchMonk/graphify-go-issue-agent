export function generatePrDraft(state) {
  const changedFiles = state.proposal?.changedFiles?.length
    ? state.proposal.changedFiles
    : extractFilesFromDiff(state.proposal?.workingDiff ?? state.proposal?.diff ?? "");
  const tests = state.testResult?.results?.length
    ? state.testResult.results.map((result) => `${result.ok ? "PASS" : "FAIL"} ${result.command}`)
    : ["Not run"];

  const title = state.issue.title.toLowerCase().startsWith("fix")
    ? state.issue.title
    : `fix: ${state.issue.title}`;

  const body = [
    "## Summary",
    "",
    `- ${state.intent.expectedBehaviour}`,
    `- Scoped through the repository graph to ${changedFiles.length ? changedFiles.join(", ") : "the planned files"}.`,
    "",
    "## Changes",
    "",
    ...(changedFiles.length ? changedFiles.map((file) => `- Updated \`${file}\`.`) : ["- No diff was applied in this run."]),
    "",
    "## Validation",
    "",
    ...tests.map((line) => `- ${line}`),
    "",
    `Fixes #${state.issue.number}`
  ].join("\n");

  return {
    title,
    body
  };
}

function extractFilesFromDiff(diff) {
  const files = new Set();
  for (const match of diff.matchAll(/^\+\+\+\s+b\/(.+)$/gm)) {
    files.add(match[1]);
  }
  return [...files];
}
