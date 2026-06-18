export const BENCHMARK_SUITE = [
  {
    id: "gin-4413-literal-colon-handler",
    repo: "gin-gonic/gin",
    issueNumber: 4413,
    issueUrl: "https://github.com/gin-gonic/gin/issues/4413",
    acceptedPr: 4415,
    acceptedPrUrl: "https://github.com/gin-gonic/gin/pull/4415",
    baseSha: "2e22e5085960205fbb11c25776f6ea76b8053253",
    difficulty: "medium",
    title: "Literal colon routes don't work properly in non-Run() scenarios",
    body: `### Description

Gin supports literal colon routes such as /api/v1\\:method through backslash escaping. Current behavior:
- engine.Run() works correctly because it calls updateRouteTrees()
- engine.Handler() does not work
- direct use as http.Handler does not work

The literal colon feature depends on updateRouteTrees() converting stored escaped paths (\\:) to actual paths (:), but this method is only called in engine.Run().

Expected: literal colon routes should work when the engine is used through Handler() or directly as an http.Handler.`,
    acceptedFiles: ["gin.go", "gin_test.go"],
    expectedCommands: ["go test -run 'TestLiteralColon|TestUpdateRouteTreesCalledOnce' ./..."],
    notes: "Accepted PR adds sync.Once-based lazy update in ServeHTTP plus tests."
  },
  {
    id: "cobra-2257-completion-osargs",
    repo: "spf13/cobra",
    issueNumber: 2257,
    issueUrl: "https://github.com/spf13/cobra/issues/2257",
    acceptedPr: 2356,
    acceptedPrUrl: "https://github.com/spf13/cobra/pull/2356",
    baseSha: "61968e893eee2f27696c2fbc8e34fa5c4afaf7c4",
    difficulty: "small-medium",
    title: "Completions modify os.Args",
    body: `Cobra shell completions can accidentally insert "--" into os.Args.

Minimal example: a command with TraverseChildren true and ValidArgsFunction inspects os.Args during completion.

Expected:
go run . __complete x
[Debug] [Error] __complete, x

Actual:
go run . __complete x
[Debug] [Error] __complete, --

The issue appears in completion handling around getCompletions, append, and os.Args-backed slices.`,
    acceptedFiles: ["completions.go", "completions_test.go"],
    expectedCommands: ["go test -run TestCompletionDoesNotMutateOsArgs ./..."],
    notes: "Accepted PR copies trimmedArgs before downstream appends and adds a regression test."
  },
  {
    id: "validator-938-excluded-if",
    repo: "go-playground/validator",
    issueNumber: 938,
    issueUrl: "https://github.com/go-playground/validator/issues/938",
    acceptedPr: 939,
    acceptedPrUrl: "https://github.com/go-playground/validator/pull/939",
    baseSha: "9e2ea4038020b5c7e3802a21cfa4e3afcfdcd276",
    difficulty: "small",
    title: "Excluded_if Doesn't behave as expected",
    body: `Validator excluded_if does not behave as the documentation describes.

Documentation: "The field under validation must not be present or not empty only if all the other specified fields are equal to the value following the specified field."

Current behavior: fail if any of the other specified fields are not equal to the value following the specified field.

Example:
Field2 string validate:"excluded_if=Field1 exclude"
Struct{Field1: "dontExclude", Field2: "value"} returns error but should not.
Struct{Field1: "exclude", Field2: "value"} returns no error but should fail.`,
    acceptedFiles: ["baked_in.go", "validator_test.go"],
    expectedCommands: ["go test -run TestExcludedIf ./..."],
    notes: "Accepted PR changes excludedIf boolean logic and expands TestExcludedIf."
  },
  {
    id: "golangci-2588-gci-sections",
    repo: "golangci/golangci-lint",
    issueNumber: 2588,
    issueUrl: "https://github.com/golangci/golangci-lint/issues/2588",
    acceptedPr: 2589,
    acceptedPrUrl: "https://github.com/golangci/golangci-lint/pull/2589",
    baseSha: "cad735b2ab6c35a9149e1574286d6c536116adf4",
    difficulty: "small",
    title: "The defaults for gci sections are inverted",
    body: `The defaults for gci sections are inverted.

This should be []string{"standard", "default"}.

The expected change is in default linter settings for the gci linter.`,
    acceptedFiles: ["pkg/config/linters_settings.go"],
    expectedCommands: ["go test ./pkg/config/..."],
    notes: "Accepted PR swaps default gci sections order in linters settings."
  }
];

export function getBenchmarkCases(ids = []) {
  if (!ids.length) {
    return BENCHMARK_SUITE;
  }
  const wanted = new Set(ids);
  const cases = BENCHMARK_SUITE.filter((item) => wanted.has(item.id));
  if (cases.length !== wanted.size) {
    const found = new Set(cases.map((item) => item.id));
    const missing = [...wanted].filter((id) => !found.has(id));
    throw new Error(`Unknown benchmark case id(s): ${missing.join(", ")}`);
  }
  return cases;
}
