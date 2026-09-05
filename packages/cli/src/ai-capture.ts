import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";

import {
  canonicalJson,
  epochSeconds,
  runVouch,
  type RunArtifact,
  type RunConfig,
  type RunInput
} from "@vouch/core";

import { sha256Text } from "./files.js";
import { parseJson, requireRecord } from "./json.js";

export { AI_HYPOTHESIS_BATCH_SCHEMA, buildInvestigationPacket, createCaptureRequest } from '@vouch/core';
import { AI_HYPOTHESIS_BATCH_SCHEMA, type CaptureRequestDocument } from '@vouch/core';
export type { CaptureRequestDocument, InvestigationPacket } from '@vouch/core';
export type CaptureProvider = "codex-cli" | "claude-cli" | "anthropic" | "openai";
export type ModelProvider = "openai" | "anthropic";
export function modelProviderForAdapter(adapter: CaptureProvider): ModelProvider {
  return adapter === 'codex-cli' || adapter === 'openai' ? 'openai' : 'anthropic';
}

export interface ProviderInvocation {
  readonly provider: CaptureProvider;
  readonly model: string;
  readonly maxOutputTokens: number;
  readonly timeoutMilliseconds: number;
  readonly maxBudgetUsd: string;
  readonly request: CaptureRequestDocument;
}

export interface TokenUsage {
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly totalTokens: number | null;
}

export interface ProviderResult {
  readonly responseId: string | null;
  readonly reportedModel: string | null;
  readonly providerClientVersion: string | null;
  readonly usage: TokenUsage;
  readonly reportedCostUsd: number | null;
  readonly structuredResponse: unknown;
  readonly rawResponse: unknown;
}

export interface ProcessResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface ProviderRuntime {
  readonly fetch: typeof fetch;
  readonly runProcess: (
    command: string,
    arguments_: readonly string[],
    options: {
      readonly cwd: string;
      readonly stdin: string;
      readonly timeoutMilliseconds: number;
      readonly environment: NodeJS.ProcessEnv;
    }
  ) => Promise<ProcessResult>;
  readonly makeTemporaryDirectory: () => Promise<string>;
  readonly removeTemporaryDirectory: (directory: string) => Promise<void>;
}

export async function invokeCaptureProvider(
  invocation: ProviderInvocation,
  runtime: ProviderRuntime = defaultProviderRuntime
): Promise<ProviderResult> {
  if (invocation.provider === "anthropic") return invokeAnthropic(invocation, runtime.fetch);
  if (invocation.provider === "openai") return invokeOpenAi(invocation, runtime.fetch);
  return invokeCliProvider(invocation, runtime);
}

async function invokeAnthropic(
  invocation: ProviderInvocation,
  fetchImplementation: typeof fetch
): Promise<ProviderResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey === undefined || apiKey.trim().length === 0) {
    throw new Error("ANTHROPIC_API_KEY is required for --provider anthropic");
  }
  const response = await fetchWithTimeout(
    fetchImplementation,
    "https://api.anthropic.com/v1/messages",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: invocation.model,
        max_tokens: invocation.maxOutputTokens,
        system: invocation.request.supplied_instructions,
        messages: [{ role: "user", content: invocation.request.supplied_prompt }],
        output_config: {
          format: { type: "json_schema", schema: AI_HYPOTHESIS_BATCH_SCHEMA }
        }
      })
    },
    invocation.timeoutMilliseconds
  );
  const raw = await readProviderJson(response, "Anthropic Messages API");
  const record = requireRecord(raw, "Anthropic response");
  const content = Array.isArray(record.content) ? record.content : [];
  const textBlock = content
    .map((value, index) => requireRecord(value, `Anthropic response content[${index}]`))
    .find((value) => value.type === "text" && typeof value.text === "string");
  if (textBlock === undefined || typeof textBlock.text !== "string") {
    throw new Error("Anthropic response contains no structured text block");
  }
  return {
    responseId: typeof record.id === "string" ? record.id : null,
    reportedModel: typeof record.model === "string" ? record.model : null,
    providerClientVersion: "anthropic-messages/2023-06-01",
    usage: usageFromRecord(record.usage, "input_tokens", "output_tokens"),
    reportedCostUsd: null,
    structuredResponse: parseJson(textBlock.text, "Anthropic structured response"),
    rawResponse: raw
  };
}

