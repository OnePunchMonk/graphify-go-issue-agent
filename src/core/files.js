import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const DEFAULT_IGNORES = new Set([
  ".git",
  "node_modules",
  "vendor",
  "dist",
  "build",
  "coverage",
  ".cache",
  "runs",
  "workspaces"
]);

export async function readText(path) {
  return await readFile(path, "utf8");
}

export async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2));
}

export async function writeText(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value);
}

export function walkFiles(root, options = {}) {
  const extensions = options.extensions ?? null;
  const ignores = new Set([...(options.ignores ?? []), ...DEFAULT_IGNORES]);
  const files = [];

  function walk(dir) {
    for (const entry of readdirSync(dir)) {
      if (ignores.has(entry)) {
        continue;
      }
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        walk(full);
      } else if (!extensions || extensions.some((ext) => entry.endsWith(ext))) {
        files.push({
          path: full,
          relativePath: relative(root, full),
          size: stat.size
        });
      }
    }
  }

  if (existsSync(root)) {
    walk(root);
  }
  return files;
}
