export const DEFAULT_RUN_AT_EPOCH_SECONDS = 1_787_639_400;

export type HelpTopic = "generate" | "run" | "demo" | "eval" | "report" | null;

export interface HelpOptions {
  readonly command: "help";
  readonly topic: HelpTopic;
}

export interface GenerateOptions {
  readonly command: "generate";
  readonly seed: string | undefined;
  readonly datasetId: string | undefined;
  readonly settlementCount: number | undefined;
  readonly rowsPerSettlement: number | undefined;
  readonly outputDirectory: string;
  readonly publicOnly: boolean;
  readonly force: boolean;
}

export interface RunOptions {
  readonly command: "run" | "demo";
  readonly inputDirectory: string;
  readonly outputArtifact: string;
  readonly outputReport: string;
  readonly replayFile: string;
  readonly mode: "baseline" | "deterministic" | "hybrid";
  readonly aiMode: "off" | "replay" | "live";
  readonly inputProfile: "synthetic-v1" | "foreign";
  readonly runAtEpochSeconds: number;
  readonly postingWindowDays: number;
  readonly minimumTruncatedUtrLength: number;
  readonly knownUtrPrefixes: readonly string[];
  readonly force: boolean;
}

export interface EvalOptions {
  readonly command: "eval";
  readonly inputDirectory: string;
  readonly truthFile: string;
  readonly baselineArtifact: string;
  readonly deterministicArtifact: string;
  readonly hybridArtifact: string;
  readonly outputFile: string;
  readonly force: boolean;
}

export interface ReportOptions {
  readonly command: "report";
  readonly artifactFile: string;
  readonly evaluationFile: string | null;
  readonly outputFile: string;
  readonly auditCsvFile: string | null;
  readonly force: boolean;
}

export type CliOptions = HelpOptions | GenerateOptions | RunOptions | EvalOptions | ReportOptions;

export class CliUsageError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

export function parseCliOptions(arguments_: readonly string[]): CliOptions {
  if (arguments_.length === 0 || arguments_[0] === "--help" || arguments_[0] === "-h") {
    return { command: "help", topic: null };
  }
  if (arguments_[0] === "help") {
    return { command: "help", topic: parseHelpTopic(arguments_[1]) };
  }

  const command = arguments_[0];
  if (command === undefined || !isCommand(command)) {
    throw new CliUsageError(`unknown command ${JSON.stringify(command)}; run vouch --help`);
  }
  if (arguments_.slice(1).some((argument) => argument === "--help" || argument === "-h")) {
    return { command: "help", topic: command };
  }
  const tokens = new OptionTokens(arguments_.slice(1));

  if (command === "generate") {
    const result: GenerateOptions = {
      command,
      seed: tokens.optional("--seed"),
      datasetId: tokens.optional("--dataset-id"),
      settlementCount: tokens.optionalInteger("--settlements", 1),
      rowsPerSettlement: tokens.optionalInteger("--rows-per-settlement", 1),
      outputDirectory: tokens.optional("--output") ?? "data/dev",
      publicOnly: tokens.flag("--public-only"),
      force: tokens.flag("--force")
    };
    tokens.assertEmpty();
    return result;
  }

  if (command === "run" || command === "demo") {
    const mode = tokens.optionalChoice("--mode", ["baseline", "deterministic", "hybrid"] as const) ??
      (command === "demo" ? "hybrid" : "hybrid");
    const explicitAi = tokens.optionalChoice("--ai", ["off", "replay", "live"] as const);
    const aiMode = explicitAi ?? (mode === "hybrid" ? "replay" : "off");
    const result: RunOptions = {
      command,
      inputDirectory: tokens.optional("--input") ?? "data/dev/public",
      outputArtifact: tokens.optional("--output") ?? "data/dev/output/run-artifact.json",
      outputReport: tokens.optional("--report") ?? "data/dev/output/report.html",
      replayFile: tokens.optional("--replay") ?? "data/fixtures/replay-cache.json",
      mode,
      aiMode,
      inputProfile: tokens.flag("--foreign") ? "foreign" : "synthetic-v1",
      runAtEpochSeconds:
        tokens.optionalInteger("--clock", 0) ?? DEFAULT_RUN_AT_EPOCH_SECONDS,
      postingWindowDays: tokens.optionalInteger("--posting-window", 0, 31) ?? 3,
      minimumTruncatedUtrLength: tokens.optionalInteger("--min-truncated-utr", 1) ?? 10,
      knownUtrPrefixes: tokens.repeated("--known-prefix"),
      force: tokens.flag("--force")
    };
    tokens.assertEmpty();
    if (result.aiMode !== "off" && result.mode !== "hybrid") {
      throw new CliUsageError("--ai replay/live requires --mode hybrid");
    }
    return result;
  }

  if (command === "eval") {
    const result: EvalOptions = {
      command,
      inputDirectory: tokens.optional("--input") ?? "data/dev/public",
      truthFile: tokens.optional("--truth") ?? "data/dev/truth/manifest.json",
      baselineArtifact:
        tokens.optional("--baseline") ?? "data/dev/output/baseline-artifact.json",
      deterministicArtifact:
        tokens.optional("--deterministic") ?? "data/dev/output/deterministic-artifact.json",
      hybridArtifact: tokens.optional("--hybrid") ?? "data/dev/output/run-artifact.json",
      outputFile: tokens.optional("--output") ?? "data/dev/output/evaluation.json",
      force: tokens.flag("--force")
    };
    tokens.assertEmpty();
    return result;
  }

  const result: ReportOptions = {
    command,
    artifactFile: tokens.optional("--artifact") ?? "data/dev/output/run-artifact.json",
    evaluationFile: tokens.optional("--evaluation") ?? null,
    outputFile: tokens.optional("--output") ?? "data/dev/output/report.html",
    auditCsvFile: tokens.optional("--audit-csv") ?? null,
    force: tokens.flag("--force")
  };
  tokens.assertEmpty();
  return result;
}

