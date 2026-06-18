import unittest

from go_issue_agent.benchmark.metrics import aggregate_scores, score_file_predictions
from go_issue_agent.repo_map.repo_map import search_repository_map


class BenchmarkMetricTests(unittest.TestCase):
    def test_score_file_predictions_computes_ranking_metrics(self):
        metrics = score_file_predictions(["a.go", "b.go", "c_test.go"], ["b.go", "c_test.go"])
        self.assertFalse(metrics["hitAt1"])
        self.assertTrue(metrics["hitAt5"])
        self.assertEqual(metrics["recallAt5"], 1)
        self.assertEqual(metrics["mrr"], 0.5)

    def test_aggregate_scores_uses_completed_cases_only(self):
        aggregate = aggregate_scores(
            [
                {
                    "status": "ok",
                    "metrics": {
                        "recallAt5": 1,
                        "recallAt10": 1,
                        "precisionAt5": 0.5,
                        "mrr": 1,
                        "hitAt1": True,
                        "hitAt5": True,
                    },
                },
                {"status": "failed"},
            ]
        )
        self.assertEqual(aggregate["total"], 2)
        self.assertEqual(aggregate["completed"], 1)
        self.assertEqual(aggregate["avgRecallAt5"], 1)

    def test_search_repository_map_ranks_symbol_matches(self):
        results = search_repository_map(
            {
                "files": [
                    {
                        "path": "baked_in.go",
                        "name": "baked_in.go",
                        "symbols": ["excludedIf"],
                        "tests": [],
                        "validators": ["excluded_if"],
                        "imports": [],
                        "headings": [],
                        "preview": "func excludedIf(fl FieldLevel) bool",
                    },
                    {
                        "path": "README.md",
                        "name": "README.md",
                        "symbols": [],
                        "tests": [],
                        "validators": [],
                        "imports": [],
                        "headings": ["Installation"],
                        "preview": "install",
                    },
                ]
            },
            "excluded_if excludedIf",
            limit=2,
        )
        self.assertEqual(results[0]["path"], "baked_in.go")


if __name__ == "__main__":
    unittest.main()
