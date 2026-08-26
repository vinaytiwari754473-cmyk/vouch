import { resolve } from "node:path";

import type { JsonObject, RunArtifact } from "@vouch/core";
import { compareAiModes, scoreArtifact } from "@vouch/eval";

import { adaptGeneratorTruth, adaptRunArtifact, type GeneratorTruthShape } from "../eval-adapter.js";
import { readUtf8File, writeUtf8File } from "../files.js";
import { parseJson, stablePrettyJson } from "../json.js";
import type { EvalOptions } from "../options.js";
import { loadPublicInputs } from "../public-inputs.js";

export interface EvaluationCommandResult {
  readonly outputPath: string;
  readonly datasetId: string;
  readonly baselineFalseAutomatic: number;
  readonly deterministicFalseAutomatic: number;
  readonly hybridFalseAutomatic: number;
}

export async function executeEvaluationCommand(
  options: EvalOptions,
  cwd = process.cwd()
): Promise<EvaluationCommandResult> {
  const [loaded, rawTruth, baseline, deterministic, hybrid] = await Promise.all([
    loadPublicInputs(resolve(cwd, options.inputDirectory)),
    readJson<GeneratorTruthShape>(resolve(cwd, options.truthFile), "truth manifest"),
    readJson<RunArtifact>(resolve(cwd, options.baselineArtifact), "baseline artifact"),
    readJson<RunArtifact>(resolve(cwd, options.deterministicArtifact), "deterministic artifact"),
    readJson<RunArtifact>(resolve(cwd, options.hybridArtifact), "hybrid artifact")
  ]);
  if (rawTruth.schema_version !== "vouch-truth/v1") {
    throw new Error("truth manifest must use schema vouch-truth/v1");
  }
  if (loaded.datasetId !== null && loaded.datasetId !== rawTruth.dataset_id) {
    throw new Error("public manifest dataset ID does not match the truth manifest");
  }
  const truth = adaptGeneratorTruth(rawTruth, loaded.input.bankRows as readonly JsonObject[]);
  const baselineScore = scoreArtifact(adaptRunArtifact(baseline, truth.datasetId, "baseline"), truth);
  const deterministicScore = scoreArtifact(
    adaptRunArtifact(deterministic, truth.datasetId, "deterministic"),
    truth
  );
  const hybridScore = scoreArtifact(adaptRunArtifact(hybrid, truth.datasetId, "hybrid"), truth);
  const aiComparison = compareAiModes(deterministicScore, hybridScore, truth);
  const result = {
    schemaVersion: "vouch.evaluation/1",
    datasetId: truth.datasetId,
    labels: ["SYNTHETIC BENCHMARK", "NOT REAL MERCHANT PREVALENCE"],
    publicInputBundleSha256: loaded.inputBundleSha256,
    artifacts: {
      baseline: baseline.artifactId,
      deterministic: deterministic.artifactId,
      hybrid: hybrid.artifactId
    },
    scores: { baseline: baselineScore, deterministic: deterministicScore, hybrid: hybridScore },
    aiComparison
  };
  const outputPath = resolve(cwd, options.outputFile);
  await writeUtf8File(outputPath, stablePrettyJson(result), options);
  return {
    outputPath,
    datasetId: truth.datasetId,
    baselineFalseAutomatic: baselineScore.falseAutomaticVerificationCount,
    deterministicFalseAutomatic: deterministicScore.falseAutomaticVerificationCount,
    hybridFalseAutomatic: hybridScore.falseAutomaticVerificationCount
  };
}

async function readJson<T>(path: string, label: string): Promise<T> {
  return parseJson(await readUtf8File(path, label), path) as T;
}