export function usage(topic: HelpTopic = null): string {
  if (topic === "generate") {
    return "Usage: vouch generate [--seed TEXT] [--dataset-id ID] [--output DIR] [--public-only] [--force]";
  }
  if (topic === "run" || topic === "demo") {
    return `Usage: vouch ${topic} [--input DIR] [--mode baseline|deterministic|hybrid] [--ai off|replay] [--replay FILE] [--clock EPOCH] [--output FILE] [--report FILE] [--force]`;
  }
  if (topic === "eval") {
    return "Usage: vouch eval [--input DIR] [--truth FILE] [--baseline FILE] [--deterministic FILE] [--hybrid FILE] [--output FILE] [--force]";
  }
  if (topic === "report") {
    return "Usage: vouch report [--artifact FILE] [--evaluation FILE] [--output FILE] [--audit-csv FILE] [--force]";
  }
  return [
    "Vouch — deterministic three-source settlement verification",
    "",
    "Commands:",
    "  generate   Create a seeded synthetic public batch and separate truth manifest",
    "  run        Run baseline, deterministic, or hybrid verification",
    "  demo       Offline hybrid run using the committed replay cache",
    "  eval       Score frozen artifacts against the independent truth manifest",
    "  report     Render a standalone HTML report from an artifact",
    "",
    "Run `vouch help <command>` for command options. Demo requires no API key."
  ].join("\n");
}

function isCommand(value: string): value is Exclude<HelpTopic, null> {
  return value === "generate" || value === "run" || value === "demo" || value === "eval" || value === "report";
}

function parseHelpTopic(value: string | undefined): HelpTopic {
  if (value === undefined) return null;
  if (!isCommand(value)) throw new CliUsageError(`unknown help topic ${JSON.stringify(value)}`);
  return value;
}

class OptionTokens {
  private readonly values = new Map<string, string[]>();
  private readonly flags = new Set<string>();

  public constructor(arguments_: readonly string[]) {
    for (let index = 0; index < arguments_.length; index += 1) {
      const argument = arguments_[index];
      if (argument === undefined || !argument.startsWith("--")) {
        throw new CliUsageError(`unexpected positional argument ${JSON.stringify(argument)}`);
      }
      const equals = argument.indexOf("=");
      if (equals !== -1) {
        const name = argument.slice(0, equals);
        const value = argument.slice(equals + 1);
        if (value.length === 0) throw new CliUsageError(`${name} requires a value`);
        this.addValue(name, value);
        continue;
      }
      const next = arguments_[index + 1];
      if (next === undefined || next.startsWith("--")) {
        if (this.flags.has(argument)) throw new CliUsageError(`duplicate flag ${argument}`);
        this.flags.add(argument);
        continue;
      }
      this.addValue(argument, next);
      index += 1;
    }
  }

  public optional(name: string): string | undefined {
    if (this.flags.delete(name)) {
      throw new CliUsageError(`${name} requires a value`);
    }
    const values = this.values.get(name);
    this.values.delete(name);
    if (values === undefined) return undefined;
    if (values.length !== 1) throw new CliUsageError(`${name} may be provided only once`);
    return values[0];
  }

  public repeated(name: string): readonly string[] {
    const values = this.values.get(name) ?? [];
    this.values.delete(name);
    return [...values];
  }

  public flag(name: string): boolean {
    const present = this.flags.delete(name);
    if (this.values.has(name)) throw new CliUsageError(`${name} does not accept a value`);
    return present;
  }

  public optionalChoice<const T extends readonly string[]>(name: string, choices: T): T[number] | undefined {
    const value = this.optional(name);
    if (value === undefined) return undefined;
    if (!choices.includes(value)) {
      throw new CliUsageError(`${name} must be one of ${choices.join(", ")}`);
    }
    return value as T[number];
  }

  public optionalInteger(name: string, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number | undefined {
    const value = this.optional(name);
    if (value === undefined) return undefined;
    if (!/^(?:0|[1-9]\d*)$/.test(value)) {
      throw new CliUsageError(`${name} must be a non-negative integer`);
    }
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
      throw new CliUsageError(`${name} must be between ${minimum} and ${maximum}`);
    }
    return parsed;
  }

  public assertEmpty(): void {
    const remaining = [...this.values.keys(), ...this.flags].sort();
    if (remaining.length !== 0) {
      throw new CliUsageError(`unknown option${remaining.length === 1 ? "" : "s"}: ${remaining.join(", ")}`);
    }
  }

  private addValue(name: string, value: string): void {
    const values = this.values.get(name) ?? [];
    values.push(value);
    this.values.set(name, values);
  }
}
