import { splitShellCommand, runCommand } from "../core/shell.js";

export class TesterAgent {
  constructor({ logger } = {}) {
    this.logger = logger;
  }

  async run(state) {
    const commands = [
      ...(state.plan.targetedCommands ?? []),
      ...(state.plan.standardCommands ?? [])
    ];
    const unique = [...new Set(commands.filter(Boolean))];
    const results = [];

    if (!state.options.runTests) {
      return {
        skipped: true,
        reason: "runTests=false",
        results
      };
    }

    for (const command of unique) {
      this.logger?.info(`Running validation: ${command}`);
      const [binary, ...args] = splitShellCommand(command);
      const result = await runCommand(binary, args, {
        cwd: state.repoPath,
        allowFailure: true,
        timeoutMs: state.options.testTimeoutMs ?? 300_000
      });
      results.push(result);
      if (!result.ok && state.options.stopOnFirstTestFailure) {
        break;
      }
    }

    return {
      skipped: false,
      results,
      ok: results.length > 0 && results.every((result) => result.ok)
    };
  }
}
