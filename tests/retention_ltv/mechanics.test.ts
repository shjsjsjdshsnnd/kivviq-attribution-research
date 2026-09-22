import {
  describe,
  expect,
  it,
} from "vitest";
import {
  generateCustomerPopulation,
} from "../../src/customer_population/generator.js";
import {
  generateMerchantWorldRecord,
} from "../../src/generation/generator.js";
import {
  lifecycleMarketingMultipliers,
  postPurchaseTransition,
  type RetentionCustomerContext,
} from "../../src/retention_ltv/runtime.js";
import {
  RETENTION_LTV_VERSION,
  type RetentionLtvScenario,
} from "../../src/retention_ltv/runtime-types.js";
import {
  createRuntimeWorldState,
  markNeedFormation,
  transitionAfterPurchase,
  transitionLifecycleForInactivity,
} from "../../src/simulation/state.js";

function setup() {
  const world =
    generateMerchantWorldRecord({
      seed: 311020,
      archetype: "beauty_cosmetics",
      scale: "growth",
      complexity: "complex",
      purchaseFrequency: "replenishment",
      catalogProfile: "tiny_curated",
    });
  const population =
    generateCustomerPopulation({
      merchantWorld: world,
      populationSeed: 311120,
      populationConfig: {
        maxExplicitAgents: 30,
        complexity: "complex",
      },
    });
  const runtime =
    createRuntimeWorldState(
      world,
      population,
      Date.parse(
        "2026-01-01T00:00:00.000Z",
      ),
      true,
    );
  return {
    world,
    customer: [
      ...runtime.customers.values(),
    ][0]!,
  };
}

function scenario(): RetentionLtvScenario {
  return {
    version: RETENTION_LTV_VERSION,
    source:
      "step11_explicit_synthetic",
    merchantRepeatHazardMultiplier: 1,
    loyalPurchaseThreshold: 3,
    lapseAfterExpectedIntervals: 2,
    dormantAfterExpectedIntervals: 4,
    latentChurnAfterExpectedIntervals: 6,
    permanentChurnAfterExpectedIntervals:
      null,
    reactivationHazardMultiplier: 0.5,
    experience: {
      successfulPurchaseAffinityDelta:
        0,
      returnedPurchaseAffinityDelta:
        -0.04,
      stockoutMerchantExitAffinityDelta:
        -0.03,
    },
    promotionDependencePerPromotedPurchase:
      0.2,
    lifecycleMarketing: [
      {
        campaignId:
          "step11-test-winback",
        kind: "winback",
        channel: "email",
        eligibleLifecycleStates: [
          "lapsing",
          "dormant",
        ],
        minimumDaysSincePurchase: 30,
        opportunityMultiplier: 1.8,
        causalResponseMultiplier: 1.2,
      },
    ],
  };
}

describe("Step 11 lifecycle mechanics", () => {
  it("keeps lapse/churn truth cadence-aware and latent when permanent churn is not configured", () => {
    const { customer } = setup();
    const intervalMs =
      customer.source
        .expectedPurchaseIntervalDays *
      86_400_000;
    customer.purchaseCount = 1;
    customer.lastPurchaseMs =
      Date.parse(
        "2026-01-01T00:00:00.000Z",
      );

    transitionLifecycleForInactivity(
      customer,
      customer.lastPurchaseMs +
        intervalMs * 3,
      {
        lapseAfterIntervals: 2,
        dormantAfterIntervals: 4,
        latentChurnAfterIntervals: 6,
        permanentChurnAfterIntervals:
          null,
      },
    );
    expect(customer.lifecycle).toBe(
      "lapsing",
    );

    transitionLifecycleForInactivity(
      customer,
      customer.lastPurchaseMs +
        intervalMs * 7,
      {
        lapseAfterIntervals: 2,
        dormantAfterIntervals: 4,
        latentChurnAfterIntervals: 6,
        permanentChurnAfterIntervals:
          null,
      },
    );
    expect(customer.lifecycle).toBe(
      "dormant",
    );
    expect(
      customer.retention.trueChurnState,
    ).toBe("latent_churned");
    expect(customer.churned).toBe(false);
  });

  it("allows latent-churn reactivation through an ordinary future need", () => {
    const { customer } = setup();
    customer.purchaseCount = 2;
    customer.lifecycle = "dormant";
    customer.retention.trueChurnState =
      "latent_churned";

    markNeedFormation(
      customer,
      0.8,
      Date.parse(
        "2026-08-01T00:00:00.000Z",
      ),
    );

    expect(customer.lifecycle).toBe(
      "active_customer",
    );
    expect(
      customer.retention.trueChurnState,
    ).toBe("active");
    expect(
      customer.retention
        .reactivationCount,
    ).toBe(1);
  });

  it("changes promotion dependence only when a promoted purchase is actually realized", () => {
    const { world, customer } = setup();
    const retentionScenario =
      scenario();
    const context: RetentionCustomerContext =
      {
        source: customer.source,
        purchaseCount: 0,
        lifecycle: customer.lifecycle,
        brandAffinity:
          customer.brandAffinity,
        need: customer.need,
        repeatHazardQualityMultiplier:
          1,
        promotionDependenceShift: 0,
        trueChurnState: "active",
        ownedProductQuantities:
          new Map(),
        categoryFamiliarity:
          new Map(),
      };
    const productId =
      world.manifest
        .productDemandMechanisms[0]!
        .productId;

    const fullPrice =
      postPurchaseTransition(
        world,
        retentionScenario,
        context,
        [
          {
            productId,
            quantity: 1,
          },
        ],
        [],
      );
    const promoted =
      postPurchaseTransition(
        world,
        retentionScenario,
        context,
        [
          {
            productId,
            quantity: 1,
            promotionIds: ["promo"],
          },
        ],
        [],
      );

    expect(
      fullPrice.promotionDependenceDelta,
    ).toBe(0);
    expect(
      promoted.promotionDependenceDelta,
    ).toBeGreaterThan(0);

    transitionAfterPurchase(
      customer,
      Date.parse(
        "2026-01-02T00:00:00.000Z",
      ),
      1,
      promoted,
    );
    expect(
      customer.retention
        .promotionDependenceShift,
    ).toBeGreaterThan(0);
  });

  it("gates lifecycle marketing by legitimate lifecycle and elapsed-time state", () => {
    const { customer } = setup();
    const retentionScenario =
      scenario();
    const purchaseMs = Date.parse(
      "2026-01-01T00:00:00.000Z",
    );
    const context: RetentionCustomerContext =
      {
        source: customer.source,
        purchaseCount: 1,
        lifecycle: "lapsing",
        brandAffinity:
          customer.brandAffinity,
        need: customer.need,
        lastPurchaseMs: purchaseMs,
        repeatHazardQualityMultiplier:
          1,
        promotionDependenceShift: 0,
        trueChurnState: "active",
        ownedProductQuantities:
          new Map(),
        categoryFamiliarity:
          new Map(),
      };

    const tooEarly =
      lifecycleMarketingMultipliers(
        retentionScenario,
        context,
        purchaseMs + 10 * 86_400_000,
        "email",
      );
    const eligible =
      lifecycleMarketingMultipliers(
        retentionScenario,
        context,
        purchaseMs + 45 * 86_400_000,
        "email",
      );

    expect(
      tooEarly.opportunity,
    ).toBe(1);
    expect(
      eligible.opportunity,
    ).toBeGreaterThan(1);
    expect(
      eligible.causalResponse,
    ).toBeGreaterThan(1);
  });
});
