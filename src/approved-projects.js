export const APPROVED_PROJECTS = new Map([
  [
    "gin-gonic/gin",
    {
      cloneUrl: "https://github.com/gin-gonic/gin.git",
      defaultBranch: "master",
      standardChecks: ["go test ./..."],
      riskNotes: ["web framework behavior has wider routing, binding, and middleware blast radius"]
    }
  ],
  [
    "spf13/cobra",
    {
      cloneUrl: "https://github.com/spf13/cobra.git",
      defaultBranch: "main",
      standardChecks: ["go test ./..."],
      riskNotes: ["shell completion and help text changes can be environment-sensitive"]
    }
  ],
  [
    "go-playground/validator",
    {
      cloneUrl: "https://github.com/go-playground/validator.git",
      defaultBranch: "master",
      standardChecks: ["go test ./..."],
      focusedFiles: ["baked_in.go", "regexes.go", "validator.go", "validator_instance.go", "validator_test.go"],
      riskNotes: ["validator hot paths should avoid unnecessary allocations and broad behavior changes"]
    }
  ],
  [
    "golangci/golangci-lint",
    {
      cloneUrl: "https://github.com/golangci/golangci-lint.git",
      defaultBranch: "main",
      standardChecks: ["go test ./..."],
      riskNotes: ["large execution pipeline and plugin surface make broad edits risky"]
    }
  ]
]);

export function assertApprovedProject(repoFullName) {
  const project = APPROVED_PROJECTS.get(repoFullName);
  if (!project) {
    const allowed = [...APPROVED_PROJECTS.keys()].join(", ");
    throw new Error(`Unsupported repo "${repoFullName}". Approved repos: ${allowed}`);
  }
  return project;
}
