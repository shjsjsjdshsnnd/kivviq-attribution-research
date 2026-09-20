import { describe, expect, it } from "vitest";
import {
  createInteractionReversalFixture,
  createPortfolioReallocationTrapFixture,
  createPositiveSynergyFixture,
  createZeroInteractionControlFixture,
} from "../../src/cross_channel/adversarial.js";
import {
  conditionalMarginalIroas,
  evaluateChannelContextInteraction,
  evaluatePairwiseInteraction,
} from "../../src/cross_channel/evaluator.js";
import { referenceSpendMinor } from "../../src/advertising_economics/evaluator.js";
import type { CrossChannelFixture, PortfolioEvaluationRequest } from "../../src/cross_channel/types.js";

function request(
  fixture: CrossChannelFixture,
  end = "2026-05-01T00:00:00.000Z",
): PortfolioEvaluationRequest {
  return {
    merchantWorld: fixture.merchantWorld,
    latentPopulation: fixture.latentPopulation,
    simulationSeed: fixture.simulationSeed,
    periodStart: "2026-01-01T00:00:00.000Z",
    periodEnd: end,
    spendMinorByChannel: {},
    simulationConfig: {
      maxEvents: 260_000,
      maxSessionsPerCustomer: 20,
    },
  };
}

describe("Step 6 portfolio interaction value", () => {
  it(
    "zero-interaction control reconciles exactly to independent effects",
    () => {
      const fixture = createZeroInteractionControlFixture();
      const pair = evaluatePairwiseInteraction(
        request(fixture),
        "meta",
        "google_search",
      );

      expect(pair.interactionRevenueMinor).toBe(0);
      expect(pair.interactionOrders).toBe(0);
      expect(pair.interactionNewCustomers).toBe(0);
      expect(pair.interactionContributionProfitMinor).toBe(0);
    },
    90_000,
  );

  it(
    "positive-synergy world has joint value above independent channel effects",
    () => {
      const fixture = createPositiveSynergyFixture();
      const pair = evaluatePairwiseInteraction(
        request(fixture),
        "meta",
        "google_search",
      );

      expect(pair.interactionRevenueMinor).toBeGreaterThan(0);
      expect(
        pair.both.representedRevenueMinor,
      ).toBeGreaterThan(
        pair.leftOnly.representedRevenueMinor +
          pair.rightOnly.representedRevenueMinor -
          pair.neither.representedRevenueMinor,
      );
    },
    90_000,
  );

  it(
    "Email and promotion can create non-additive state-dependent conversion value",
    () => {
      const fixture = createPortfolioReallocationTrapFixture();
      const interaction =
        evaluateChannelContextInteraction(
          request(fixture),
          "email",
          {
            variable: "promotion.discount_active",
            operation: "set",
            value: {
              kind: "boolean",
              value: true,
            },
          },
          {
            variable: "promotion.discount_active",
            operation: "set",
            value: {
              kind: "boolean",
              value: false,
            },
          },
        );

      expect(interaction.contextVariable).toBe(
        "promotion.discount_active",
      );
      expect(interaction.interactionRevenueMinor).toBeGreaterThan(0);
    },
    120_000,
  );

  it(
    "Google marginal iROAS can reverse materially with Meta portfolio state",
    () => {
      const fixture = createInteractionReversalFixture();
      const baseRequest = request(fixture);
      const activeMeta = referenceSpendMinor(
        fixture.merchantWorld,
        "meta",
      );

      const withoutMeta = conditionalMarginalIroas(
        baseRequest,
        "google_search",
        "meta",
        0,
        80_000,
      );
      const withMeta = conditionalMarginalIroas(
        baseRequest,
        "google_search",
        "meta",
        activeMeta,
        80_000,
      );

      expect(withoutMeta).not.toBeNull();
      expect(withMeta).not.toBeNull();
      expect(Math.abs(withMeta! - withoutMeta!)).toBeGreaterThan(0.1);
    },
    120_000,
  );
});
