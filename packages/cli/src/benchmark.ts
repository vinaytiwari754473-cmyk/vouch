#!/usr/bin/env node
import { cpus } from "node:os";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";

import {
  canonicalArtifactJson,
  epochSeconds,
  runVouch,
  sha256Hex,
  type RunConfig
} from "@vouch/core";
import { createPerformanceEnvelope } from "@vouch/eval";

import { writeUtf8File } from "./files.js";
import { DEFAULT_RUN_AT_EPOCH_SECONDS } from "./options.js";
import { loadPublicInputs } from "./public-inputs.js";
import { loadReplayHypotheses } from "./replay.js";

const WARMUP_RUNS = 5;
const MEASURED_RUNS = 30;

async function main(): Promise<void> {
  const cwd = process.cwd();
  const loaded = await loadPublicInputs(resolve(cwd, "data/dev/public"));
  const replay = await loadReplayHypotheses(
    resolve(cwd, "data/fixtures/replay-cache.json"),
    loaded.inputBundleSha256
  );
  if (replay.status !== "HIT") {
    throw new Error(`benchmark requires an exact replay-cache hit; observed ${replay.status}`);
  }

  const config: Partial<RunConfig> = {
    schemaVersion: "1",
    mode: "hybrid",
    aiMode: "replay",
    inputProfile: "synthetic-v1",
    postingWindowDays: 3,
    minimumTruncatedUtrLength: 10,
    knownUtrPrefixes: [],
    runAtEpochSeconds: epochSeconds(DEFAULT_RUN_AT_EPOCH_SECONDS, "benchmark clock")
  };

  for (let index = 0; index < WARMUP_RUNS; index += 1) {
    runVouch(loaded.input, config, replay.hypotheses);
  }

  const runtimesMs: number[] = [];
  let canonical = "";
  for (let index = 0; index < MEASURED_RUNS; index += 1) {
    const started = performance.now();
    const artifact = runVouch(loaded.input, config, replay.hypotheses);
    runtimesMs.push(performance.now() - started);
    const nextCanonical = canonicalArtifactJson(artifact);
    if (canonical !== "" && nextCanonical !== canonical) {
      throw new Error(`non-deterministic artifact observed at measured run ${index + 1}`);
    }
    canonical = nextCanonical;
  }

  const envelope = createPerformanceEnvelope({
    canonicalArtifactSha256: sha256Hex(canonical),
    recordedAtIso: new Date().toISOString(),
    environment: {
      label: "local development benchmark; synthetic sealed batch",
      nodeVersion: process.version,
      platform: process.platform,
      architecture: process.arch,
      cpu: cpus()[0]?.model ?? "unknown"
    },
    warmupRuns: WARMUP_RUNS,
    rowCount: 1083,
    runtimesMs
  });

  const outputPath = resolve(cwd, "data/dev/output/performance.json");
  await writeUtf8File(outputPath, `${JSON.stringify(envelope, null, 2)}\n`, { force: true });
  process.stdout.write(
    `${JSON.stringify({ outputPath, medianRuntimeMs: envelope.medianRuntimeMs, p95RuntimeMs: envelope.p95RuntimeMs, medianRowsPerSecond: envelope.medianRowsPerSecond }, null, 2)}\n`
  );
}

await main();