async function invokeOpenAi(
  invocation: ProviderInvocation,
  fetchImplementation: typeof fetch
): Promise<ProviderResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey === undefined || apiKey.trim().length === 0) {
    throw new Error("OPENAI_API_KEY is required for --provider openai");
  }
  const response = await fetchWithTimeout(
    fetchImplementation,
    "https://api.openai.com/v1/responses",
    {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: invocation.model,
        store: false,
        instructions: invocation.request.supplied_instructions,
        input: invocation.request.supplied_prompt,
        max_output_tokens: invocation.maxOutputTokens,
        text: {
          format: {
            type: "json_schema",
            name: "vouch_hypotheses",
            strict: true,
            schema: AI_HYPOTHESIS_BATCH_SCHEMA
          }
        }
      })
    },
    invocation.timeoutMilliseconds
  );
  const raw = await readProviderJson(response, "OpenAI Responses API");
  const record = requireRecord(raw, "OpenAI response");
  const outputText = extractOpenAiOutputText(record);
  return {
    responseId: typeof record.id === "string" ? record.id : null,
    reportedModel: typeof record.model === "string" ? record.model : null,
    providerClientVersion: "openai-responses/1",
    usage: usageFromRecord(record.usage, "input_tokens", "output_tokens"),
    reportedCostUsd: null,
    structuredResponse: parseJson(outputText, "OpenAI structured response"),
    rawResponse: raw
  };
}

async function invokeCliProvider(
  invocation: ProviderInvocation,
  runtime: ProviderRuntime
): Promise<ProviderResult> {
  const directory = await runtime.makeTemporaryDirectory();
  try {
    const schemaPath = join(directory, "response-schema.json");
    const outputPath = join(directory, "last-message.json");
    await writeFile(schemaPath, JSON.stringify(AI_HYPOTHESIS_BATCH_SCHEMA), "utf8");
    const command = invocation.provider === "codex-cli" ? "codex" : "claude";
    const versionArguments = invocation.provider === "codex-cli" ? ["--version"] : ["--version"];
    const cleanEnvironment = environmentWithoutProviderSecrets(invocation.provider);
    const version = await runtime.runProcess(command, versionArguments, {
      cwd: directory,
      stdin: "",
      timeoutMilliseconds: 15_000,
      environment: cleanEnvironment
    });
    if (version.exitCode !== 0) throw new Error(`${command} --version failed: ${safeError(version.stderr)}`);

    const prompt = `${invocation.request.supplied_instructions}\n\n${invocation.request.supplied_prompt}`;
    const arguments_ =
      invocation.provider === "codex-cli"
        ? [
            "exec",
            "-",
            "--model",
            invocation.model,
            "--sandbox",
            "read-only",
            "--ephemeral",
            "--ignore-user-config",
            "--ignore-rules",
            "--disable", "shell_tool",
            "--disable", "apply_patch_freeform",
            "--disable", "multi_agent",
            "--disable", "js_repl",
            "--config", "web_search=\"disabled\"",
            "--config", "forced_login_method=\"chatgpt\"",
            "--skip-git-repo-check",
            "--cd",
            directory,
            "--output-schema",
            schemaPath,
            "--output-last-message",
            outputPath,
            "--json",
            "--color",
            "never"
          ]
        : [
            "-p",
            "--model",
            invocation.model,
            "--safe-mode",
            "--disable-slash-commands",
            "--tools",
            "",
            "--no-session-persistence",
            "--permission-mode",
            "dontAsk",
            "--output-format",
            "json",
            "--json-schema",
            JSON.stringify(AI_HYPOTHESIS_BATCH_SCHEMA),
            "--max-budget-usd",
            invocation.maxBudgetUsd
          ];
    const result = await runtime.runProcess(command, arguments_, {
      cwd: directory,
      stdin: prompt,
      timeoutMilliseconds: invocation.timeoutMilliseconds,
      environment: cleanEnvironment
    });
    if (result.exitCode !== 0) {
      throw new Error(`${command} capture failed with exit code ${result.exitCode}: ${safeError(result.stderr)}`);
    }
    return invocation.provider === "codex-cli"
      ? parseCodexCliResult(result, outputPath, version.stdout.trim())
      : parseClaudeCliResult(result, version.stdout.trim());
  } finally {
    await runtime.removeTemporaryDirectory(directory);
  }
}

