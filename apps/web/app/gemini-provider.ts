import { z } from 'zod';
import type { CaptureRequestDocument } from '@vouch/core';

export const GEMINI_MODEL = 'gemini-3.5-flash';
export const GEMINI_TIMEOUT_MS = 60000;
export const GEMINI_OUTPUT_TOKENS = 4096;
const count = z.number().int().nonnegative().optional();
const responseSchema = z.object({
  promptFeedback: z.object({ blockReason: z.string().optional() }).optional(),
  candidates: z.array(z.object({
    finishReason: z.string(),
    content: z.object({ parts: z.array(z.object({ text: z.string().optional(), thought: z.boolean().optional() }).passthrough()) }),
  })).length(1),
  modelVersion: z.string().max(128).optional(), responseId: z.string().max(256).optional(),
  usageMetadata: z.object({ promptTokenCount: count, candidatesTokenCount: count, totalTokenCount: count }).optional(),
});

/** Provider-compatible subset; the original strict schema still governs local verification. */
export function geminiWireSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(geminiWireSchema);
  if (!value || typeof value !== 'object') return value;
  // Nested bounded arrays can exceed the provider's grammar-state limit. The original
  // schema, scope checks and output-byte ceiling still enforce all bounds after generation.
  return Object.fromEntries(Object.entries(value).filter(([key]) => !['minLength', 'maxLength', 'minItems', 'maxItems'].includes(key)).map(([key, item]) => key === 'const' ? ['enum', [item]] : [key, geminiWireSchema(item)]));
}

export function parseGeminiResponse(raw: unknown) {
  const response = responseSchema.parse(raw);
  if (response.promptFeedback?.blockReason) throw new Error('Gemini blocked this request');
  const candidate = response.candidates[0]!;
  if (candidate.finishReason !== 'STOP') throw new Error('Gemini response was incomplete or blocked');
  const text = candidate.content.parts.filter(part => !part.thought && typeof part.text === 'string').map(part => part.text).join('');
  if (!text || new TextEncoder().encode(text).byteLength > 65536) throw new Error('Gemini returned no bounded structured response');
  const parsed = z.object({ hypotheses: z.array(z.unknown()).max(12) }).strict().parse(JSON.parse(text));
  return {
    hypotheses: parsed.hypotheses, reportedModel: response.modelVersion ?? null, responseId: response.responseId ?? null,
    inputTokens: response.usageMetadata?.promptTokenCount ?? null, outputTokens: response.usageMetadata?.candidatesTokenCount ?? null,
    totalTokens: response.usageMetadata?.totalTokenCount ?? null,
  };
}

/** Exact provider body, without credentials, also recorded in the exported audit session. */
export function buildGeminiBody(request: CaptureRequestDocument) {
  return {
    systemInstruction: { parts: [{ text: request.supplied_instructions }] },
    contents: [{ role: 'user', parts: [{ text: request.supplied_prompt }] }],
    generationConfig: { maxOutputTokens: GEMINI_OUTPUT_TOKENS,
      thinkingConfig: { thinkingLevel: 'LOW', includeThoughts: false },
      // REST uses the protobuf enum here, not the SDK's application/json shorthand.
      responseFormat: { text: { mimeType: 'APPLICATION_JSON', schema: geminiWireSchema(request.output_schema) } } },
  };
}

/** No tools, retries, user-controlled URLs or API key in the request URL/body. */
export async function invokeGemini(request: CaptureRequestDocument, key: string, fetcher: typeof fetch = fetch, signal?: AbortSignal, timeoutMs = GEMINI_TIMEOUT_MS) {
  if (!key.trim()) throw new Error('Gemini key is not configured');
  if (request.model !== GEMINI_MODEL) throw new Error('Unsupported hosted model');
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
  if (signal?.aborted) controller.abort();
  try {
    const response = await fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
      method: 'POST', signal: controller.signal,
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(buildGeminiBody(request)),
    });
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Gemini request failed (${response.status})`); }
    const reader = response.body?.getReader(); if (!reader) throw new Error('Gemini returned no response');
    const decoder = new TextDecoder(); let body = ''; let bytes = 0;
    try {
      while (true) {
        const part = await reader.read(); if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > 262144) throw new Error('Gemini response exceeded the size limit');
        body += decoder.decode(part.value, { stream: true });
      }
      body += decoder.decode();
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    const raw: unknown = JSON.parse(body);
    return { ...parseGeminiResponse(raw), raw };
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
