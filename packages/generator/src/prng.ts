const UINT32_RANGE = 0x1_0000_0000;

function fnv1a32(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Integer-only xorshift32 stream with no ambient randomness or clock access. */
export class SeededIntegerRng {
  readonly streamName: string;
  private state: number;

  constructor(seed: string, streamName: string) {
    this.streamName = streamName;
    const derived = fnv1a32(`${seed}\u241f${streamName}`);
    this.state = derived === 0 ? 0x6d2b79f5 : derived;
  }

  nextUint32(): number {
    let value = this.state;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.state = value >>> 0;
    return this.state;
  }

  int(minInclusive: number, maxExclusive: number): number {
    if (!Number.isSafeInteger(minInclusive) || !Number.isSafeInteger(maxExclusive)) {
      throw new Error("PRNG bounds must be safe integers");
    }
    const width = maxExclusive - minInclusive;
    if (width <= 0 || width > UINT32_RANGE) {
      throw new Error("PRNG bounds must define a positive uint32-sized range");
    }
    return minInclusive + (this.nextUint32() % width);
  }

  chance(numerator: number, denominator: number): boolean {
    if (
      !Number.isSafeInteger(numerator) ||
      !Number.isSafeInteger(denominator) ||
      numerator < 0 ||
      denominator <= 0 ||
      numerator > denominator
    ) {
      throw new Error("Chance must be a valid integer fraction");
    }
    return this.int(0, denominator) < numerator;
  }

  pick<T>(values: readonly T[]): T {
    if (values.length === 0) {
      throw new Error("Cannot pick from an empty collection");
    }
    const value = values[this.int(0, values.length)];
    if (value === undefined) {
      throw new Error("PRNG produced an out-of-bounds index");
    }
    return value;
  }

  digits(length: number): string {
    let output = "";
    for (let index = 0; index < length; index += 1) {
      output += String(this.int(0, 10));
    }
    return output;
  }

  token(length: number): string {
    const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
    let output = "";
    for (let index = 0; index < length; index += 1) {
      output += alphabet[this.int(0, alphabet.length)];
    }
    return output;
  }
}

export const RNG_STREAM_NAMES = [
  "identifiers",
  "money",
  "descriptions",
  "corruptions",
] as const;

export type RngStreamName = (typeof RNG_STREAM_NAMES)[number];

export function createRngStreams(seed: string): Record<RngStreamName, SeededIntegerRng> {
  return {
    identifiers: new SeededIntegerRng(seed, "identifiers"),
    money: new SeededIntegerRng(seed, "money"),
    descriptions: new SeededIntegerRng(seed, "descriptions"),
    corruptions: new SeededIntegerRng(seed, "corruptions"),
  };
}
