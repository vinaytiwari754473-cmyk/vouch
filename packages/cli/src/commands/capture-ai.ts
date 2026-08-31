import { resolve } from "node:path";

import { canonicalJson } from "@vouch/core";

import {
  buildInvestigationPacket,
  createCaptureRequest,
  deterministicInvestigationArtifact,
  hypothesesFromStructuredResponse,
  invokeCaptureProvider,
  modelProviderForAdapter,
  verifyCapturedHypotheses,
  type ProviderInvocation,
  type ProviderResult
} from "../ai-capture.js";
import { sha256Text, writeUtf8File } from "../files.js";
import { stablePrettyJson } from "../json.js";
import type { CaptureAiOptions } from "../options.js";
import { loadPublicInputs } from "../public-inputs.js";

export interface CaptureAiCommandResult {
  readonly captureId: string;
  readonly captureSha256: string;
  readonly capturePath: string;
  readonly adapter: CaptureAiOptions["provider"];
  readonly provider: "openai" | "anthropic";
  readonly model: string;
  readonly requestSha256: string;
  readonly responseId: string | null;
  readonly hypotheses: number;
  readonly verifiedHypotheses: number;
  readonly rejectedHypotheses: number;
  readonly assistedMatches: number;
}

export interface CaptureAiCommandDependencies {
  readonly invokeProvider: (invocation: ProviderInvocation) => Promise<ProviderResult>;
  readonly now: () => number;
}

const defaultDependencies: CaptureAiCommandDependencies = {
  invokeProvider: (invocation) => invokeCaptureProvider(invocation),
  now: Date.now
};

