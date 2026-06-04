import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { buildGoGraph } from "../src/graph/go-builder.js";
import { retrieveIssueContext } from "../src/graph/retriever.js";

test("buildGoGraph extracts Go functions, tests, validator tags, and regexes", async () => {
  const repoPath = resolve("fixtures/tiny-validator");
  const graph = await buildGoGraph(repoPath);

  assert.equal(graph.source, "go-static-fallback");
  assert.ok(graph.nodes.some((node) => node.type === "function" && node.name === "isHostnameRFC1123"));
  assert.ok(graph.nodes.some((node) => node.type === "test" && node.name === "TestHostnameRFC1123Validation"));
  assert.ok(graph.nodes.some((node) => node.type === "validator-tag" && node.name === "hostname_rfc1123"));
  assert.ok(graph.nodes.some((node) => node.type === "regex" && node.name === "hostnameRegex"));
  assert.ok(graph.edges.some((edge) => edge.type === "implemented_by"));
});

test("retrieveIssueContext ranks validator files from issue symbols", async () => {
  const repoPath = resolve("fixtures/tiny-validator");
  const graph = await buildGoGraph(repoPath);
  const context = await retrieveIssueContext({
    graph,
    repoPath,
    issue: {
      title: "hostname_rfc1123 accepts 277.168.0.1",
      body: "The hostname_rfc1123 validation should reject invalid dotted decimal strings."
    },
    intent: {
      symbols: ["hostname_rfc1123", "isHostnameRFC1123"],
      candidateFiles: ["baked_in.go", "validator_test.go"]
    }
  });

  assert.ok(context.files.some((file) => file.path === "baked_in.go"));
  assert.ok(context.files.some((file) => file.path === "validator_test.go"));
  assert.ok(context.graphNodes.some((node) => node.name === "hostname_rfc1123"));
});
