import { describe, expect, it } from "vitest";

import { CliUsageError, DEFAULT_RUN_AT_EPOCH_SECONDS, parseCliOptions } from "./options.js";

describe("CLI options", () => {
  it("uses a sealed offline replay configuration for demo", () => {
    expect(parseCliOptions(["demo"])).toMatchObject({
      command: "demo",
      mode: "hybrid",
      aiMode: "replay",
      runAtEpochSeconds: DEFAULT_RUN_AT_EPOCH_SECONDS,
      force: false
    });
  });

  it("accepts repeated allowlisted prefixes and equals syntax", () => {
    expect(
      parseCliOptions([
        "run",
        "--mode=deterministic",
        "--ai",
        "off",
        "--known-prefix",
        "HDFC",
        "--known-prefix=ICICI",
        "--posting-window",
        "2"
      ])
    ).toMatchObject({
      command: "run",
      mode: "deterministic",
      aiMode: "off",
      knownUtrPrefixes: ["HDFC", "ICICI"],
      postingWindowDays: 2
    });
  });

  it("fails closed on unsafe or unknown combinations", () => {
    expect(() => parseCliOptions(["run", "--mode", "baseline", "--ai", "replay"])).toThrow(
      /requires --mode hybrid/
    );
    expect(() => parseCliOptions(["run", "--tolerance", "50"])).toThrow(CliUsageError);
    expect(() => parseCliOptions(["ship"])).toThrow(/unknown command/);
  });

  it("keeps live capture explicit and separate from the offline demo", () => {
    expect(parseCliOptions(["capture-ai", "--provider", "codex-cli", "--model", "gpt-5.6-sol"]))
      .toMatchObject({
        command: "capture-ai",
        provider: "codex-cli",
        model: "gpt-5.6-sol",
        outputFile: "artifacts/ai-capture.json",
        maxBudgetUsd: "0.50"
      });
    expect(() => parseCliOptions(["capture-ai", "--max-budget-usd", "free"])).toThrow(
      /positive decimal/
    );
  });
});
