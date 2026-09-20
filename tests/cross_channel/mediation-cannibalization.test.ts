import { describe, expect, it } from "vitest";
import {
  createCannibalizationFixture,
  createMediationFixture,
  createPortfolioReallocationTrapFixture,
} from "../../src/cross_channel/adversarial.js";
import {
  decomposePairwiseInteraction,
  evaluateChannelRemoval,
  evaluatePairwiseInteraction,
} from "../../src/cross_channel/evaluator.js";
import type {
  CrossChannelFixture,
  PortfolioEvaluationRequest,
} from "../../src/cross_channel/types.js";

function request(
  fixture: CrossChannelFixture,
  end = "2026-06-01T00:00:00.000Z",
): PortfolioEvaluationRequest {
  return {
    merchantWorld: fixture.merchantWorld,
    latentPopulation: fixture.latentPopulation,
    simulationSeed: fixture.simulationSeed,
    periodStart: "2026-01-01T00:00:00.000Z",
    periodEnd: end,
    spendMinorByChannel: {},
    simulationConfig: {
      maxEvents: 300_000,
      maxSessionsPerCustomer: 22,
    },
  };
}

function sourceDelta(
  evaluation: ReturnType<typeof evaluateChannelRemoval>,
  source: string,
) {
  return evaluation.delta.sourceMetrics.find(
    (metric) => metric.source === source,
  );
}

describe("Step 6 mediated demand and cannibalization", () => {
  it(
    "removing Meta reduces branded-Search readiness and Google observed performance",
    () => {
      const fixture = createMediationFixture();
      const removal = evaluateChannelRemoval(
        request(fixture),
        "meta",
      );

      const google = sourceDelta(
        removal,
        "google_search",
      );

      expect(
        removal.delta.futureAudience
          .representedBrandedSearchReady,
      ).toBeLessThan(0);
      expect(google).toBeDefined();
      expect(
        (google!.sessionsDelta < 0) ||
          (google!.attributedRevenueMinorDelta < 0),
      ).toBe(true);

      expect(
        removal.factual.simulation.godMode.interactionEffects.some(
          (effect) =>
            effect.mechanismId ===
            "step6_meta_branded_search",
        ),
      ).toBe(true);
    },
    90_000,
  );

  it(
    "removing Pinterest reduces delayed Organic/Direct opportunity",
    () => {
      const fixture = createMediationFixture();
      const removal = evaluateChannelRemoval(
        request(fixture),
        "pinterest",
      );

      const organic = sourceDelta(
        removal,
        "organic_search",
      );
      const direct = sourceDelta(
        removal,
        "direct",
      );

      expect(
        (organic?.sessionsDelta ?? 0) < 0 ||
          (direct?.sessionsDelta ?? 0) < 0,
      ).toBe(true);

      expect(
        removal.factual.simulation.godMode.interactionEffects.some(
          (effect) =>
            effect.mechanismId ===
            "step6_pinterest_organic_direct",
        ),
      ).toBe(true);
    },
    90_000,
  );

  it(
    "paid Search removal shifts some customer journeys into Direct/Organic",
    () => {
      const fixture = createCannibalizationFixture();
      const removal = evaluateChannelRemoval(
        request(fixture),
        "google_search",
      );

      const direct = sourceDelta(removal, "direct");
      const organic = sourceDelta(
        removal,
        "organic_search",
      );

      expect(
        (direct?.sessionsDelta ?? 0) > 0 ||
          (organic?.sessionsDelta ?? 0) > 0,
      ).toBe(true);

      const factualByCustomer = new Map(
        removal.factual.simulation.purchases.map(
          (purchase) => [
            purchase.customerId,
            purchase,
          ] as const,
        ),
      );
      const removedByCustomer = new Map(
        removal.removed.simulation.purchases.map(
          (purchase) => [
            purchase.customerId,
            purchase,
          ] as const,
        ),
      );

      const substituted = [...factualByCustomer].some(
        ([customerId, factualPurchase]) => {
          if (
            factualPurchase.source !==
            "google_search"
          ) {
            return false;
          }
          const counterfactual =
            removedByCustomer.get(customerId);
          return (
            counterfactual?.source === "direct" ||
            counterfactual?.source ===
              "organic_search"
          );
        },
      );

      expect(substituted).toBe(true);
    },
    90_000,
  );



  it(
    "God mode quantifies mediated Google observed revenue separately from Meta direct value",
    () => {
      const fixture = createMediationFixture();
      const req = request(fixture);
      const pair = evaluatePairwiseInteraction(
        req,
        "meta",
        "google_search",
      );
      const decomposition =
        decomposePairwiseInteraction(
          pair,
          "google_search",
        );

      expect(
        decomposition.observedMediatedRevenueShiftMinor,
      ).toBeGreaterThan(0);
      expect(
        decomposition.totalJointRevenueMinor,
      ).toBe(
        pair.both.representedRevenueMinor -
          pair.neither.representedRevenueMinor,
      );
    },
    90_000,
  );

  it(
    "Search cannibalization can move attribution/routes more than total merchant revenue",
    () => {
      const fixture = createCannibalizationFixture();
      const removal = evaluateChannelRemoval(
        request(fixture),
        "google_search",
      );

      const google = sourceDelta(
        removal,
        "google_search",
      );
      const direct = sourceDelta(
        removal,
        "direct",
      );
      const organic = sourceDelta(
        removal,
        "organic_search",
      );

      const routeRevenueMovement =
        Math.abs(
          google?.attributedRevenueMinorDelta ?? 0,
        ) +
        Math.abs(
          direct?.attributedRevenueMinorDelta ?? 0,
        ) +
        Math.abs(
          organic?.attributedRevenueMinorDelta ?? 0,
        );

      expect(routeRevenueMovement).toBeGreaterThan(0);
      expect(routeRevenueMovement).toBeGreaterThanOrEqual(
        Math.abs(
          removal.delta.representedRevenueMinor,
        ),
      );
    },
    90_000,
  );

  it(
    "prospecting creates future retargeting/email/search audiences rather than only direct sales",
    () => {
      const fixture =
        createPortfolioReallocationTrapFixture();
      const removal = evaluateChannelRemoval(
        request(fixture),
        "meta",
      );

      expect(
        removal.delta.futureAudience
          .representedRetargetingEligible,
      ).toBeLessThan(0);
      expect(
        removal.delta.futureAudience
          .representedBrandedSearchReady,
      ).toBeLessThan(0);
    },
    90_000,
  );
});
