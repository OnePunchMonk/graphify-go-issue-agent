export function createGraph({ repoRoot, source = "go-static" }) {
  return {
    schemaVersion: "0.1",
    source,
    generatedAt: new Date().toISOString(),
    repoRoot,
    nodes: [],
    edges: []
  };
}

export function addNode(graph, node) {
  if (!graph.nodes.some((existing) => existing.id === node.id)) {
    graph.nodes.push({
      metadata: {},
      ...node
    });
  }
}

export function addEdge(graph, edge) {
  if (!graph.edges.some((existing) => (
    existing.source === edge.source
    && existing.target === edge.target
    && existing.type === edge.type
  ))) {
    graph.edges.push({
      metadata: {},
      ...edge
    });
  }
}

export function graphStats(graph) {
  const byType = {};
  for (const node of graph.nodes) {
    byType[node.type] = (byType[node.type] ?? 0) + 1;
  }
  return {
    nodes: graph.nodes.length,
    edges: graph.edges.length,
    byType
  };
}

export function makeNodeId(type, parts) {
  return `${type}:${parts.filter(Boolean).join(":")}`;
}

export function renderGraphReport(graph) {
  const stats = graphStats(graph);
  const fileNodes = graph.nodes.filter((node) => node.type === "file");
  const highDegree = graph.nodes
    .map((node) => ({
      node,
      degree: graph.edges.filter((edge) => edge.source === node.id || edge.target === node.id).length
    }))
    .sort((left, right) => right.degree - left.degree)
    .slice(0, 12);

  const lines = [
    "# Graph Report",
    "",
    `Source: ${graph.source}`,
    `Generated: ${graph.generatedAt}`,
    "",
    "## Stats",
    "",
    `- Nodes: ${stats.nodes}`,
    `- Edges: ${stats.edges}`,
    ...Object.entries(stats.byType).map(([type, count]) => `- ${type}: ${count}`),
    "",
    "## High-Connectivity Nodes",
    "",
    ...highDegree.map(({ node, degree }) => `- ${node.name ?? node.id} (${node.type}) degree=${degree}${node.path ? ` path=${node.path}` : ""}`),
    "",
    "## Files Indexed",
    "",
    ...fileNodes.slice(0, 80).map((node) => `- ${node.path}`)
  ];

  return `${lines.join("\n")}\n`;
}
