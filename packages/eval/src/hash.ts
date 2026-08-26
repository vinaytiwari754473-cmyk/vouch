import { createHash } from "node:crypto";

import type { HeldoutBundle, HeldoutHashes, HeldoutProvenance } from "./types.js";

/** Canonical JSON with lexicographically sorted object keys and preserved array order. */
export function canonicalJson(value: unknown): string {
  return canonicalize(value, new Set<object>());
}

export function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hashCanonicalJson(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

export function createHeldoutBundle<TPublicInputs, TTruthManifest>(input: {
  readonly publicInputs: TPublicInputs;
  readonly truthManifest: TTruthManifest;
  readonly provenance: HeldoutProvenance;
}): HeldoutBundle<TPublicInputs, TTruthManifest> {
  const componentHashes = {
    publicInputsSha256: hashCanonicalJson(input.publicInputs),
    truthManifestSha256: hashCanonicalJson(input.truthManifest)
  };
  const bundleSha256 = hashCanonicalJson({
    schemaVersion: "1",
    provenance: input.provenance,
    ...componentHashes
  });

  return {
    schemaVersion: "1",
    publicInputs: input.publicInputs,
    truthManifest: input.truthManifest,
    provenance: input.provenance,
    hashes: { ...componentHashes, bundleSha256 }
  };
}

export function calculateHeldoutHashes<TPublicInputs, TTruthManifest>(
  bundle: Omit<HeldoutBundle<TPublicInputs, TTruthManifest>, "hashes">
): HeldoutHashes {
  const publicInputsSha256 = hashCanonicalJson(bundle.publicInputs);
  const truthManifestSha256 = hashCanonicalJson(bundle.truthManifest);
  const bundleSha256 = hashCanonicalJson({
    schemaVersion: bundle.schemaVersion,
    provenance: bundle.provenance,
    publicInputsSha256,
    truthManifestSha256
  });
  return { publicInputsSha256, truthManifestSha256, bundleSha256 };
}

export function verifyHeldoutBundleHashes<TPublicInputs, TTruthManifest>(
  bundle: HeldoutBundle<TPublicInputs, TTruthManifest>
): boolean {
  const calculated = calculateHeldoutHashes({
    schemaVersion: bundle.schemaVersion,
    publicInputs: bundle.publicInputs,
    truthManifest: bundle.truthManifest,
    provenance: bundle.provenance
  });

  return (
    calculated.publicInputsSha256 === bundle.hashes.publicInputsSha256 &&
    calculated.truthManifestSha256 === bundle.hashes.truthManifestSha256 &&
    calculated.bundleSha256 === bundle.hashes.bundleSha256
  );
}

function canonicalize(value: unknown, ancestors: Set<object>): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("canonical JSON does not support non-finite numbers");
    }
    return JSON.stringify(value);
  }
  if (typeof value === "bigint") {
    throw new TypeError("canonical JSON does not support bigint; serialize paise as decimal strings");
  }
  if (typeof value !== "object" || value === undefined) {
    throw new TypeError(`canonical JSON does not support ${typeof value}`);
  }
  if (ancestors.has(value)) {
    throw new TypeError("canonical JSON does not support cyclic values");
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((item) => canonicalize(item, ancestors)).join(",")}]`;
    }

    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("canonical JSON supports only arrays and plain objects");
    }

    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .map((key) => {
        const child = record[key];
        if (child === undefined) {
          throw new TypeError(`canonical JSON does not support undefined at key ${key}`);
        }
        return `${JSON.stringify(key)}:${canonicalize(child, ancestors)}`;
      });
    return `{${entries.join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}
