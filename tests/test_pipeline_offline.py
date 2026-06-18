import tempfile
import unittest
from pathlib import Path

from go_issue_agent.pipeline import solve_issue


ROOT = Path(__file__).resolve().parents[1]


class OfflinePipelineTests(unittest.TestCase):
    def test_offline_pipeline_creates_expected_artifacts(self):
        with tempfile.TemporaryDirectory(prefix="go-issue-agent-") as out_dir:
            result = solve_issue(
                {
                    "repo": "go-playground/validator",
                    "issue": "1561",
                    "issueFile": str((ROOT / "fixtures" / "issue-1561.json").resolve()),
                    "repoPath": str((ROOT / "fixtures" / "tiny-validator").resolve()),
                    "outDir": out_dir,
                    "offline": True,
                    "applyPatch": False,
                    "runTests": False,
                }
            )

            self.assertEqual(result["state"]["intent"]["problemType"], "bug")
            self.assertIn("baked_in.go", result["state"]["plan"]["filesToEdit"])
            self.assertFalse(result["state"]["proposal"]["applied"])
            self.assertRegex(result["state"]["prDraft"]["title"], "hostname_rfc1123")
            self.assertLess(result["state"]["confidence"]["confidence"], 0.8)


if __name__ == "__main__":
    unittest.main()
