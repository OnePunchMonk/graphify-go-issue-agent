import unittest
from pathlib import Path

from go_issue_agent.graph.go_builder import build_go_graph
from go_issue_agent.graph.retriever import retrieve_issue_context


ROOT = Path(__file__).resolve().parents[1]


class GraphBuilderTests(unittest.TestCase):
    def test_build_go_graph_extracts_functions_tests_tags_and_regexes(self):
        repo_path = ROOT / "fixtures" / "tiny-validator"
        graph = build_go_graph(str(repo_path))

        self.assertEqual(graph["source"], "go-static-fallback")
        self.assertTrue(any(node["type"] == "function" and node["name"] == "isHostnameRFC1123" for node in graph["nodes"]))
        self.assertTrue(any(node["type"] == "test" and node["name"] == "TestHostnameRFC1123Validation" for node in graph["nodes"]))
        self.assertTrue(any(node["type"] == "validator-tag" and node["name"] == "hostname_rfc1123" for node in graph["nodes"]))
        self.assertTrue(any(node["type"] == "regex" and node["name"] == "hostnameRegex" for node in graph["nodes"]))
        self.assertTrue(any(edge["type"] == "implemented_by" for edge in graph["edges"]))

    def test_retrieve_issue_context_ranks_validator_files(self):
        repo_path = ROOT / "fixtures" / "tiny-validator"
        graph = build_go_graph(str(repo_path))
        context = retrieve_issue_context(
            graph=graph,
            repo_path=str(repo_path),
            issue={
                "title": "hostname_rfc1123 accepts 277.168.0.1",
                "body": "The hostname_rfc1123 validation should reject invalid dotted decimal strings.",
            },
            intent={"symbols": ["hostname_rfc1123", "isHostnameRFC1123"], "candidateFiles": ["baked_in.go", "validator_test.go"]},
        )

        self.assertTrue(any(file["path"] == "baked_in.go" for file in context["files"]))
        self.assertTrue(any(file["path"] == "validator_test.go" for file in context["files"]))
        self.assertTrue(any(node["name"] == "hostname_rfc1123" for node in context["graphNodes"]))


if __name__ == "__main__":
    unittest.main()
