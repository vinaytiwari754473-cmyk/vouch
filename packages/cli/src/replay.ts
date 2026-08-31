import { canonicalJson, sha256Hex } from "@vouch/core";

import { readOptionalUtf8File } from "./files.js";
import { parseJson, requireRecord } from "./json.js";

const SHA256 = /^[a-f0-9]{64}$/;

export type ReplayLoadStatus = "HIT" | "MISS" | "INVALID";

export interface ReplaySelection {
  readonly status: ReplayLoadStatus;
  readonly hypotheses: readonly unknown[];
  readonly warnings: readonly string[];
}

export async function loadReplayHypotheses(
  path: string,
  inputBundleSha256: string
): Promise<ReplaySelection> {
  const text = await readOptionalUtf8File(path);
  if (text === null) {
    return {
      status: "MISS",
      hypotheses: [],
      warnings: [`Replay cache not found at ${path}; continuing safely with deterministic evidence only.`]
    };
  }
  try {
    return selectReplayHypotheses(parseJson(text, path), inputBundleSha256);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown replay error";
    return {
      status: "INVALID",
      hypotheses: [],
      warnings: [`Replay cache was ignored (${detail}); continuing safely with deterministic evidence only.`]
    };
  }
}

export function selectReplayHypotheses(
  value: unknown,
  inputBundleSha256: string
): ReplaySelection {
  if (!SHA256.test(inputBundleSha256)) throw new TypeError("input bundle SHA-256 is invalid");
  const cache = requireRecord(value, "replay cache");
  if (cache.schema_version !== "vouch.replay/1" || !Array.isArray(cache.entries)) {
    throw new TypeError("replay cache must use schema vouch.replay/1 with an entries array");
  }

  const matches: { requestHash: string; response: unknown }[] = [];
  const seenRequests = new Set<string>();
  cache.entries.forEach((raw, index) => {
    const entry = requireRecord(raw, `replay cache entries[${index}]`);
    if (
      typeof entry.input_bundle_sha256 !== "string" ||
      !SHA256.test(entry.input_bundle_sha256) ||
      typeof entry.request_sha256 !== "string" ||
      !SHA256.test(entry.request_sha256) ||
      !("response" in entry)
    ) {
      throw new TypeError(`replay cache entries[${index}] is malformed`);
    }
    if ("request" in entry) {
      const recomputedRequest = sha256Hex(canonicalJson(entry.request));
      if (recomputedRequest !== entry.request_sha256) {
        throw new TypeError(`replay cache entries[${index}] request SHA-256 does not match its request`);
      }
    }
    if ("response_sha256" in entry) {
      if (typeof entry.response_sha256 !== "string" || !SHA256.test(entry.response_sha256)) {
        throw new TypeError(`replay cache entries[${index}] response SHA-256 is malformed`);
      }
      const recomputedResponse = sha256Hex(canonicalJson(entry.response));
      if (recomputedResponse !== entry.response_sha256) {
        throw new TypeError(`replay cache entries[${index}] response SHA-256 does not match its response`);
      }
    }
    if ("capture_sha256" in entry &&
      (typeof entry.capture_sha256 !== "string" || !SHA256.test(entry.capture_sha256))) {
      throw new TypeError(`replay cache entries[${index}] capture SHA-256 is malformed`);
    }
    if (seenRequests.has(entry.request_sha256)) {
      throw new TypeError(`duplicate replay request ${entry.request_sha256}`);
    }
    seenRequests.add(entry.request_sha256);
    if (entry.input_bundle_sha256 === inputBundleSha256) {
      matches.push({ requestHash: entry.request_sha256, response: entry.response });
    }
  });

  if (matches.length === 0) {
    return {
      status: "MISS",
      hypotheses: [],
      warnings: [
        "Replay cache has no response for this exact public-input bundle; continuing safely with deterministic evidence only."
      ]
    };
  }

  matches.sort((left, right) => left.requestHash.localeCompare(right.requestHash));
  return {
    status: "HIT",
    hypotheses: matches.flatMap((item) =>
      Array.isArray(item.response) ? item.response : [item.response]
    ),
    warnings: []
  };
}
