# Architecture

The platform is organized around a structured issue state rather than free-form agent chat.

1. Intake validates the repository against the approved list, loads the GitHub issue, and prepares a local checkout.
2. Repository intelligence invokes Graphify when available and otherwise builds a deterministic Go graph with files, packages, imports, functions, tests, validator tags, regexes, and call edges.
3. Intent normalization turns the issue into observed behavior, expected behavior, symbols, candidate files, acceptance criteria, and risk notes.
4. The planner retrieves an issue-induced subgraph and emits files to edit, tests to edit, validation commands, risk notes, and a patch budget.
5. The researcher captures repository conventions and minimal outside authorities such as RFCs linked or named in the issue. When `GEMINI_ENABLE_SEARCH=1`, it also enables Gemini Google Search grounding for this research step.
6. The code agent asks Gemini 2.5 Flash for one unified diff at a time, applies it with `git apply`, and records the working diff.
7. The tester runs targeted and repository-standard commands.
8. The reviewer scores correctness, minimality, convention fit, test evidence, and unresolved risks.
9. The loop repeats until the confidence threshold is met or the iteration budget is exhausted.
10. The output layer writes `state.json`, `graph/graph.json`, `graph/GRAPH_REPORT.md`, and `PR_DRAFT.md`.

The default model id is `gemini-2.5-flash`, matching the current Gemini API and Vertex AI model naming checked during project creation.