export async function executeCaptureAiCommand(
  options: CaptureAiOptions,
  cwd = process.cwd(),
  dependencies: CaptureAiCommandDependencies = defaultDependencies
): Promise<CaptureAiCommandResult> {
  const loaded = await loadPublicInputs(resolve(cwd, options.inputDirectory));
  const deterministic = deterministicInvestigationArtifact({
    runInput: loaded.input,
    runAtEpochSeconds: options.runAtEpochSeconds,
    postingWindowDays: options.postingWindowDays,
    minimumTruncatedUtrLength: options.minimumTruncatedUtrLength,
    knownUtrPrefixes: options.knownUtrPrefixes
  });
  const packet = buildInvestigationPacket(deterministic);
  if (packet.unresolved_bank_evidence.length === 0 || packet.candidate_settlements.length === 0) {
    throw new Error("no unresolved bank-to-settlement evidence is eligible for model investigation");
  }
  const model = resolveModel(options);
  const request = createCaptureRequest({
    provider: options.provider,
    model,
    promptVersion: options.promptVersion,
    inputBundleSha256: loaded.inputBundleSha256,
    packet,
    maxOutputTokens: options.maxOutputTokens,
    timeoutSeconds: options.timeoutSeconds,
    maxBudgetUsd: options.maxBudgetUsd
  });
  const requestSha256 = sha256Text(canonicalJson(request));
  const startedAtMilliseconds = dependencies.now();
  const providerResult = await dependencies.invokeProvider({
    provider: options.provider,
    model,
    maxOutputTokens: options.maxOutputTokens,
    timeoutMilliseconds: options.timeoutSeconds * 1_000,
    maxBudgetUsd: options.maxBudgetUsd,
    request
  });
  const completedAtMilliseconds = dependencies.now();
  const hypotheses = hypothesesFromStructuredResponse(providerResult.structuredResponse);
  const verifiedArtifact = verifyCapturedHypotheses({
    runInput: loaded.input,
    hypotheses,
    runAtEpochSeconds: options.runAtEpochSeconds,
    postingWindowDays: options.postingWindowDays,
    minimumTruncatedUtrLength: options.minimumTruncatedUtrLength,
    knownUtrPrefixes: options.knownUtrPrefixes
  });
  const verifiedHypotheses = verifiedArtifact.hypotheses.filter(
    (hypothesis) => hypothesis.status === "VERIFIED"
  ).length;
  const rejectedHypotheses = verifiedArtifact.hypotheses.filter(
    (hypothesis) => hypothesis.status === "REJECTED"
  ).length;
  const provider = modelProviderForAdapter(options.provider);
  const structuredResponseSha256 = sha256Text(canonicalJson(providerResult.structuredResponse));
  const rawResponseSha256 = sha256Text(canonicalJson(providerResult.rawResponse));
  const hypothesesSha256 = sha256Text(canonicalJson(hypotheses));
  const verdictsSha256 = sha256Text(canonicalJson(verifiedArtifact.hypotheses));
  const warnings = [
    "This is a live development capture, not part of the sealed demo until a human reviews and explicitly promotes its replay_candidate.",
    "The model response had no financial authority; deterministic verification and global matching were rerun after capture.",
    ...loaded.warnings
  ];
  const capturePayload = {
    captured_at: new Date(completedAtMilliseconds).toISOString(),
    provenance: {
      adapter: options.provider,
      provider,
      requested_model: model,
      reported_model: providerResult.reportedModel,
      provider_client_version: providerResult.providerClientVersion,
      response_id: providerResult.responseId,
      started_at: new Date(startedAtMilliseconds).toISOString(),
      completed_at: new Date(completedAtMilliseconds).toISOString(),
      latency_ms: Math.max(0, completedAtMilliseconds - startedAtMilliseconds),
      usage: {
        input_tokens: providerResult.usage.inputTokens,
        output_tokens: providerResult.usage.outputTokens,
        total_tokens: providerResult.usage.totalTokens
      },
      reported_cost_usd: providerResult.reportedCostUsd
    },
    public_input: {
      dataset_id: loaded.datasetId,
      input_bundle_sha256: loaded.inputBundleSha256,
      component_sha256: {
        razorpay_recon_json: loaded.componentSha256.razorpayReconJson,
        bank_statement_csv: loaded.componentSha256.bankStatementCsv,
        merchant_ledger_csv: loaded.componentSha256.merchantLedgerCsv
      }
    },
    request_sha256: requestSha256,
    request,
    response: {
      structured_sha256: structuredResponseSha256,
      raw_provider_response_sha256: rawResponseSha256,
      parsed_hypotheses_sha256: hypothesesSha256,
      structured: providerResult.structuredResponse,
      raw_provider_response: providerResult.rawResponse
    },
    deterministic_verification: {
      hypothesis_verdicts_sha256: verdictsSha256,
      artifact_id: verifiedArtifact.artifactId,
      summary: verifiedArtifact.summary,
      hypothesis_verdicts: verifiedArtifact.hypotheses
    },
    warnings
  };
  const captureSha256 = sha256Text(canonicalJson(capturePayload));
  const captureId = `capture_${captureSha256.slice(0, 24)}`;
  const capture = {
    schema_version: "vouch.ai-capture/1",
    capture_id: captureId,
    capture_sha256: captureSha256,
    ...capturePayload,
    replay_candidate: {
      input_bundle_sha256: loaded.inputBundleSha256,
      request_sha256: requestSha256,
      request,
      adapter: options.provider,
      provider,
      model: providerResult.reportedModel ?? model,
      prompt_version: options.promptVersion,
      capture_id: captureId,
      capture_sha256: captureSha256,
      response_sha256: hypothesesSha256,
      response: hypotheses
    }
  };
  const capturePath = resolve(cwd, options.outputFile);
  await writeUtf8File(capturePath, stablePrettyJson(capture), options);
  return {
    captureId,
    captureSha256,
    capturePath,
    adapter: options.provider,
    provider,
    model,
    requestSha256,
    responseId: providerResult.responseId,
    hypotheses: hypotheses.length,
    verifiedHypotheses,
    rejectedHypotheses,
    assistedMatches: verifiedArtifact.summary.assistedMatches
  };
}

function resolveModel(options: CaptureAiOptions): string {
  const explicit = options.model ?? process.env.VOUCH_MODEL_ID;
  if (explicit !== undefined && explicit.trim().length > 0) return explicit.trim();
  if (options.provider === "codex-cli") return "gpt-5.6-sol";
  if (options.provider === "claude-cli" || options.provider === "anthropic") {
    return "claude-fable-5";
  }
  return "gpt-5";
}