async function parseCodexCliResult(
  result: ProcessResult,
  outputPath: string,
  version: string
): Promise<ProviderResult> {
  const events = result.stdout
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0)
    .map((line, index) => parseJson(line, `Codex JSONL event ${index + 1}`));
  const outputText = await readFile(outputPath, "utf8");
  const responseId = findStringInEvents(events, ["thread_id", "response_id"]);
  const usage = findCodexUsage(events);
  return {
    responseId,
    reportedModel: findStringInEvents(events, ["model"]),
    providerClientVersion: version,
    usage,
    reportedCostUsd: findNumberInEvents(events, ["total_cost_usd", "cost_usd"]),
    structuredResponse: parseJson(outputText, "Codex final structured response"),
    rawResponse: { events }
  };
}

function parseClaudeCliResult(result: ProcessResult, version: string): ProviderResult {
  const raw = parseJson(result.stdout, "Claude CLI response");
  const record = requireRecord(raw, "Claude CLI response");
  const structured =
    "structured_output" in record
      ? record.structured_output
      : typeof record.result === "string"
        ? parseJson(record.result, "Claude CLI structured result")
        : null;
  if (structured === null) throw new Error("Claude CLI response contains no structured output");
  return {
    responseId:
      typeof record.session_id === "string"
        ? record.session_id
        : typeof record.message_id === "string"
          ? record.message_id
          : null,
    reportedModel: typeof record.model === "string" ? record.model : null,
    providerClientVersion: version,
    usage: usageFromRecord(record.usage, "input_tokens", "output_tokens"),
    reportedCostUsd: typeof record.total_cost_usd === "number" ? record.total_cost_usd : null,
    structuredResponse: structured,
    rawResponse: raw
  };
}

export function hypothesesFromStructuredResponse(value: unknown): readonly unknown[] {
  const record = requireRecord(value, "model structured response");
  if (!Array.isArray(record.hypotheses)) {
    throw new TypeError("model structured response must contain a hypotheses array");
  }
  return record.hypotheses;
}

export function verifyCapturedHypotheses(input: {
  readonly runInput: RunInput;
  readonly hypotheses: readonly unknown[];
  readonly runAtEpochSeconds: number;
  readonly postingWindowDays: number;
  readonly minimumTruncatedUtrLength: number;
  readonly knownUtrPrefixes: readonly string[];
}): RunArtifact {
  const config: Partial<RunConfig> = {
    schemaVersion: "1",
    mode: "hybrid",
    aiMode: "live",
    inputProfile: "synthetic-v1",
    postingWindowDays: input.postingWindowDays,
    minimumTruncatedUtrLength: input.minimumTruncatedUtrLength,
    knownUtrPrefixes: input.knownUtrPrefixes,
    runAtEpochSeconds: epochSeconds(input.runAtEpochSeconds, "capture --clock")
  };
  return runVouch(input.runInput, config, input.hypotheses);
}

export function deterministicInvestigationArtifact(input: {
  readonly runInput: RunInput;
  readonly runAtEpochSeconds: number;
  readonly postingWindowDays: number;
  readonly minimumTruncatedUtrLength: number;
  readonly knownUtrPrefixes: readonly string[];
}): RunArtifact {
  return runVouch(input.runInput, {
    schemaVersion: "1",
    mode: "deterministic",
    aiMode: "off",
    inputProfile: "synthetic-v1",
    postingWindowDays: input.postingWindowDays,
    minimumTruncatedUtrLength: input.minimumTruncatedUtrLength,
    knownUtrPrefixes: input.knownUtrPrefixes,
    runAtEpochSeconds: epochSeconds(input.runAtEpochSeconds, "capture --clock")
  });
}

export const defaultProviderRuntime: ProviderRuntime = {
  fetch,
  runProcess,
  makeTemporaryDirectory: async () => mkdtemp(join(tmpdir(), "vouch-ai-capture-")),
  removeTemporaryDirectory: removeVerifiedTemporaryDirectory
};

