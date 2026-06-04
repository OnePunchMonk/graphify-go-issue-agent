# Evaluation

The validation strategy mirrors issue-to-PR benchmarks: each run starts from a real issue and must produce a patch plus executable evidence.

Scoring dimensions:

- File identification: graph-ranked context includes the same conceptual surface a maintainer would inspect.
- Behavioral correctness: targeted tests reproduce and fix the issue.
- Convention fit: changes follow repository docs, nearby code, and existing test style.
- Patch minimality: the diff stays inside the planned patch budget unless reviewer evidence justifies widening scope.
- Reviewer robustness: the review loop catches over-broad guards, hot-path regressions, missing edge-case tests, and validation gaps.

Recommended first target:

- Repository: `go-playground/validator`
- Calibration issue: `#860`
- Live-style issue: `#1561`

The calibration run is useful because it has an accepted human PR. The live-style run is useful because hostname and RFC behavior require standards-aware review rather than a blind regex tweak.
