#!/usr/bin/env node
import { pathToFileURL } from "node:url";

import { CliUsageError, parseCliOptions, usage } from "./options.js";

export async function main(arguments_ = process.argv.slice(2)): Promise<void> {
  try {
    const options = parseCliOptions(arguments_);
    if (options.command === "help") {
      process.stdout.write(`${usage(options.topic)}\n`);
      return;
    }
    if (options.command === "generate") {
      const { executeGenerateCommand } = await import("./commands/generate.js");
      const result = await executeGenerateCommand(options);
      printResult(result);
      return;
    }
    if (options.command === "run" || options.command === "demo") {
      const { executeRunCommand } = await import("./commands/run.js");
      const result = await executeRunCommand(options);
      for (const warning of result.warnings) process.stderr.write(`warning: ${warning}\n`);
      printResult({
        artifactId: result.artifact.artifactId,
        summary: result.artifact.summary,
        replayStatus: result.replayStatus,
        artifact: result.artifactPath,
        report: result.reportPath
      });
      return;
    }
    if (options.command === "eval") {
      const { executeEvaluationCommand } = await import("./commands/evaluate.js");
      printResult(await executeEvaluationCommand(options));
      return;
    }
    if (options.command === "report") {
      const { executeReportCommand } = await import("./commands/report.js");
      printResult(await executeReportCommand(options));
      return;
    }
    throw new CliUsageError(`unhandled command ${options.command}`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Vouch CLI error: ${detail}\n`);
    if (error instanceof CliUsageError) process.stderr.write(`${usage()}\n`);
    process.exitCode = 1;
  }
}

function printResult(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  await main();
}
