import { describe, expect, it } from "vitest";
import { hardConstraintSchema } from "../../src/index.js";
import packageJson from "../../package.json" with { type: "json" };

describe("action constraints public API", () => {
  it("exports the schema from the root and the package subpath", () => {
    expect(hardConstraintSchema).toBeDefined();

    expect(packageJson.exports["./action-constraints"]).toBe(
      "./dist/action_constraints/index.js",
    );
  });
});
