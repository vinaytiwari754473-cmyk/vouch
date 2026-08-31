import { canonicalJson, sha256Hex } from "@vouch/core";
import { describe, expect, it } from "vitest";

import { selectReplayHypotheses } from "./replay.js";

const bundle = "a".repeat(64);
const firstRequest = "1".repeat(64);
const secondRequest = "2".repeat(64);

describe("offline replay cache", () => {
  it("selects only exact-bundle responses in stable request-hash order", () => {
    const selected = selectReplayHypotheses(
      {
        schema_version: "vouch.replay/1",
        entries: [
          { input_bundle_sha256: bundle, request_sha256: secondRequest, response: { id: "second" } },
          { input_bundle_sha256: "b".repeat(64), request_sha256: "3".repeat(64), response: { id: "foreign" } },
          { input_bundle_sha256: bundle, request_sha256: firstRequest, response: { id: "first" } }
        ]
      },
      bundle
    );

    expect(selected).toEqual({
      status: "HIT",
      hypotheses: [{ id: "first" }, { id: "second" }],
      warnings: []
    });
  });

  it("degrades safely on an exact-bundle miss", () => {
    const selected = selectReplayHypotheses(
      {
        schema_version: "vouch.replay/1",
        entries: [
          { input_bundle_sha256: "b".repeat(64), request_sha256: firstRequest, response: {} }
        ]
      },
      bundle
    );

    expect(selected.status).toBe("MISS");
    expect(selected.hypotheses).toEqual([]);
    expect(selected.warnings[0]).toMatch(/deterministic evidence only/);
  });

  it("rejects malformed hashes and duplicate requests", () => {
    expect(() => selectReplayHypotheses({}, "not-a-sha")).toThrow(/SHA-256/);
    expect(() =>
      selectReplayHypotheses(
        {
          schema_version: "vouch.replay/1",
          entries: [
            { input_bundle_sha256: bundle, request_sha256: firstRequest, response: {} },
            { input_bundle_sha256: bundle, request_sha256: firstRequest, response: {} }
          ]
        },
        bundle
      )
    ).toThrow(/duplicate replay request/);
  });

  it("loads a reviewed batch capture as individual untrusted hypotheses", () => {
    const request = { schema_version: "vouch.ai-request/1", evidence: "public" };
    const response = [{ hypothesis_id: "one" }, { hypothesis_id: "two" }];
    const selected = selectReplayHypotheses(
      {
        schema_version: "vouch.replay/1",
        entries: [
          {
            input_bundle_sha256: bundle,
            request_sha256: sha256Hex(canonicalJson(request)),
            request,
            response_sha256: sha256Hex(canonicalJson(response)),
            response
          }
        ]
      },
      bundle
    );

    expect(selected.hypotheses).toEqual([{ hypothesis_id: "one" }, { hypothesis_id: "two" }]);
  });

  it("rejects a tampered captured request or response", () => {
    const request = { prompt: "bounded" };
    const response = [{ hypothesis_id: "one" }];
    const entry = {
      input_bundle_sha256: bundle,
      request_sha256: sha256Hex(canonicalJson(request)),
      request,
      response_sha256: sha256Hex(canonicalJson(response)),
      response
    };

    expect(() => selectReplayHypotheses({ schema_version: "vouch.replay/1", entries: [{ ...entry, request: { prompt: "changed" } }] }, bundle)).toThrow(/request SHA-256/);
    expect(() => selectReplayHypotheses({ schema_version: "vouch.replay/1", entries: [{ ...entry, response: [{ hypothesis_id: "changed" }] }] }, bundle)).toThrow(/response SHA-256/);
  });
});
