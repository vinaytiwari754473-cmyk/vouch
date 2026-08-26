import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const sourceDirectory = dirname(fileURLToPath(import.meta.url));
const forbiddenImport = /(?:from\s+|import\s*\()["'][^"']*(?:@vouch\/(?:core|generator)|packages\/(?:core|generator)|data\/heldout|truth-manifest)[^"']*["']/;

describe("evaluation dependency boundary", () => {
  it("does not import the solver, generator, held-out data, or truth manifests", () => {
    const productionSources = readdirSync(sourceDirectory)
      .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
      .sort();

    for (const filename of productionSources) {
      const source = readFileSync(join(sourceDirectory, filename), "utf8");
      expect(source, filename).not.toMatch(forbiddenImport);
    }
  });

  it("declares no core or generator package dependency", () => {
    const packageJsonPath = join(sourceDirectory, "..", "package.json");
    const manifest = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const dependencies = { ...manifest.dependencies, ...manifest.devDependencies };

    expect(dependencies).not.toHaveProperty("@vouch/core");
    expect(dependencies).not.toHaveProperty("@vouch/generator");
  });
});
