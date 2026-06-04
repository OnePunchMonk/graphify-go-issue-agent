import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { solveIssue } from "../src/pipeline.js";

test("offline pipeline creates graph, plan, review, and PR draft artifacts", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "go-issue-agent-"));
  try {
    const result = await solveIssue({
      repo: "go-playground/validator",
      issue: "1561",
      issueFile: resolve("fixtures/issue-1561.json"),
      repoPath: resolve("fixtures/tiny-validator"),
      outDir,
      offline: true,
      noApply: true,
      applyPatch: false,
      runTests: false
    });

    assert.equal(result.state.intent.problemType, "bug");
    assert.ok(result.state.plan.filesToEdit.includes("baked_in.go"));
    assert.equal(result.state.proposal.applied, false);
    assert.match(result.state.prDraft.title, /hostname_rfc1123/i);
    assert.ok(result.state.confidence.confidence < 0.8);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});
