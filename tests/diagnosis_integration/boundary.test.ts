import { createRequire } from "node:module";
import { describe, it, expect } from "vitest";
const require = createRequire(import.meta.url);
const config = require("../../.dependency-cruiser.cjs") as {
  forbidden: { name: string; severity: string; from: { path: string }; to: { path: string } }[];
};

describe("Diagnosis architecture guard", () => {
  const rule = config.forbidden.find(row => row.name === "operator-facing-code-cannot-import-god-mode")!;
  it("protects both the core and canonical adapter from evaluator imports", () => {
    expect(rule.severity).toBe("error");
    const from = new RegExp(rule.from.path), to = new RegExp(rule.to.path);
    for (const path of ["src/diagnosis/engine.ts", "src/diagnosis_integration/business-state.ts"]) expect(from.test(path)).toBe(true);
    for (const path of ["src/evaluation/oracle.ts", "src/ground_truth/index.ts", "src/simulation/index.ts", "src/measurement_corruption/index.ts"]) expect(to.test(path)).toBe(true);
  });
  it("permits only the intended observed Business State dependency path", () => {
    const to = new RegExp(rule.to.path);
    for (const path of ["src/business_state/schema.ts", "src/business_state/metric-registry.ts", "src/diagnosis/engine.ts"]) expect(to.test(path)).toBe(false);
  });
});
