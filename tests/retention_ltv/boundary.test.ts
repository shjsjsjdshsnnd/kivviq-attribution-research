import {
  describe,
  expect,
  it,
} from "vitest";
import * as operatorRoot from "../../src/index.js";
import {
  generateMerchantWorldRecord,
} from "../../src/generation/generator.js";
import {
  defaultRetentionLtvScenario,
} from "../../src/retention_ltv/runtime.js";

describe("Step 11 information boundary", () => {
  it("does not export retention oracle/evaluator truth from the Operator-safe root", () => {
    expect(
      "evaluateRetentionLtvEconomics" in
        operatorRoot,
    ).toBe(false);
    expect(
      "evaluateAcquisitionChannelCounterfactual" in
        operatorRoot,
    ).toBe(false);
  });

  it("uses merchant-aware lifecycle cadence instead of a universal 30-day lapse rule", () => {
    const furniture =
      generateMerchantWorldRecord({
        seed: 311010,
        archetype: "furniture",
        scale: "growth",
        complexity: "normal",
        purchaseFrequency: "infrequent",
      });
    const replenishment =
      generateMerchantWorldRecord({
        seed: 311011,
        archetype: "replenishment_heavy",
        scale: "growth",
        complexity: "normal",
        purchaseFrequency: "replenishment",
      });
    const furnitureScenario =
      defaultRetentionLtvScenario(
        furniture,
      );
    const replenishmentScenario =
      defaultRetentionLtvScenario(
        replenishment,
      );

    expect(
      furnitureScenario
        .lapseAfterExpectedIntervals!,
    ).toBeGreaterThan(
      replenishmentScenario
        .lapseAfterExpectedIntervals!,
    );
  });
});
