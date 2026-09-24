import { describe, expect, it } from "vitest";
import * as operatorSafeRoot from "../../src/index.js";
import { simulateWorld } from "../../src/simulation/simulator.js";
import {
  CANONICAL_WEBSITE_SCENARIO_IDS,
  IMPROVE_PDP_IMAGERY,
  badSearchScenario,
  brokenCouponScenario,
  healthyWebsiteScenario,
  multipleCroIssuesScenario,
  poorCheckoutScenario,
  poorCollectionSortingScenario,
  shippingSurpriseScenario,
  slowMobilePdpScenario,
  subtleMobileCheckoutDragScenario,
  weakProductImageryScenario,
} from "../../src/website_cro/adversarial.js";
import {
  serializeWebsiteScenario,
  websiteScenarioFingerprint,
} from "../../src/website_cro/fingerprint.js";
import {
  validateWebsiteScenario,
  websitePageExperience,
} from "../../src/website_cro/runtime.js";
import {
  WEBSITE_MODEL_VERSION,
  WEBSITE_SCHEMA_VERSION,
  type WebsiteCustomerContext,
} from "../../src/website_cro/types.js";
import {
  baseAdversarialWorld,
  populationFor,
} from "../simulation/fixture.js";

const START = "2026-01-01T00:00:00.000Z";

const CUSTOMER: WebsiteCustomerContext = {
  customerId: "step12-contract-customer",
  intent: 0.72,
  need: 0.68,
  brandAffinity: 0.62,
  priceSensitivityMultiplier: 1,
  promotionSensitivityMultiplier: 1,
  purchaseCount: 0,
};

describe("Step 12 revised website-model contract", () => {
  it("freezes an explicit model/schema identity and deterministic serialization fingerprint", () => {
    const first = healthyWebsiteScenario(START);
    const second = structuredClone(first);

    expect(WEBSITE_MODEL_VERSION).toBe("website_model_v1");
    expect(WEBSITE_SCHEMA_VERSION).toBe(1);
    expect(serializeWebsiteScenario(first)).toBe(
      serializeWebsiteScenario(second),
    );
    expect(websiteScenarioFingerprint(first)).toBe(
      websiteScenarioFingerprint(second),
    );
    expect(
      websiteScenarioFingerprint(
        weakProductImageryScenario(START),
      ),
    ).not.toBe(websiteScenarioFingerprint(first));
  });

  it("provides every canonical Step 12 fixture including multi-issue and subtle cases", () => {
    const scenarios = [
      healthyWebsiteScenario(START),
      slowMobilePdpScenario(START),
      poorCheckoutScenario(START),
      badSearchScenario(START),
      weakProductImageryScenario(START),
      shippingSurpriseScenario(START),
      brokenCouponScenario(START),
      poorCollectionSortingScenario(
        START,
        "preferred-product",
        "weaker-product",
      ),
      multipleCroIssuesScenario(START),
      subtleMobileCheckoutDragScenario(START),
    ];

    for (const scenario of scenarios) {
      expect(() => validateWebsiteScenario(scenario)).not.toThrow();
    }
    expect(scenarios.map((scenario) => scenario.scenarioId)).toEqual(
      CANONICAL_WEBSITE_SCENARIO_IDS,
    );
  });

  it("makes weak imagery causally reduce PDP progression and the imagery intervention reverse the direction", () => {
    const weak = weakProductImageryScenario(START);
    const fixed = {
      ...weak,
      interventions: [IMPROVE_PDP_IMAGERY],
    };

    const weakExperience = websitePageExperience({
      scenario: weak,
      timestampMs: Date.parse(START),
      component: "pdp",
      device: "mobile",
      customer: CUSTOMER,
      productPriceMinor: 25_000,
      expectedAovMinor: 25_000,
    });
    const fixedExperience = websitePageExperience({
      scenario: fixed,
      timestampMs: Date.parse(START),
      component: "pdp",
      device: "mobile",
      customer: CUSTOMER,
      productPriceMinor: 25_000,
      expectedAovMinor: 25_000,
    });

    expect(weakExperience).toBeDefined();
    expect(fixedExperience).toBeDefined();
    expect(fixedExperience!.transitionMultiplier).toBeGreaterThan(
      weakExperience!.transitionMultiplier,
    );
    expect(
      fixedExperience!.transitionMultiplier -
        weakExperience!.transitionMultiplier,
    ).toBeGreaterThan(0.05);
  });

  it(
    "reproduces the complete website-enabled world under a fixed seed, fingerprints it, and keeps hidden causal fields out of observable events",
    () => {
      const world = baseAdversarialWorld(64112);
      const population = populationFor(world, 7315, 70);
      const request = {
        merchantWorld: world,
        latentPopulation: population,
        simulationSeed: 162,
        startTime: START,
        endTime: "2026-03-01T00:00:00.000Z",
        commercePolicy: {
          websiteScenario: multipleCroIssuesScenario(START),
        },
        config: {
          maxEvents: 110_000,
          maxSessionsPerCustomer: 12,
        },
      } as const;

      const first = simulateWorld(request);
      const second = simulateWorld(request);

      expect(second).toEqual(first);
      expect(first.provenance.websiteModelVersion).toBe(
        WEBSITE_MODEL_VERSION,
      );
      expect(first.provenance.websiteSchemaVersion).toBe(
        WEBSITE_SCHEMA_VERSION,
      );
      expect(first.provenance.websiteScenarioFingerprint).toBe(
        first.godMode.website?.scenarioFingerprint,
      );
      expect(
        first.observableEvents.some(
          (event) =>
            event.eventType === "page_performance" &&
            event.measuredPageLoadMs !== undefined &&
            event.measuredPageLoadMs > 0,
        ),
      ).toBe(true);

      const forbiddenObservableFields = [
        "rootCause",
        "hiddenDefect",
        "conversionPenalty",
        "friction",
        "probabilityMultiplier",
        "scenarioId",
        "websiteVersionId",
        "componentVersion",
      ];
      for (const event of first.observableEvents) {
        for (const field of forbiddenObservableFields) {
          expect(field in event).toBe(false);
        }
      }

      expect(
        first.godMode.website?.causalEvents.length ?? 0,
      ).toBeGreaterThan(0);
      const rootKeys = Object.keys(operatorSafeRoot);
      expect(rootKeys).not.toContain("WEBSITE_MODEL_VERSION");
      expect(rootKeys).not.toContain("websiteScenarioFingerprint");
      expect(rootKeys).not.toContain("validateWebsiteScenario");
    },
    60_000,
  );
});
