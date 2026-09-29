import { describe, expect, it } from "vitest";
import packageJson from "../../package.json" with { type: "json" };
// The checked runtime configuration is CommonJS and has no declaration file.
// @ts-expect-error importing it is intentional.
import dependencyCruiser from "../../.dependency-cruiser.cjs";
import {
  actionCharacteristicsSchema,
  actionConflictDefinitionSchema,
  actionDependencySchema,
  actionRiskMeasurementContractsSchema,
  assessActionDependencies,
  assessPortfolioCompatibility,
  describeActionRiskContracts,
  validateActionCharacteristics,
} from "../../src/index.js";

const architecture = dependencyCruiser as {
  forbidden: Array<{ name: string; from: { path: string }; to: { path: string } }>;
};

describe("Steps 19-22 public and architecture boundaries", () => {
  it("exports the four operator-safe contract families from the root and package subpaths", () => {
    expect([
      actionDependencySchema,
      actionConflictDefinitionSchema,
      actionCharacteristicsSchema,
      actionRiskMeasurementContractsSchema,
    ]).toEqual(expect.arrayContaining([expect.any(Object)]));
    expect([
      assessActionDependencies,
      assessPortfolioCompatibility,
      validateActionCharacteristics,
      describeActionRiskContracts,
    ]).toEqual(expect.arrayContaining([expect.any(Function)]));
    expect(packageJson.exports).toMatchObject({
      "./action-dependencies": "./dist/action_dependencies/index.js",
      "./action-conflicts": "./dist/action_conflicts/index.js",
      "./action-characteristics": "./dist/action_characteristics/index.js",
      "./action-risk": "./dist/action_risk/index.js",
    });
  });

  it("keeps portfolio contracts away from hidden, predictive, optimizing, and executing layers", () => {
    const rule = architecture.forbidden.find(
      (candidate) => candidate.name === "action-portfolio-cannot-import-hidden-or-execution-internals",
    );
    expect(rule).toBeDefined();
    const from = new RegExp(rule!.from.path);
    const to = new RegExp(rule!.to.path);
    for (const source of [
      "src/action_dependencies/assessment.ts",
      "src/action_conflicts/schema.ts",
      "src/action_characteristics/aggregate.ts",
      "src/action_risk/schema.ts",
    ]) expect(from.test(source)).toBe(true);
    for (const forbidden of [
      "src/simulation/index.ts",
      "src/ground_truth/index.ts",
      "src/evaluation/index.ts",
      "src/prediction/index.ts",
      "src/ranking/index.ts",
      "src/optimizer/index.ts",
      "src/provider_execution/index.ts",
    ]) expect(to.test(forbidden)).toBe(true);
  });

  it("keeps definition schemas below canonical and runtime assessment layers", () => {
    const rule = architecture.forbidden.find(
      (candidate) => candidate.name === "action-portfolio-schemas-cannot-import-upward",
    );
    expect(rule).toBeDefined();
    const from = new RegExp(rule!.from.path);
    const to = new RegExp(rule!.to.path);
    expect(from.test("src/action_dependencies/schema.ts")).toBe(true);
    for (const forbidden of [
      "src/canonical_action/schema.ts",
      "src/action_dependencies/assessment.ts",
      "src/action_translation/canonical.ts",
      "src/simulation/index.ts",
    ]) expect(to.test(forbidden)).toBe(true);
  });

  it("defines a focused verification command", () => {
    expect(packageJson.scripts["test:action-portfolio"]).toContain("tests/architecture");
    expect(packageJson.scripts["test:action-portfolio"]).toContain("tests/action_dependencies");
  });
});
