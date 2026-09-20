import { describe, expect, it } from "vitest";
import { generateMerchantWorldRecord } from "../../src/generation/generator.js";
import { generateCustomerPopulation } from "../../src/customer_population/generator.js";
import { validateGroundTruthManifest } from "../../src/ground_truth/manifest.js";
import { positive, moneyMinor } from "../../src/core/units.js";
import {
  buildPlatformChannelReport,
  SYNTHETIC_PLATFORM_RULES,
} from "../../src/advertising_economics/platform.js";
import {
  buildAdvertisingPerformanceReport,
  evaluateAverageTruePerformance,
  referenceSpendMinor,
} from "../../src/advertising_economics/evaluator.js";
import { simulateWorld } from "../../src/simulation/simulator.js";

function zeroInteractions<T extends ReturnType<typeof generateMerchantWorldRecord>>(
  world: T,
): T {
  const clone = structuredClone(world) as T;
  for (const interaction of clone.manifest.channelInteractions as any[]) {
    interaction.effect.value = 0;
  }
  validateGroundTruthManifest(clone.manifest);
  return clone;
}

function setPinterestTruth<T extends ReturnType<typeof generateMerchantWorldRecord>>(
  world: T,
  effectOrders: number,
): T {
  const clone = structuredClone(world) as T;
  const mechanism = (clone.manifest.channelIncrementality as any[]).find(
    (item) => item.channelId === "pinterest",
  );
  if (!mechanism) throw new Error("Pinterest missing");
  mechanism.effect.value = effectOrders;
  const index = (clone.manifest.responseCurves as any[]).findIndex(
    (curve) => curve.id === mechanism.responseCurveId,
  );
  (clone.manifest.responseCurves as any[])[index] = {
    id: mechanism.responseCurveId,
    kind: "hill",
    inputUnit: "money_minor",
    outputUnit: "orders",
    maxIncrementalOutcome: positive(Math.max(1, effectOrders * 3)),
    halfSaturationSpend: moneyMinor(160_000),
    hillCoefficient: positive(1.05),
  };
  mechanism.delay = {
    kind: "fixed",
    fixedSeconds: 5 * 86_400,
  };
  validateGroundTruthManifest(clone.manifest);
  return clone;
}

describe("measurement divergence", () => {
  it(
    "supports platform over-attribution when true channel effect is zero",
    () => {
      let world = generateMerchantWorldRecord({
        seed: 86001,
        archetype: "fashion_apparel",
        scale: "growth",
        complexity: "adversarial",
        overrides: {
          forceZeroIncrementalityChannels: ["meta"],
        },
      });
      world = zeroInteractions(world);

      const population = generateCustomerPopulation({
        merchantWorld: world,
        populationSeed: 96001,
        populationConfig: { maxExplicitAgents: 130 },
      });

      const spend = referenceSpendMinor(world, "meta");
      const request = {
        merchantWorld: world,
        latentPopulation: population,
        simulationSeed: 106001,
        periodStart: "2026-01-01T00:00:00.000Z",
        periodEnd: "2026-05-01T00:00:00.000Z",
        spendMinorByChannel: { meta: spend },
        simulationConfig: { maxEvents: 180_000 },
      } as const;

      const report = buildAdvertisingPerformanceReport(request);
      const meta = report.rows.find((row) => row.channel === "meta")!;

      expect(meta.trueIncrementalRevenueMinor).toBe(0);
      expect(meta.trueIncrementalRoas).toBe(0);
      expect(meta.platformAttributedRevenueMinor).toBeGreaterThan(0);
      expect(meta.platformRoas).not.toBeNull();
      expect(meta.platformRoas!).toBeGreaterThan(0);
    },
    90_000,
  );

  it(
    "supports under-attribution for delayed upper-funnel Pinterest effects",
    () => {
      let world = generateMerchantWorldRecord({
        seed: 86002,
        archetype: "home_furnishings_decor",
        scale: "growth",
        complexity: "complex",
        overrides: {
          forceZeroIncrementalityChannels: ["pinterest"],
        },
      });
      world = zeroInteractions(world);
      const monthly = world.summary.expectedAnnualOrders / 12;
      world = setPinterestTruth(world, monthly * 0.35);

      const population = generateCustomerPopulation({
        merchantWorld: world,
        populationSeed: 96002,
        populationConfig: { maxExplicitAgents: 150 },
      });

      const spend = 220_000;
      const request = {
        merchantWorld: world,
        latentPopulation: population,
        simulationSeed: 106002,
        periodStart: "2026-01-01T00:00:00.000Z",
        periodEnd: "2026-06-01T00:00:00.000Z",
        spendMinorByChannel: { pinterest: spend },
        simulationConfig: { maxEvents: 220_000 },
      } as const;

      const truePerformance = evaluateAverageTruePerformance(
        request,
        "pinterest",
      );
      expect(truePerformance.incrementalRevenueMinor).toBeGreaterThan(0);

      const simulation = simulateWorld({
        merchantWorld: world,
        latentPopulation: population,
        simulationSeed: request.simulationSeed,
        startTime: request.periodStart,
        endTime: request.periodEnd,
        interventions: [
          {
            variable: "marketing.pinterest.spend",
            operation: "set",
            value: {
              kind: "number",
              value: spend,
              unit: "money_minor",
            },
          },
        ],
        config: request.simulationConfig,
      });

      const narrowRule = {
        ...SYNTHETIC_PLATFORM_RULES.pinterest,
        clickWindowDays: 0,
        viewWindowDays: 0,
        allowViewThrough: false,
      };
      const platform = buildPlatformChannelReport(
        simulation,
        population,
        "pinterest",
        spend,
        narrowRule,
      );

      expect(platform.attributedRevenueMinor).toBeLessThan(
        truePerformance.incrementalRevenueMinor,
      );
    },
    90_000,
  );
});
