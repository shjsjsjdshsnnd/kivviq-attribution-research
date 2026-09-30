import { describe, expect, it } from "vitest";
import {
  ACTION_SPACE_VALIDATION_VERSION,
  actionOutcomePlanSchema,
  validateActionSpaceDecision,
} from "../../src/index.js";
import packageJson from "../../package.json" with { type: "json" };

describe("Action Space Steps 23-24 public API", () => {
  it("exports outcome and validation contracts from the root package", () => {
    expect(actionOutcomePlanSchema).toBeDefined();
    expect(validateActionSpaceDecision).toBeTypeOf("function");
    expect(ACTION_SPACE_VALIDATION_VERSION).toBe("1.0.0");
  });

  it("publishes dedicated package subpaths", () => {
    expect(packageJson.exports["./action-outcomes"]).toBe(
      "./dist/action_outcomes/index.js",
    );
    expect(packageJson.exports["./action-validation"]).toBe(
      "./dist/action_validation/index.js",
    );
  });
});
