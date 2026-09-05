import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createCaptureRequest } from '@vouch/core';
import { GEMINI_MODEL, geminiWireSchema, invokeGemini, parseGeminiResponse } from './gemini-provider';
const captured = JSON.parse(readFileSync(new URL('../../../artifacts/ai-capture.json', import.meta.url), 'utf8'));
export const geminiFixture = {
  candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(captured.response.structured) }] } }],
  modelVersion: GEMINI_MODEL, responseId: 'gemini-test-response',
  usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 400, totalTokenCount: 1500 },
};
const request = createCaptureRequest({ provider: 'gemini', model: GEMINI_MODEL, promptVersion: 'test', inputBundleSha256: 'a'.repeat(64), packet: { schema_version: 'vouch.investigation/1', unresolved_bank_evidence: [], candidate_settlements: [] }, maxOutputTokens: 4096, timeoutSeconds: 60, maxBudgetUsd: '0' });
describe('Gemini HTTP adapter', () => {
  it('uses a server header secret, a constrained schema and one no-tools request', async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(String(_url)).not.toContain('test-secret');
      expect(init?.headers).toMatchObject({ 'x-goog-api-key': 'test-secret' });
      const body = JSON.parse(String(init?.body));
      expect(body).not.toHaveProperty('tools');
      expect(String(init?.body)).not.toContain('test-secret');
      expect(body.generationConfig).toMatchObject({ maxOutputTokens: 4096, thinkingConfig: { thinkingLevel: 'LOW', includeThoughts: false }, responseFormat: { text: { mimeType: 'APPLICATION_JSON' } } });
      expect(body.generationConfig.responseFormat.text.schema).toEqual(geminiWireSchema(request.output_schema));
      expect(body.generationConfig).not.toHaveProperty('responseMimeType');
      expect(body.generationConfig).not.toHaveProperty('responseJsonSchema');
      expect(body.generationConfig).not.toHaveProperty('candidateCount');
      expect(body.generationConfig).not.toHaveProperty('temperature');
      expect(body.generationConfig.thinkingConfig).not.toHaveProperty('thinkingBudget');
      return Response.json(geminiFixture);
    });
    const result = await invokeGemini(request, 'test-secret', fetcher as typeof fetch);
    expect(fetcher).toHaveBeenCalledTimes(1); expect(result.hypotheses).toHaveLength(2);
    expect(result.totalTokens).toBe(1500); // Provider total includes thinking, not just visible output.
    expect(result.reportedModel).toBe(GEMINI_MODEL);
    expect(geminiWireSchema({ const: '1', maxLength: 5, type: 'string' })).toEqual({ enum: ['1'], type: 'string' });
    expect(geminiWireSchema({ type: 'array', maxItems: 12, minItems: 1, items: { type: 'string' } })).toEqual({ type: 'array', items: { type: 'string' } });
  });
  it('rejects truncation, blocks, thought-only output and malformed structure', () => {
    for (const finishReason of ['MAX_TOKENS', 'SAFETY']) expect(() => parseGeminiResponse({ ...geminiFixture, candidates: [{ ...geminiFixture.candidates[0], finishReason }] })).toThrow();
    expect(() => parseGeminiResponse({ ...geminiFixture, promptFeedback: { blockReason: 'SAFETY' } })).toThrow();
    expect(() => parseGeminiResponse({ ...geminiFixture, candidates: [{ finishReason: 'STOP', content: { parts: [{ thought: true, text: '{"hypotheses":[]}' }] } }] })).toThrow();
    expect(() => parseGeminiResponse({ ...geminiFixture, candidates: [] })).toThrow();
  });
  it('keeps the timeout active while reading the response body', async () => {
    const fetcher: typeof fetch = async (_url, init) => new Response(new ReadableStream({ start(controller) { init?.signal?.addEventListener('abort', () => controller.error(new Error('body aborted')), { once: true }); } }));
    await expect(invokeGemini(request, 'test-secret', fetcher, undefined, 10)).rejects.toThrow('body aborted');
  });
  it('never retries provider quota failure or accepts oversized output', async () => {
    const fail = vi.fn(async () => new Response('private provider error', { status: 429 }));
    await expect(invokeGemini(request, 'test-secret', fail)).rejects.toThrow('429'); expect(fail).toHaveBeenCalledTimes(1);
    await expect(invokeGemini(request, 'test-secret', async () => new Response('x'.repeat(262145)))).rejects.toThrow('size limit');
  });
});
