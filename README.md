# Graphify Go Issue Agent

Python refactor of the agentic AI platform for solving small and medium GitHub issues in approved open-source Go repositories.

The system keeps the original multi-agent shape:

- Graph builder: uses Graphify artifacts when available, otherwise builds a deterministic Go graph locally.
- Intent normaliser: turns an issue into a behavioral spec.
- Retrieval planner: ranks the issue-induced code subgraph and selects files and tests.
- Research agent: captures repo conventions and standards references.
- Code agent: asks Gemini 2.5 Flash for a minimal unified diff.
- Tester: runs targeted and repo-standard validation commands.
- Reviewer: scores correctness, scope, tests, and risk, then loops until confidence is high enough.
- PR generator: writes a title and body with summary, changes, validation, and issue closure.

Approved repositories:

- `gin-gonic/gin`
- `spf13/cobra`
- `go-playground/validator`
- `golangci/golangci-lint`

## Setup

```bash
export GEMINI_API_KEY="your_google_ai_studio_key"
export GEMINI_MODEL="gemini-2.5-flash"
export GEMINI_ENABLE_SEARCH=1
```

No third-party Python packages are required. Run it directly from the repo with Python 3.9+.

If Graphify is installed, the agent will call it. If not, it falls back to a deterministic Go graph builder and still emits `graph.json` plus `GRAPH_REPORT.md`.

## Run

Use an existing local checkout:

```bash
python3 bin/go-issue-agent.js solve \
  --repo go-playground/validator \
  --issue 1561 \
  --repo-path ../validator
```

Let the agent clone the approved repository:

```bash
python3 bin/go-issue-agent.js solve \
  --repo go-playground/validator \
  --issue 1561 \
  --workdir workspaces
```

Offline smoke run against the bundled fixture:

```bash
python3 bin/go-issue-agent.js solve \
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
python3 bin/go-issue-agent.js graph \
  --repo-path fixtures/tiny-validator \
  --out-dir runs/tiny-graph
```

Run the accepted issue/PR benchmark suite:

```bash
python3 bin/go-issue-agent.js benchmark \
  --query-budget 100 \
  --out-dir runs/benchmark/latest
```

The benchmark uses repository maps plus graph and code-search retrieval to score whether the agent identifies the same files as accepted PRs from the approved repositories.

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
python3 -m unittest discover -s tests -p 'test_*.py'
```

`bin/go-issue-agent.js` is a Python launcher kept at the old path so existing scripts do not break.
