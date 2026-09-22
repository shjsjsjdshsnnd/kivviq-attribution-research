import { describe, expect, it } from "vitest";
import {
  badSearchScenario,
  brokenCouponScenario,
  CLARIFY_SHIPPING_EARLIER,
  FIX_COLLECTION_RANKING,
  FIX_COUPON_FUNCTIONALITY,
  FIX_SEARCH_RELEVANCE,
  poorCollectionSortingScenario,
  shippingSurpriseScenario,
} from "../../src/website_cro/adversarial.js";
import {
  funnelDiagnostics,
  replayCroIntervention,
} from "../../src/website_cro/evaluator.js";
import type { SimulationResult } from "../../src/simulation/types.js";
import {
  allPaidEffectsZero,
  baseAdversarialWorld,
  populationFor,
} from "../simulation/fixture.js";

const START = "2026-01-01T00:00:00.000Z";
const END = "2026-07-01T00:00:00.000Z";

function countEvent(
  result: SimulationResult,
  eventType:
    | "search_zero_result"
    | "coupon_attempt"
    | "coupon_error"
    | "shipping_cost_reveal",
): number {
  return result.observableEvents.filter(
    (event) => event.eventType === eventType,
  ).length;
}

function collectionOriginViews(
  result: SimulationResult,
  productId: string,
): number {
  const bySession = new Map<
    string,
    typeof result.observableEvents
  >();
  for (const event of result.observableEvents) {
    if (event.sessionId === undefined) continue;
    const events = bySession.get(event.sessionId) ?? [];
    bySession.set(event.sessionId, [...events, event]);
  }

  let views = 0;
  for (const events of bySession.values()) {
    const ordered = [...events].sort(
      (left, right) =>
        Date.parse(left.occurredAt) -
          Date.parse(right.occurredAt) ||
        left.eventId.localeCompare(right.eventId),
    );
    let sawCollection = false;
    for (const event of ordered) {
      if (event.eventType === "collection_view") {
        sawCollection = true;
      }
      if (
        sawCollection &&
        event.eventType === "product_view" &&
        event.productId === productId
      ) {
        views += 1;
      }
    }
  }
  return views;
}

