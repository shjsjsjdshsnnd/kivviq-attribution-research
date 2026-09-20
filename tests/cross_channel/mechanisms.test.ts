import { describe, expect, it } from "vitest";
import {
  createMediationFixture,
  createPositiveSynergyFixture,
} from "../../src/cross_channel/adversarial.js";
import {
  compileCrossChannelNetwork,
  customerInteractionMultiplier,
} from "../../src/cross_channel/network.js";
import {
  applyPreparedInteraction,
  prepareExposureInteractions,
} from "../../src/cross_channel/runtime.js";
import {
  evaluatePortfolioSurface,
} from "../../src/cross_channel/evaluator.js";
import { createRuntimeWorldState, decayAllCustomerMemory } from "../../src/simulation/state.js";
import { buildSimulationInterventionState } from "../../src/simulation/interventions.js";

describe("Step 6 interaction mechanism semantics", () => {
  it("supports product/category-selective interaction heterogeneity", () => {
    const fixture = createPositiveSynergyFixture();
    const clone = structuredClone(
      fixture.merchantWorld,
    ) as typeof fixture.merchantWorld;
    const categoryId =
      clone.manifest.productDemandMechanisms[0]!.categoryId;

    const first = (
      clone.manifest.channelInteractions as any[]
    )[0]!;
    first.selector = {
      categoryIds: [categoryId],
    };

    const network = compileCrossChannelNetwork(clone);
    const rule = network.rules[0]!;

    const ranked = fixture.latentPopulation.customers
      .map((customer) => ({
        customer,
        affinity:
          customer.categoryPreferences.find(
            (preference) =>
              preference.categoryId === categoryId,
          )?.affinity ?? 0,
      }))
      .sort((a, b) => b.affinity - a.affinity);

    const high = ranked[0]!;
    const low = ranked.at(-1)!;

    expect(high.affinity).toBeGreaterThanOrEqual(low.affinity);
    expect(
      customerInteractionMultiplier(
        rule,
        high.customer,
      ),
    ).toBeGreaterThan(
      customerInteractionMultiplier(
        rule,
        low.customer,
      ),
    );
  });

  it("uses the existing Step 4 clock/memory decay for delayed interactions", () => {
    const fixture = createMediationFixture();
    const network = compileCrossChannelNetwork(
      fixture.merchantWorld,
    );
    const runtime = createRuntimeWorldState(
      fixture.merchantWorld,
      fixture.latentPopulation,
      Date.parse("2026-01-01T00:00:00.000Z"),
    );
    const customer = [...runtime.customers.values()][0]!;
    const interventionState =
      buildSimulationInterventionState(
        fixture.merchantWorld,
        [],
        Date.parse("2026-01-01T00:00:00.000Z"),
      );

    const prepared = prepareExposureInteractions(
      network,
      customer,
      "meta",
      {
        timestampMs: Date.parse("2026-01-01T00:00:00.000Z"),
        promotionActive: false,
        inventoryAvailabilityRatio: 1,
        interventionState,
      },
    ).find(
      (application) =>
        application.truth.mechanismId ===
        "step6_meta_branded_search",
    );

    expect(prepared).toBeDefined();

    applyPreparedInteraction(
      network,
      customer,
      prepared!.truth,
      prepared!.applyAtMs,
    );
    const before = customer.interactionMemory.get(
      "step6_meta_branded_search",
    )!.value;

    decayAllCustomerMemory(
      customer,
      prepared!.applyAtMs + 14 * 86_400_000,
    );
    const after = customer.interactionMemory.get(
      "step6_meta_branded_search",
    )!.value;

    expect(Math.abs(after)).toBeLessThan(
      Math.abs(before),
    );
  });

  it("reduces per-exposure interaction value as source spend saturates", () => {
    const fixture = createMediationFixture();
    const network = compileCrossChannelNetwork(
      fixture.merchantWorld,
    );
    const customer =
      fixture.latentPopulation.customers[0]!;
    const start = Date.parse(
      "2026-01-01T00:00:00.000Z",
    );

    const makeCustomer = () =>
      createRuntimeWorldState(
        fixture.merchantWorld,
        {
          ...fixture.latentPopulation,
          customers: [customer],
          explicitAgentCount: 1,
          representedCustomerCount:
            customer.populationWeight,
        },
        start,
      ).customers.get(customer.customerId)!;

    const baselineState =
      buildSimulationInterventionState(
        fixture.merchantWorld,
        [],
        start,
      );

    const metaBaseline =
      fixture.merchantWorld.manifest.responseCurves.find(
        (curve) =>
          curve.id ===
          fixture.merchantWorld.manifest.channelIncrementality.find(
            (mechanism) =>
              mechanism.channelId === "meta",
          )!.responseCurveId,
      );
    const reference =
      metaBaseline?.kind === "hill"
        ? Number(metaBaseline.halfSaturationSpend)
        : metaBaseline?.kind === "threshold"
          ? Number(metaBaseline.thresholdSpend)
          : metaBaseline?.kind === "linear"
            ? Number(metaBaseline.maxSpend ?? 100_000)
            : metaBaseline?.kind === "piecewise"
              ? Number(
                  metaBaseline.points.find(
                    (point) => Number(point.spend) > 0,
                  )?.spend ?? 100_000,
                )
              : 100_000;

    const highState =
      buildSimulationInterventionState(
        fixture.merchantWorld,
        [
          {
            variable: "marketing.meta.spend",
            operation: "set",
            value: {
              kind: "number",
              value: reference * 4,
              unit: "money_minor",
            },
          },
        ],
        start,
      );

    const baseline = prepareExposureInteractions(
      network,
      makeCustomer(),
      "meta",
      {
        timestampMs: start,
        promotionActive: false,
        inventoryAvailabilityRatio: 1,
        interventionState: baselineState,
      },
    ).find(
      (entry) =>
        entry.truth.mechanismId ===
        "step6_meta_branded_search",
    )!;

    const saturated = prepareExposureInteractions(
      network,
      makeCustomer(),
      "meta",
      {
        timestampMs: start,
        promotionActive: false,
        inventoryAvailabilityRatio: 1,
        interventionState: highState,
      },
    ).find(
      (entry) =>
        entry.truth.mechanismId ===
        "step6_meta_branded_search",
    )!;

    expect(
      Math.abs(saturated.truth.appliedEffect),
    ).toBeLessThan(
      Math.abs(baseline.truth.appliedEffect),
    );
  });

  it(
    "exposes a true portfolio response surface without choosing an optimum",
    () => {
      const fixture = createPositiveSynergyFixture();
      const request = {
        merchantWorld: fixture.merchantWorld,
        latentPopulation: fixture.latentPopulation,
        simulationSeed: fixture.simulationSeed,
        periodStart: "2026-01-01T00:00:00.000Z",
        periodEnd: "2026-03-01T00:00:00.000Z",
        spendMinorByChannel: {},
        simulationConfig: { maxEvents: 180_000 },
      } as const;

      const surface = evaluatePortfolioSurface(
        request,
        [
          { meta: 0, google_search: 0 },
          { meta: 100_000, google_search: 0 },
          { meta: 0, google_search: 100_000 },
          { meta: 100_000, google_search: 100_000 },
        ],
      );

      expect(surface).toHaveLength(4);
      expect(
        new Set(
          surface.map(
            (point) =>
              point.outcome.representedRevenueMinor,
          ),
        ).size,
      ).toBeGreaterThan(1);
    },
    90_000,
  );
});
