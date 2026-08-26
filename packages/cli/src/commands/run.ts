import { resolve } from "node:path";

import {
  canonicalArtifactJson,
  epochSeconds,
  runVouch,
  type RunArtifact,
  type RunConfig
} from "@vouch/core";

import { writeUtf8File } from "../files.js";
import type { RunOptions } from "../options.js";
import { loadPublicInputs } from "../public-inputs.js";
import { renderStandaloneReport } from "../report.js";
import { loadReplayHypotheses, type ReplayLoadStatus } from "../replay.js";

export interface RunCommandResult {
  readonly artifact: RunArtifact;
  readonly artifactPath: string;
  readonly reportPath: string;
  readonly replayStatus: ReplayLoadStatus | "OFF";
  readonly warnings: readonly string[];
}

export async function executeRunCommand(
  options: RunOptions,
  cwd = process.cwd()
): Promise<RunCommandResult> {
  if (options.aiMode === "live") {
    throw new Error(
      "Live model calls are intentionally absent from the reproducible CLI path. Capture a reviewed response into the replay cache, or use --ai off."
    );
  }
  const inputDirectory = resolve(cwd, options.inputDirectory);
  const loaded = await loadPublicInputs(inputDirectory);
  const replay =
    options.aiMode === "replay"
      ? await loadReplayHypotheses(resolve(cwd, options.replayFile), loaded.inputBundleSha256)
      : { status: "OFF" as const, hypotheses: [], warnings: [] };
  const config: Partial<RunConfig> = {
    schemaVersion: "1",
    mode: options.mode,
    aiMode: options.aiMode,
    inputProfile: options.inputProfile,
    postingWindowDays: options.postingWindowDays,
    minimumTruncatedUtrLength: options.minimumTruncatedUtrLength,
    knownUtrPrefixes: options.knownUtrPrefixes,
    runAtEpochSeconds: epochSeconds(options.runAtEpochSeconds, "CLI --clock")
  };
  const artifact = runVouch(loaded.input, config, replay.hypotheses);
  const artifactPath = resolve(cwd, options.outputArtifact);
  const reportPath = resolve(cwd, options.outputReport);
  await Promise.all([
    writeUtf8File(artifactPath, `${canonicalArtifactJson(artifact)}\n`, options),
    writeUtf8File(reportPath, renderStandaloneReport(artifact), options)
  ]);

  return {
    artifact,
    artifactPath,
    reportPath,
    replayStatus: replay.status,
    warnings: [...loaded.warnings, ...replay.warnings]
  };
}
