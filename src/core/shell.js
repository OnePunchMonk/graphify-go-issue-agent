import { spawn } from "node:child_process";

export async function runCommand(command, args = [], options = {}) {
  const {
    cwd,
    env,
    timeoutMs = 120_000,
    input,
    allowFailure = false
  } = options;

  return await new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      shell: false,
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const result = {
        command: [command, ...args].join(" "),
        cwd,
        code,
        signal,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
        ok: code === 0
      };
      if (!result.ok && !allowFailure) {
        const detail = stderr.trim() || stdout.trim() || `exit code ${code}`;
        reject(new Error(`${result.command} failed: ${detail}`));
      } else {
        resolve(result);
      }
    });

    if (input) {
      child.stdin.write(input);
    }
    child.stdin.end();
  });
}

export async function commandExists(command) {
  const result = await runCommand("command", ["-v", command], {
    allowFailure: true,
    timeoutMs: 5_000
  }).catch(() => ({ ok: false }));
  return result.ok;
}

export function splitShellCommand(command) {
  const tokens = [];
  let current = "";
  let quote = null;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
    } else if (char === "'" || char === "\"") {
      quote = char;
    } else if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }
  if (current) {
    tokens.push(current);
  }
  return tokens;
}
