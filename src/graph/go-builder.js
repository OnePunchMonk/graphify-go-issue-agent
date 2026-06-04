import { basename } from "node:path";
import { readText, walkFiles } from "../core/files.js";
import { addEdge, addNode, createGraph, makeNodeId, renderGraphReport } from "./graph.js";

const CALL_EXCLUDES = new Set([
  "if",
  "for",
  "switch",
  "return",
  "range",
  "go",
  "defer",
  "select",
  "append",
  "make",
  "new",
  "len",
  "cap",
  "copy",
  "delete",
  "panic",
  "recover"
]);

export async function buildGoGraph(repoRoot) {
  const graph = createGraph({ repoRoot, source: "go-static-fallback" });
  const files = walkFiles(repoRoot, {
    extensions: [".go", ".md", ".txt", ".yaml", ".yml"]
  });
  const symbols = new Map();

  for (const file of files) {
    const content = await readText(file.path);
    const fileId = makeNodeId("file", [file.relativePath]);
    addNode(graph, {
      id: fileId,
      type: "file",
      name: basename(file.relativePath),
      path: file.relativePath,
      metadata: {
        bytes: file.size
      }
    });

    if (file.relativePath.endsWith(".go")) {
      extractGoFile(graph, symbols, file, content, fileId);
    } else {
      extractDocFile(graph, file, content, fileId);
    }
  }

  connectCalls(graph, symbols);
  graph.report = renderGraphReport(graph);
  graph.stats = {
    files: files.length
  };
  return graph;
}

function extractDocFile(graph, file, content, fileId) {
  const headingPattern = /^(#{1,6})\s+(.+)$/gm;
  for (const match of content.matchAll(headingPattern)) {
    const title = match[2].trim();
    const line = lineNumberAt(content, match.index);
    const nodeId = makeNodeId("doc-heading", [file.relativePath, title]);
    addNode(graph, {
      id: nodeId,
      type: "doc-heading",
      name: title,
      path: file.relativePath,
      line,
      metadata: {
        level: match[1].length
      }
    });
    addEdge(graph, { source: fileId, target: nodeId, type: "contains" });
  }
}

function extractGoFile(graph, symbols, file, content, fileId) {
  const packageMatch = content.match(/^package\s+([A-Za-z_][A-Za-z0-9_]*)/m);
  const packageName = packageMatch?.[1] ?? "unknown";
  const packageId = makeNodeId("package", [packageName]);
  addNode(graph, {
    id: packageId,
    type: "package",
    name: packageName,
    metadata: {}
  });
  addEdge(graph, { source: fileId, target: packageId, type: "declares_package" });

  const imports = extractImports(content);
  for (const importPath of imports) {
    const importId = makeNodeId("import", [importPath]);
    addNode(graph, {
      id: importId,
      type: "import",
      name: importPath,
      metadata: {}
    });
    addEdge(graph, { source: fileId, target: importId, type: "imports" });
  }

  const functionPattern = /^func\s+(?:\(([^)]*)\)\s*)?([A-Za-z_][A-Za-z0-9_]*)\s*\(/gm;
  for (const match of content.matchAll(functionPattern)) {
    const receiver = normaliseReceiver(match[1]);
    const name = match[2];
    const line = lineNumberAt(content, match.index);
    const qualified = receiver ? `${receiver}.${name}` : name;
    const nodeId = makeNodeId("function", [file.relativePath, qualified]);
    const body = extractFunctionBody(content, match.index);
    const calls = extractCalls(body);
    addNode(graph, {
      id: nodeId,
      type: file.relativePath.endsWith("_test.go") || name.startsWith("Test") ? "test" : "function",
      name: qualified,
      path: file.relativePath,
      line,
      metadata: {
        package: packageName,
        receiver,
        calls
      }
    });
    symbols.set(name, nodeId);
    symbols.set(qualified, nodeId);
    addEdge(graph, { source: fileId, target: nodeId, type: "contains" });
    addEdge(graph, { source: nodeId, target: packageId, type: "belongs_to" });
  }

  const mapEntryPattern = /^\s*"([^"]+)"\s*:\s*([A-Za-z_][A-Za-z0-9_]*),/gm;
  for (const match of content.matchAll(mapEntryPattern)) {
    const tag = match[1];
    const fn = match[2];
    if (!looksLikeValidatorTag(tag)) {
      continue;
    }
    const line = lineNumberAt(content, match.index);
    const tagId = makeNodeId("validator-tag", [tag]);
    addNode(graph, {
      id: tagId,
      type: "validator-tag",
      name: tag,
      path: file.relativePath,
      line,
      metadata: {
        implementation: fn
      }
    });
    addEdge(graph, { source: fileId, target: tagId, type: "contains" });
    addEdge(graph, { source: tagId, target: makeNodeId("symbol-ref", [fn]), type: "implemented_by" });
  }

  const regexPattern = /^var\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*regexp\.MustCompile\(/gm;
  for (const match of content.matchAll(regexPattern)) {
    const nodeId = makeNodeId("regex", [match[1]]);
    addNode(graph, {
      id: nodeId,
      type: "regex",
      name: match[1],
      path: file.relativePath,
      line: lineNumberAt(content, match.index),
      metadata: {}
    });
    addEdge(graph, { source: fileId, target: nodeId, type: "contains" });
  }
}

function connectCalls(graph, symbols) {
  const callableNodes = graph.nodes.filter((node) => node.metadata?.calls?.length);
  for (const node of callableNodes) {
    for (const call of node.metadata.calls) {
      const target = symbols.get(call);
      if (target) {
        addEdge(graph, { source: node.id, target, type: "calls" });
      }
    }
  }

  for (const edge of graph.edges.filter((item) => item.type === "implemented_by")) {
    const symbol = edge.target.replace(/^symbol-ref:/, "");
    const target = symbols.get(symbol);
    if (target) {
      edge.target = target;
    } else {
      addNode(graph, {
        id: edge.target,
        type: "symbol-ref",
        name: symbol,
        metadata: {}
      });
    }
  }
}

function extractImports(content) {
  const imports = [];
  const blockPattern = /import\s*\(([\s\S]*?)\)/m;
  const block = content.match(blockPattern);
  if (block) {
    for (const match of block[1].matchAll(/"([^"]+)"/g)) {
      imports.push(match[1]);
    }
  }
  for (const match of content.matchAll(/^import\s+"([^"]+)"/gm)) {
    imports.push(match[1]);
  }
  return [...new Set(imports)];
}

function extractCalls(body) {
  const calls = new Set();
  for (const match of body.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
    const name = match[1];
    if (!CALL_EXCLUDES.has(name)) {
      calls.add(name);
    }
  }
  return [...calls];
}

function extractFunctionBody(content, start) {
  const braceStart = content.indexOf("{", start);
  if (braceStart < 0) {
    return "";
  }
  let depth = 0;
  for (let index = braceStart; index < content.length; index += 1) {
    if (content[index] === "{") {
      depth += 1;
    } else if (content[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        return content.slice(braceStart, index + 1);
      }
    }
  }
  return content.slice(braceStart);
}

function normaliseReceiver(receiver) {
  if (!receiver) {
    return null;
  }
  const cleaned = receiver.replace(/\*/g, "").trim();
  const parts = cleaned.split(/\s+/);
  return parts[parts.length - 1] || null;
}

function lineNumberAt(content, index) {
  return content.slice(0, index).split("\n").length;
}

function looksLikeValidatorTag(tag) {
  return /^[a-z][a-z0-9_|\-.]+$/i.test(tag) && tag.length <= 80;
}
