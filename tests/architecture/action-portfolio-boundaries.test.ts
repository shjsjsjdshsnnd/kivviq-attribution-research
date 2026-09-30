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
  forbidden: Array<{
    name: string;
    from: { path: string };
    to: { path: string; pathNot?: string };
  }>;
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

  it("limits assessments to canonical and public evidence/readiness contracts", () => {
    const rule = architecture.forbidden.find(
      (candidate) => candidate.name === "action-portfolio-assessments-use-public-contracts-only",
    );
    expect(rule).toBeDefined();
    const from = new RegExp(rule!.from.path);
    const allowed = new RegExp(rule!.to.pathNot!);
    expect(from.test("src/action_dependencies/assessment.ts")).toBe(true);
    expect(from.test("src/action_conflicts/assessment.ts")).toBe(true);
    expect(from.test("src/action_characteristics/aggregate.ts")).toBe(true);
    expect(from.test("src/action_characteristics/validation.ts")).toBe(true);
    expect(from.test("src/action_risk/aggregate.ts")).toBe(true);
    for (const publicContract of [
      "src/canonical_action/schema.ts",
      "src/action_constraints/assessment.ts",
      "src/action_eligibility/evaluate.ts",
      "src/experiment/readiness.ts",
      "src/investigation/index.ts",
    ]) expect(allowed.test(publicContract)).toBe(true);
    for (const upwardLayer of [
      "src/action_translation/canonical.ts",
      "src/simulator_intervention/index.ts",
      "src/pricing/translation.ts",
    ]) expect(allowed.test(upwardLayer)).toBe(false);
  });

  it("requires translation to use portfolio assessments instead of lower-level portfolio modules", () => {
    const rule = architecture.forbidden.find(
      (candidate) => candidate.name === "action-translation-must-use-portfolio-assessments",
    );
    expect(rule).toBeDefined();
    const from = new RegExp(rule!.from.path);
    const bypass = new RegExp(rule!.to.path);
    expect(from.test("src/action_translation/canonical.ts")).toBe(true);
    expect(bypass.test("src/action_dependencies/schema.ts")).toBe(true);
    expect(bypass.test("src/action_conflicts/adapters.ts")).toBe(true);
    expect(bypass.test("src/action_dependencies/assessment.ts")).toBe(false);
    expect(bypass.test("src/action_conflicts/assessment.ts")).toBe(false);
  });

  it("keeps the canonical envelope limited to portfolio definitions", () => {
    const rule = architecture.forbidden.find(
      (candidate) => candidate.name === "canonical-action-cannot-import-portfolio-runtime",
    );
    expect(rule).toBeDefined();
    expect(new RegExp(rule!.from.path).test("src/canonical_action/schema.ts")).toBe(true);
    const forbidden = new RegExp(rule!.to.path);
    expect(forbidden.test("src/action_dependencies/assessment.ts")).toBe(true);
    expect(forbidden.test("src/action_characteristics/validation.ts")).toBe(true);
    expect(forbidden.test("src/action_risk/aggregate.ts")).toBe(true);
    expect(forbidden.test("src/action_dependencies/schema.ts")).toBe(false);
  });

  it("defines a focused verification command", () => {
    expect(packageJson.scripts["test:action-portfolio"]).toContain("tests/architecture");
    expect(packageJson.scripts["test:action-portfolio"]).toContain("tests/action_dependencies");
    expect(packageJson.scripts["test:action-portfolio"]).toContain("tests/compatibility/action-portfolio-legacy.test.ts");
  });
});
