import test from "node:test";
import assert from "node:assert/strict";
import { scoreFilePredictions, aggregateScores } from "../src/benchmark/metrics.js";
import { searchRepositoryMap } from "../src/repo-map/repo-map.js";

test("scoreFilePredictions computes ranking metrics", () => {
  const metrics = scoreFilePredictions({
    predictedFiles: ["a.go", "b.go", "c_test.go"],
    acceptedFiles: ["b.go", "c_test.go"]
  });

  assert.equal(metrics.hitAt1, false);
  assert.equal(metrics.hitAt5, true);
  assert.equal(metrics.recallAt5, 1);
  assert.equal(metrics.mrr, 0.5);
});

test("aggregateScores averages completed cases only", () => {
  const aggregate = aggregateScores([
    {
      status: "ok",
      metrics: {
        recallAt5: 1,
        recallAt10: 1,
        precisionAt5: 0.5,
        mrr: 1,
        hitAt1: true,
        hitAt5: true
      }
    },
    { status: "failed" }
  ]);

  assert.equal(aggregate.total, 2);
  assert.equal(aggregate.completed, 1);
  assert.equal(aggregate.avgRecallAt5, 1);
});

test("searchRepositoryMap ranks symbol matches", () => {
  const results = searchRepositoryMap({
    repoMap: {
      files: [
        {
          path: "baked_in.go",
          name: "baked_in.go",
          symbols: ["excludedIf"],
          tests: [],
          validators: ["excluded_if"],
          imports: [],
          headings: [],
          preview: "func excludedIf(fl FieldLevel) bool"
        },
        {
          path: "README.md",
          name: "README.md",
          symbols: [],
          tests: [],
          validators: [],
          imports: [],
          headings: ["Installation"],
          preview: "install"
        }
      ]
    },
    query: "excluded_if excludedIf",
    limit: 2
  });

  assert.equal(results[0].path, "baked_in.go");
});
