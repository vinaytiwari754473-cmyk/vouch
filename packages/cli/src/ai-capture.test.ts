import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AI_HYPOTHESIS_BATCH_SCHEMA,
  createCaptureRequest,
  hypothesesFromStructuredResponse,
  invokeCaptureProvider,
  type ProviderInvocation,
  type ProviderRuntime
} from "./ai-capture.js";

const hypothesis = {
  schema_version: "1",
  hypothesis_id: "hyp_test",
  subject_bank_entry_id: "bank_one",
  hypothesis_type: "UTR_FORMAT_VARIANT",
  candidate_ids: ["setl_one"],
  evidence_row_ids: ["bank_row_one"],
  confidence: 0.8,
  requested_tests: [
    "NORMALIZED_UTR_MATCH",
    "EXACT_AMOUNT_MATCH",
    "POSTING_WINDOW_MATCH",
    "LEDGER_PRESENCE_CHECK"
  ],
  literal_spans: [
    { evidence_row_id: "bank_row_one", field: "narration", start: 0, end: 4, text: "HDFC" }
  ]
};

function invocation(provider: ProviderInvocation["provider"]): ProviderInvocation {
  const request = createCaptureRequest({
    provider,
    model: "model-test",
    promptVersion: "vouch-investigator/test",
    inputBundleSha256: "a".repeat(64),
    packet: {
      schema_version: "vouch.investigation/1",
      unresolved_bank_evidence: [],
      candidate_settlements: []
    },
    maxOutputTokens: 1_024,
    timeoutSeconds: 30,
    maxBudgetUsd: "0.10"
  });
  return {
    provider,
    model: "model-test",
    maxOutputTokens: 1_024,
    timeoutMilliseconds: 30_000,
    maxBudgetUsd: "0.10",
    request
  };
}
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("provider-neutral AI capture", () => {
  it("calls Anthropic Messages with the exact schema and captures raw provenance", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-secret-that-must-not-be-persisted");
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body.output_config).toEqual({
        format: { type: "json_schema", schema: AI_HYPOTHESIS_BATCH_SCHEMA }
      });
      expect(JSON.stringify(body)).not.toContain("test-secret-that-must-not-be-persisted");
      return new Response(
        JSON.stringify({
          id: "msg_test",
          model: "claude-test",
          content: [{ type: "text", text: JSON.stringify({ hypotheses: [hypothesis] }) }],
          usage: { input_tokens: 120, output_tokens: 80 }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    const runtime = noProcessRuntime(fetchMock as unknown as typeof fetch);
    const result = await invokeCaptureProvider(invocation("anthropic"), runtime);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/messages",
      expect.objectContaining({ method: "POST" })
    );
    expect(result).toMatchObject({
      responseId: "msg_test",
      reportedModel: "claude-test",
      usage: { inputTokens: 120, outputTokens: 80, totalTokens: 200 },
      structuredResponse: { hypotheses: [hypothesis] }
    });
  });

  it("calls OpenAI Responses with store disabled and parses output_text", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-openai-secret");
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body.store).toBe(false);
      expect(body.text).toEqual({
        format: {
          type: "json_schema",
          name: "vouch_hypotheses",
          strict: true,
          schema: AI_HYPOTHESIS_BATCH_SCHEMA
        }
      });
      return new Response(
        JSON.stringify({
          id: "resp_test",
          model: "gpt-test",
          output: [
            {
              type: "message",
              content: [
                { type: "output_text", text: JSON.stringify({ hypotheses: [hypothesis] }) }
              ]
            }
          ],
          usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 }
        }),
        { status: 200 }
      );
    });
    const result = await invokeCaptureProvider(
      invocation("openai"),
      noProcessRuntime(fetchMock as unknown as typeof fetch)
    );

    expect(result.responseId).toBe("resp_test");
    expect(result.usage.totalTokens).toBe(150);
    expect(hypothesesFromStructuredResponse(result.structuredResponse)).toEqual([hypothesis]);
  });

  it("runs Codex in an isolated ephemeral read-only directory and records JSONL usage", async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), "vouch-ai-capture-test-"));
    const calls: { command: string; arguments_: readonly string[]; stdin: string }[] = [];
    const runtime: ProviderRuntime = {
      fetch,
      makeTemporaryDirectory: async () => temporaryDirectory,
      removeTemporaryDirectory: async (directory) => rm(directory, { recursive: true, force: true }),
      runProcess: async (command, arguments_, options) => {
        calls.push({ command, arguments_, stdin: options.stdin });
        if (arguments_[0] === "--version") {
          return { exitCode: 0, stdout: "codex-cli 0.test\n", stderr: "" };
        }
        const outputIndex = arguments_.indexOf("--output-last-message");
        const outputPath = arguments_[outputIndex + 1];
        if (outputPath === undefined) throw new Error("missing output path in test invocation");
        await writeFile(outputPath, JSON.stringify({ hypotheses: [hypothesis] }), "utf8");
        return {
          exitCode: 0,
          stdout: [
            JSON.stringify({ type: "thread.started", thread_id: "thread_test" }),
            JSON.stringify({
              type: "turn.completed",
              usage: { input_tokens: 111, output_tokens: 22, total_tokens: 133 }
            })
          ].join("\n"),
          stderr: ""
        };
      }
    };
    const result = await invokeCaptureProvider(invocation("codex-cli"), runtime);
    const executeCall = calls[1];

    expect(executeCall?.command).toBe("codex");
    expect(executeCall?.arguments_).toEqual(
      expect.arrayContaining([
        "--sandbox",
        "read-only",
        "--ephemeral",
        "--ignore-user-config",
        "--ignore-rules",
        "--skip-git-repo-check"
      ])
    );
    expect(executeCall?.stdin).toContain("<UNTRUSTED_PUBLIC_DATA>");
    expect(result).toMatchObject({
      responseId: "thread_test",
      providerClientVersion: "codex-cli 0.test",
      usage: { inputTokens: 111, outputTokens: 22, totalTokens: 133 }
    });
  });
});

function noProcessRuntime(fetchImplementation: typeof fetch): ProviderRuntime {
  return {
    fetch: fetchImplementation,
    runProcess: async () => {
      throw new Error("process runner was not expected");
    },
    makeTemporaryDirectory: async () => {
      throw new Error("temporary directory was not expected");
    },
    removeTemporaryDirectory: async () => undefined
  };
}
