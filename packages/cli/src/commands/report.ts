import { resolve } from "node:path";

import { assertRunArtifactInvariants, type RunArtifact } from "@vouch/core";

import { readUtf8File, writeUtf8File } from "../files.js";
import { parseJson } from "../json.js";
import type { ReportOptions } from "../options.js";
import { auditEventsToCsv, renderStandaloneReport } from "../report.js";

export interface ReportCommandResult {
  readonly outputPath: string;
  readonly auditCsvPath: string | null;
}

export async function executeReportCommand(
  options: ReportOptions,
  cwd = process.cwd()
): Promise<ReportCommandResult> {
  const artifactPath = resolve(cwd, options.artifactFile);
  const artifact = parseJson(
    await readUtf8File(artifactPath, "run artifact"),
    artifactPath
  ) as RunArtifact;
  assertRunArtifactInvariants(artifact);
  const evaluation =
    options.evaluationFile === null
      ? null
      : parseJson(
          await readUtf8File(resolve(cwd, options.evaluationFile), "evaluation result"),
          options.evaluationFile
        );
  const outputPath = resolve(cwd, options.outputFile);
  await writeUtf8File(outputPath, renderStandaloneReport(artifact, evaluation), options);

  let auditCsvPath: string | null = null;
  if (options.auditCsvFile !== null) {
    auditCsvPath = resolve(cwd, options.auditCsvFile);
    await writeUtf8File(auditCsvPath, auditEventsToCsv(artifact), options);
  }
  return { outputPath, auditCsvPath };
}
