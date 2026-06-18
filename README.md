# Graphify Go Issue Agent

Agentic AI platform for solving small and medium GitHub issues in approved open-source Go repositories.

The system is built around Graphify-style repository intelligence, Gemini 2.5 Flash, and a structured multi-agent loop:

- Graph builder: uses real Graphify artifacts when available, otherwise builds a Go-aware graph locally.
- Intent normaliser: turns an issue into a behavioral spec.
- Retrieval planner: ranks the issue-induced code subgraph and selects files/tests.
- Research agent: captures repo conventions and standards references.
- Code agent: asks Gemini 2.5 Flash for a minimal unified diff.
- Tester: runs targeted and repo-standard validation commands.
- Reviewer: scores correctness, scope, tests, and risk, then loops until confidence is high enough.
- PR generator: writes a title/body with summary, changes, validation, and issue closure line.

Approved repositories:

- `gin-gonic/gin`
- `spf13/cobra`
- `go-playground/validator`
- `golangci/golangci-lint`

## Setup

```bash
cp .env.example .env
export GEMINI_API_KEY="your_google_ai_studio_key"
export GEMINI_MODEL="gemini-2.5-flash"
export GEMINI_ENABLE_SEARCH=1 # optional: lets the research agent use Gemini Google Search grounding
```

No npm dependencies are required for the framework itself. It uses Node 20+ and direct HTTPS calls to the Gemini API.

If Graphify is installed, the agent will call it. If not, it falls back to a deterministic Go graph builder and still emits `graph.json` plus `GRAPH_REPORT.md`.

## Run

Use an existing local checkout:

```bash
./bin/go-issue-agent.js solve \
  --repo go-playground/validator \
  --issue 1561 \
  --repo-path ../validator
```

Let the agent clone the approved repository:

```bash
./bin/go-issue-agent.js solve \
  --repo go-playground/validator \
  --issue 1561 \
  --workdir workspaces
```

Offline smoke run against the bundled fixture:

```bash
./bin/go-issue-agent.js solve \
  --repo go-playground/validator \
  --issue 1561 \
  --offline \
  --no-apply \
  --no-tests \
  --issue-file fixtures/issue-1561.json \
  --repo-path fixtures/tiny-validator \
  --out-dir runs/offline-fixture
```

Build only graph artifacts:

```bash
./bin/go-issue-agent.js graph \
  --repo-path fixtures/tiny-validator \
  --out-dir runs/tiny-graph
```

Run the accepted issue/PR benchmark suite:

```bash
./bin/go-issue-agent.js benchmark \
  --query-budget 100 \
  --out-dir runs/benchmark/latest
```

The benchmark uses repository maps plus graph/code-search retrieval to score whether the agent identifies the same files as accepted PRs from the approved repositories. Full Gemini patch generation is intentionally separate from this retrieval benchmark because it requires `GEMINI_API_KEY` and can be slower/costly.

## Outputs

Each `solve` run writes:

- `intent.json`
- `plan.json`
- `research.json`
- `proposal-N.json`
- `test-result-N.json`
- `review-N.json`
- `state.json`
- `PR_DRAFT.md`
- `graph/graph.json`
- `graph/GRAPH_REPORT.md`

Benchmark runs additionally write:

- `benchmark-results.json`
- `BENCHMARK_REPORT.md`
- per-case `repo-map.json`

## Validation

```bash
npm run validate
```

This runs syntax checks and the offline test suite.
