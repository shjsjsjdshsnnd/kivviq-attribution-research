import { describe, expect, it } from "vitest";
import { generateMerchantWorldRecord } from "../../src/generation/generator.js";

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

describe("generation scale and difficulty semantics", () => {
  it("uses difficulty to alter structural complexity rather than random noise", () => {
    const simple = Array.from({ length: 120 }, (_, index) =>
      generateMerchantWorldRecord({
        seed: 500_000 + index,
        archetype: "home_furnishings_decor",
        scale: "growth",
        complexity: "simple",
      }),
    );
    const adversarial = Array.from({ length: 120 }, (_, index) =>
      generateMerchantWorldRecord({
        seed: 600_000 + index,
        archetype: "home_furnishings_decor",
        scale: "growth",
        complexity: "adversarial",
      }),
    );

    expect(
      mean(simple.map((world) => world.summary.activeChannels.length)),
    ).toBeLessThan(
      mean(adversarial.map((world) => world.summary.activeChannels.length)),
    );

    expect(
      mean(
        simple.map(
          (world) => world.manifest.channelInteractions.length,
        ),
      ),
    ).toBe(0);
    expect(
      mean(
        adversarial.map(
          (world) => world.manifest.channelInteractions.length,
        ),
      ),
    ).toBeGreaterThan(1);

    const simpleNonlinear = simple.reduce(
      (count, world) =>
        count +
        world.manifest.responseCurves.filter(
          (curve) =>
            curve.kind === "piecewise" || curve.kind === "threshold",
        ).length,
      0,
    );
    const adversarialNonlinear = adversarial.reduce(
      (count, world) =>
        count +
        world.manifest.responseCurves.filter(
          (curve) =>
            curve.kind === "piecewise" || curve.kind === "threshold",
        ).length,
      0,
    );

    expect(simpleNonlinear).toBe(0);
    expect(adversarialNonlinear).toBeGreaterThan(50);
  });

  it("uses scale to change business opportunity without fixing profitability", () => {
    const micro = Array.from({ length: 140 }, (_, index) =>
      generateMerchantWorldRecord({
        seed: 700_000 + index,
        archetype: "specialty_retail",
        scale: "micro",
        complexity: "normal",
      }),
    );
    const large = Array.from({ length: 140 }, (_, index) =>
      generateMerchantWorldRecord({
        seed: 800_000 + index,
        archetype: "specialty_retail",
        scale: "large",
        complexity: "normal",
      }),
    );

    expect(
      mean(micro.map((world) => world.summary.expectedAnnualOrders)),
    ).toBeLessThan(
      mean(large.map((world) => world.summary.expectedAnnualOrders)) / 30,
    );
    expect(
      mean(micro.map((world) => world.summary.annualRevenuePotentialMinor)),
    ).toBeLessThan(
      mean(
        large.map(
          (world) => world.summary.annualRevenuePotentialMinor,
        ),
      ) / 25,
    );
    expect(
      mean(micro.map((world) => world.summary.skuCount)),
    ).toBeLessThan(
      mean(large.map((world) => world.summary.skuCount)),
    );

    const microMargin = mean(
      micro.map(
        (world) => world.summary.expectedContributionMarginRate,
      ),
    );
    const largeMargin = mean(
      large.map(
        (world) => world.summary.expectedContributionMarginRate,
      ),
    );

    // Scale is intentionally not an input to the profitability equation.
    expect(Math.abs(microMargin - largeMargin)).toBeLessThan(0.08);
    expect(
      large.some(
        (world) => world.summary.expectedContributionMarginRate < 0,
      ),
    ).toBe(true);
    expect(
      micro.some(
        (world) => world.summary.expectedContributionMarginRate > 0.2,
      ),
    ).toBe(true);
  });

  it("represents both negative channels and negative marginal returns", () => {
    const worlds = Array.from({ length: 180 }, (_, index) =>
      generateMerchantWorldRecord({
        seed: 900_000 + index,
        archetype: "fashion_apparel",
        scale: "growth",
        complexity: "adversarial",
      }),
    );

    const negativeChannels = worlds.flatMap((world) =>
      world.manifest.channelIncrementality
        .filter((mechanism) => mechanism.effect.value < 0)
        .map((mechanism) => ({ world, mechanism })),
    );
    expect(negativeChannels.length).toBeGreaterThan(20);

    for (const { world, mechanism } of negativeChannels.slice(0, 20)) {
      const curve = world.manifest.responseCurves.find(
        (candidate) => candidate.id === mechanism.responseCurveId,
      );
      expect(curve?.kind).toBe("linear");
      expect(
        curve?.kind === "linear"
          ? curve.slopePerMoneyMinor
          : Number.POSITIVE_INFINITY,
      ).toBeLessThan(0);
      expect(
        world.manifest.cacMechanisms.some(
          (cac) => cac.channelId === mechanism.channelId,
        ),
      ).toBe(false);
    }

    const hasNegativeMarginalReturn = worlds.some((world) =>
      world.manifest.responseCurves.some((curve) => {
        if (curve.kind !== "piecewise") return false;
        const outcomes = curve.points.map((point) => point.outcome);
        return outcomes[outcomes.length - 1]! < Math.max(...outcomes);
      }),
    );
    expect(hasNegativeMarginalReturn).toBe(true);
  });
});
