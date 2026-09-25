// @ts-expect-error The project deliberately omits Node globals from its public type surface.
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

import * as operatorSafeApi from "../../src/index.js";
import * as validationApi from "../../src/validation/index.js";

const REPOSITORY_ROOT = new URL("../../", import.meta.url);
const OPERATOR_FACING_DIRECTORIES = [
  "operator",
  "observation",
  "action_ontology",
  "action_translation",
  "simulator_intervention",
  "paid_media",
  "pricing",
  "promotion",
  "shipping",
  "merchandising",
  "inventory",
] as const;

function sourceFilesBelow(directory: URL): URL[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(
    (entry: { readonly name: string; readonly isDirectory: () => boolean }) => {
      const child = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory);
      if (entry.isDirectory()) {
        return sourceFilesBelow(child);
      }
      return entry.name.endsWith(".ts") ? [child] : [];
    },
  );
}

describe("Step 3.11 validation architecture", () => {
  it("exposes the evaluator-owned validation API only through its package subpath", () => {
    const packageManifest = JSON.parse(
      readFileSync(new URL("package.json", REPOSITORY_ROOT), "utf8"),
    ) as { readonly exports: Readonly<Record<string, string>> };

    expect(packageManifest.exports["./validation"]).toBe("./dist/validation/index.js");
    expect(typeof validationApi.runBaselineValidationSuite).toBe("function");
    expect(typeof validationApi.createBaselineConformanceReport).toBe("function");
    expect("runBaselineValidationSuite" in operatorSafeApi).toBe(false);
    expect("createBaselineConformanceReport" in operatorSafeApi).toBe(false);
  });

  it("has an executable dependency rule forbidding reverse imports", () => {
    const dependencyRules = readFileSync(
      new URL(".dependency-cruiser.cjs", REPOSITORY_ROOT),
      "utf8",
    );

    expect(dependencyRules).toContain("operator-facing-code-cannot-import-validation");
    expect(dependencyRules).toContain('path: "^src/validation(/|$)"');
  });

  it("keeps evaluator validation imports out of every operator-facing module", () => {
    const violations = OPERATOR_FACING_DIRECTORIES.flatMap((directory) =>
      sourceFilesBelow(new URL(`src/${directory}/`, REPOSITORY_ROOT)).flatMap((file) => {
        const source = readFileSync(file, "utf8");
        return /(?:from\s+["'][^"']*\/validation(?:\/|["'])|import\s*\(\s*["'][^"']*\/validation(?:\/|["']))/.test(
          source,
        )
          ? [file.pathname]
          : [];
      }),
    );

    expect(violations).toEqual([]);
  });
});
