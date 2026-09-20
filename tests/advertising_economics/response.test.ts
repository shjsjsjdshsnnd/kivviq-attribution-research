import { describe, expect, it } from "vitest";
import type { ResponseCurve } from "../../src/ground_truth/ontology.js";
import { generateMerchantWorldRecord } from "../../src/generation/generator.js";
import {
  buildAnalyticChannelEconomicCurve,
  evaluateResponseCurve,
  marginalResponsePerSpendMinor,
  responseEvaluation,
} from "../../src/advertising_economics/response.js";

describe("advertising response economics", () => {
  it("supports diminishing marginal returns on a saturating Hill curve", () => {
    const curve: ResponseCurve = {
      id: "hill",
      kind: "hill",
      inputUnit: "money_minor",
      outputUnit: "orders",
      maxIncrementalOutcome: 200 as never,
      halfSaturationSpend: 200_000 as never,
      hillCoefficient: 1.2 as never,
    };

    const one = evaluateResponseCurve(curve, 100_000);
    const two = evaluateResponseCurve(curve, 200_000);
    const four = evaluateResponseCurve(curve, 400_000);

    expect(two).toBeGreaterThan(one);
    expect(four).toBeGreaterThan(two);

    const m1 = marginalResponsePerSpendMinor(curve, 100_000, 20_000)!;
    const m2 = marginalResponsePerSpendMinor(curve, 200_000, 20_000)!;
    const m4 = marginalResponsePerSpendMinor(curve, 400_000, 20_000)!;

    expect(m1).toBeGreaterThan(m2);
    expect(m2).toBeGreaterThan(m4);
  });

  it("keeps average and marginal return explicitly separate", () => {
    const curve: ResponseCurve = {
      id: "hill",
      kind: "hill",
      inputUnit: "money_minor",
      outputUnit: "orders",
      maxIncrementalOutcome: 300 as never,
      halfSaturationSpend: 150_000 as never,
      hillCoefficient: 1.1 as never,
    };

    const evaluation = responseEvaluation(curve, 450_000, 25_000);
    expect(evaluation.averageOutcomePerSpendMinor).not.toBeNull();
    expect(evaluation.marginalOutcomePerSpendMinor).not.toBeNull();
    expect(evaluation.averageOutcomePerSpendMinor!).toBeGreaterThan(
      evaluation.marginalOutcomePerSpendMinor!,
    );
  });

  it("supports negative marginal returns without forcing total response negative", () => {
    const curve: ResponseCurve = {
      id: "negative-marginal",
      kind: "piecewise",
      inputUnit: "money_minor",
      outputUnit: "orders",
      points: [
        { spend: 0 as never, outcome: 0 },
        { spend: 100_000 as never, outcome: 80 },
        { spend: 200_000 as never, outcome: 125 },
        { spend: 300_000 as never, outcome: 140 },
        { spend: 500_000 as never, outcome: 118 },
      ],
    };

    expect(evaluateResponseCurve(curve, 500_000)).toBeGreaterThan(0);
    expect(
      marginalResponsePerSpendMinor(curve, 450_000, 20_000)!,
    ).toBeLessThan(0);
  });

  it("calculates average and marginal CAC from the frozen acquisition curve", () => {
    const world = generateMerchantWorldRecord({
      seed: 81001,
      archetype: "fashion_apparel",
      scale: "growth",
      complexity: "normal",
      marketingDependence: "paid_media_heavy",
    });

    const channel = world.manifest.cacMechanisms[0]?.channelId;
    expect(channel).toBeDefined();

    const economics = buildAnalyticChannelEconomicCurve(
      world,
      channel as never,
      {
        maxSpendMinor: 800_000,
        stepMinor: 40_000,
        marginalBlockMinor: 40_000,
      },
    );

    const withCac = economics.points.filter(
      (point) =>
        point.averageIncrementalCacMinor !== null &&
        point.marginalIncrementalCacMinor !== null,
    );

    expect(withCac.length).toBeGreaterThan(3);
    expect(
      withCac.some(
        (point) =>
          point.averageIncrementalCacMinor !==
          point.marginalIncrementalCacMinor,
      ),
    ).toBe(true);
  });

  it("finds evaluator-only contribution-profit and rational-spend regions", () => {
    const world = generateMerchantWorldRecord({
      seed: 81002,
      archetype: "beauty_cosmetics",
      scale: "growth",
      complexity: "complex",
      marketingDependence: "paid_media_heavy",
    });

    const channel =
      world.manifest.channelIncrementality.find(
        (mechanism) => mechanism.responseCurveId !== undefined,
      )!.channelId;

    const economics = buildAnalyticChannelEconomicCurve(
      world,
      channel as never,
      {
        maxSpendMinor: 1_500_000,
        stepMinor: 50_000,
      },
    );

    expect(economics.points.length).toBeGreaterThan(10);
    expect(
      economics.contributionProfitMaximizingSpendMinor,
    ).not.toBeNull();
    expect(economics.breakEvenRevenueRoas).not.toBeNull();
  });
});
