import { describe, expect, it } from "vitest";
import packageJson from "../../package.json" with { type: "json" };
// The runtime architecture configuration is CommonJS and has no declaration file.
// @ts-expect-error importing the checked configuration is intentional.
import dependencyCruiser from "../../.dependency-cruiser.cjs";
import {
  actionEligibilitySchema,
  assessExperimentReadiness,
  assessHardConstraints,
  evaluateActionEligibility,
  experimentWhatSchema,
  hardConstraintSchema,
} from "../../src/index.js";

const architecture = dependencyCruiser as {
  forbidden: Array<{ name: string; from: { path: string }; to: { path: string } }>;
};

describe("experiment, constraint, and eligibility public boundaries", () => {
  it("exports operator contracts from the root and stable package subpaths", () => {
    expect([experimentWhatSchema, hardConstraintSchema, actionEligibilitySchema]).toEqual(expect.arrayContaining([expect.any(Object)]));
    expect([assessExperimentReadiness, assessHardConstraints, evaluateActionEligibility]).toEqual(expect.arrayContaining([expect.any(Function)]));
    expect(packageJson.exports).toMatchObject({
      "./experiment": "./dist/experiment/index.js",
      "./action-constraints": "./dist/action_constraints/index.js",
      "./action-eligibility": "./dist/action_eligibility/index.js",
    });
  });

  it("keeps decision modules away from hidden, evaluative, optimizing, and executing layers", () => {
    const rule = architecture.forbidden.find((candidate) => candidate.name === "experiment-eligibility-cannot-import-decision-or-execution-internals");
    expect(rule).toBeDefined();
    const from = new RegExp(rule!.from.path);
    const to = new RegExp(rule!.to.path);
    for (const source of ["src/experiment/schema.ts", "src/action_constraints/assessment.ts", "src/action_eligibility/evaluate.ts"])
      expect(from.test(source)).toBe(true);
    for (const forbidden of ["src/simulation/index.ts", "src/ground_truth/index.ts", "src/evaluation/index.ts", "src/ranking/index.ts", "src/optimizer/index.ts", "src/provider_execution/index.ts"])
      expect(to.test(forbidden)).toBe(true);
  });

  it("defines a focused verification command", () => {
    expect(packageJson.scripts["test:experiment-eligibility-constraints"]).toContain("tests/architecture");
  });
});