async function fetchWithTimeout(
  fetchImplementation: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMilliseconds: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMilliseconds);
  try {
    return await fetchImplementation(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function readProviderJson(response: Response, label: string): Promise<unknown> {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${label} returned HTTP ${response.status}: ${safeError(text)}`);
  }
  return parseJson(text, label);
}

function extractOpenAiOutputText(response: Record<string, unknown>): string {
  if (!Array.isArray(response.output)) throw new Error("OpenAI response has no output array");
  for (const rawItem of response.output) {
    const item = requireRecord(rawItem, "OpenAI output item");
    if (!Array.isArray(item.content)) continue;
    for (const rawBlock of item.content) {
      const block = requireRecord(rawBlock, "OpenAI output content block");
      if (block.type === "output_text" && typeof block.text === "string") return block.text;
    }
  }
  throw new Error("OpenAI response contains no output_text block");
}

function usageFromRecord(
  raw: unknown,
  inputKey: string,
  outputKey: string
): TokenUsage {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { inputTokens: null, outputTokens: null, totalTokens: null };
  }
  const usage = raw as Record<string, unknown>;
  const inputTokens = integerOrNull(usage[inputKey]);
  const outputTokens = integerOrNull(usage[outputKey]);
  return {
    inputTokens,
    outputTokens,
    totalTokens:
      integerOrNull(usage.total_tokens) ??
      (inputTokens === null || outputTokens === null ? null : inputTokens + outputTokens)
  };
}

function findCodexUsage(events: readonly unknown[]): TokenUsage {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event === null || typeof event !== "object" || Array.isArray(event)) continue;
    const record = event as Record<string, unknown>;
    if (record.usage !== undefined) {
      const parsed = usageFromRecord(record.usage, "input_tokens", "output_tokens");
      if (parsed.inputTokens !== null || parsed.outputTokens !== null) return parsed;
    }
  }
  return { inputTokens: null, outputTokens: null, totalTokens: null };
}

function findStringInEvents(events: readonly unknown[], keys: readonly string[]): string | null {
  for (const event of events) {
    const found = findPrimitive(event, keys, "string");
    if (typeof found === "string") return found;
  }
  return null;
}

function findNumberInEvents(events: readonly unknown[], keys: readonly string[]): number | null {
  for (const event of events) {
    const found = findPrimitive(event, keys, "number");
    if (typeof found === "number" && Number.isFinite(found)) return found;
  }
  return null;
}

function findPrimitive(
  value: unknown,
  keys: readonly string[],
  expected: "string" | "number"
): string | number | null {
  if (value === null || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const child of value) {
      const found = findPrimitive(child, keys, expected);
      if (found !== null) return found;
    }
    return null;
  }
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    if (typeof record[key] === expected) return record[key] as string | number;
  }
  for (const child of Object.values(record)) {
    const found = findPrimitive(child, keys, expected);
    if (found !== null) return found;
  }
  return null;
}

function integerOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

async function runProcess(
  command: string,
  arguments_: readonly string[],
  options: {
    readonly cwd: string;
    readonly stdin: string;
    readonly timeoutMilliseconds: number;
    readonly environment: NodeJS.ProcessEnv;
  }
): Promise<ProcessResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, [...arguments_], {
      cwd: options.cwd,
      env: options.environment,
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const maximumBytes = 20 * 1024 * 1024;
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const append = (target: "stdout" | "stderr", chunk: Buffer): void => {
      if (target === "stdout") stdout += chunk.toString("utf8");
      else stderr += chunk.toString("utf8");
      if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > maximumBytes) {
        child.kill();
        finish(() => reject(new Error(`${command} output exceeded the 20 MiB safety limit`)));
      }
    };
    child.stdout.on("data", (chunk: Buffer) => append("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => append("stderr", chunk));
    child.on("error", (error) => finish(() => reject(error)));
    child.on("close", (code) =>
      finish(() => resolvePromise({ exitCode: code ?? -1, stdout, stderr }))
    );
    const timer = setTimeout(() => {
      child.kill();
      finish(() => reject(new Error(`${command} timed out after ${options.timeoutMilliseconds} ms`)));
    }, options.timeoutMilliseconds);
    child.stdin.end(options.stdin);
  });
}

function environmentWithoutProviderSecrets(provider: CaptureProvider): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  if (provider === "codex-cli") {
    delete environment.OPENAI_API_KEY;
    delete environment.CODEX_API_KEY;
    delete environment.ANTHROPIC_API_KEY;
  } else if (provider === "claude-cli") {
    // Claude subscription/keychain auth must not be shadowed by an invalid shell key.
    delete environment.ANTHROPIC_API_KEY;
    delete environment.OPENAI_API_KEY;
  }
  return environment;
}

async function removeVerifiedTemporaryDirectory(directory: string): Promise<void> {
  const resolvedDirectory = resolve(directory);
  const resolvedTemporaryRoot = `${resolve(tmpdir())}${sep}`;
  if (!resolvedDirectory.startsWith(resolvedTemporaryRoot) || !basename(resolvedDirectory).startsWith("vouch-ai-capture-")) {
    throw new Error(`refusing to remove unverified capture directory ${resolvedDirectory}`);
  }
  await rm(resolvedDirectory, { recursive: true, force: true });
}

function safeError(value: string): string {
  const compact = value.replace(/\s+/gu, " ").trim();
  return compact.length <= 500 ? compact : `${compact.slice(0, 497)}...`;
}