describe("Step 12 deterministic CRO traps", () => {
  it(
    "bad search suppresses strong-intent commerce and a search fix improves the causal outcome",
    () => {
      const world = allPaidEffectsZero(
        baseAdversarialWorld(64201),
      );
      const population = populationFor(world, 7321, 190);
      const replay = replayCroIntervention({
        merchantWorld: world,
        latentPopulation: population,
        simulationSeed: 111,
        startTime: START,
        endTime: END,
        websiteScenario: badSearchScenario(START),
        intervention: FIX_SEARCH_RELEVANCE,
        config: { maxEvents: 300_000 },
      });

      expect(
        countEvent(
          replay.factual,
          "search_zero_result",
        ),
      ).toBeGreaterThan(
        countEvent(
          replay.counterfactual,
          "search_zero_result",
        ),
      );
      expect(
        replay.delta.sessionsProgressing,
      ).toBeGreaterThan(0);
      expect(replay.delta.addToCarts).toBeGreaterThan(0);
      expect(
        replay.delta.representedContributionProfitMinor,
      ).toBeGreaterThan(0);
      expect(
        replay.factual.godMode.website?.causalEvents.some(
          (event) =>
            event.friction ===
              "zero_result_search" ||
            event.friction === "search_relevance",
        ),
      ).toBe(true);
    },
    90_000,
  );

  it(
    "poor collection sorting can make a strong-demand product look weak until ranking is fixed",
    () => {
      const world = allPaidEffectsZero(
        baseAdversarialWorld(64202),
      );
      const population = populationFor(world, 7322, 200);
      const ranked = [
        ...world.manifest.productDemandMechanisms,
      ].sort(
        (left, right) =>
          Number(right.baseLatentDemandUnits) -
          Number(left.baseLatentDemandUnits),
      );
      const productA = ranked[0]!;
      const productB = ranked[
        Math.min(ranked.length - 1, 4)
      ]!;

      expect(
        Number(productA.baseLatentDemandUnits),
      ).toBeGreaterThanOrEqual(
        Number(productB.baseLatentDemandUnits),
      );

      const replay = replayCroIntervention({
        merchantWorld: world,
        latentPopulation: population,
        simulationSeed: 112,
        startTime: START,
        endTime: END,
        websiteScenario:
          poorCollectionSortingScenario(
            START,
            productA.productId,
            productB.productId,
          ),
        intervention: FIX_COLLECTION_RANKING,
        config: { maxEvents: 310_000 },
      });

      const factualA = collectionOriginViews(
        replay.factual,
        productA.productId,
      );
      const factualB = collectionOriginViews(
        replay.factual,
        productB.productId,
      );
      const fixedA = collectionOriginViews(
        replay.counterfactual,
        productA.productId,
      );

      expect(factualB).toBeGreaterThan(factualA);
      expect(fixedA).toBeGreaterThan(factualA);
      expect(
        replay.delta.sessionsProgressing,
      ).toBeGreaterThan(0);
    },
    90_000,
  );

  it(
    "a genuine coupon defect appears after healthy ATC/checkout behavior and fixing functionality increases completion",
    () => {
      const world = allPaidEffectsZero(
        baseAdversarialWorld(64203),
      );
      const population = populationFor(world, 7323, 190);
      const replay = replayCroIntervention({
        merchantWorld: world,
        latentPopulation: population,
        simulationSeed: 113,
        startTime: START,
        endTime: END,
        websiteScenario: brokenCouponScenario(START),
        intervention: FIX_COUPON_FUNCTIONALITY,
        interventions: [
          {
            variable: "promotion.discount_active",
            operation: "set",
            value: {
              kind: "boolean",
              value: true,
            },
          },
        ],
        config: { maxEvents: 300_000 },
      });
      const factualDiagnostics = funnelDiagnostics(
        replay.factual,
        population,
      );
      const fixedDiagnostics = funnelDiagnostics(
        replay.counterfactual,
        population,
      );

      expect(
        countEvent(replay.factual, "coupon_attempt"),
      ).toBeGreaterThan(0);
      expect(
        countEvent(replay.factual, "coupon_error"),
      ).toBeGreaterThan(0);
      expect(
        countEvent(
          replay.counterfactual,
          "coupon_error",
        ),
      ).toBeLessThan(
        countEvent(replay.factual, "coupon_error"),
      );
      expect(
        factualDiagnostics.overall.atcToCheckoutRate,
      ).not.toBeNull();
      expect(
        factualDiagnostics.overall.checkoutToPurchaseRate,
      ).not.toBeNull();
      expect(
        fixedDiagnostics.overall.checkoutToPurchaseRate,
      ).not.toBeNull();
      expect(
        fixedDiagnostics.overall
          .checkoutToPurchaseRate!,
      ).toBeGreaterThan(
        factualDiagnostics.overall
          .checkoutToPurchaseRate!,
      );
      expect(
        replay.delta.representedContributionProfitMinor,
      ).toBeGreaterThan(0);
    },
    90_000,
  );

  it(
    "late shipping cost disclosure collapses checkout and clarifying shipping earlier removes the surprise mechanism",
    () => {
      const world = allPaidEffectsZero(
        baseAdversarialWorld(64204),
      );
      const population = populationFor(world, 7324, 190);
      const replay = replayCroIntervention({
        merchantWorld: world,
        latentPopulation: population,
        simulationSeed: 114,
        startTime: START,
        endTime: END,
        websiteScenario:
          shippingSurpriseScenario(START),
        intervention: CLARIFY_SHIPPING_EARLIER,
        commercePolicy: {
          customerShippingChargeMinor: 4_500,
          freeShippingThresholdMinor: null,
        },
        config: { maxEvents: 300_000 },
      });

      expect(
        countEvent(
          replay.factual,
          "shipping_cost_reveal",
        ),
      ).toBeGreaterThan(0);
      expect(
        countEvent(
          replay.counterfactual,
          "shipping_cost_reveal",
        ),
      ).toBe(0);
      expect(
        replay.delta.representedOrders,
      ).toBeGreaterThan(0);
      expect(
        replay.delta.representedContributionProfitMinor,
      ).toBeGreaterThan(0);
    },
    90_000,
  );
});
