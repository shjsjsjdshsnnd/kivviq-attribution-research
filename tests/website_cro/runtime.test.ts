import { describe, expect, it } from "vitest";
import {
  healthyWebsiteScenario,
  slowMobilePdpScenario,
} from "../../src/website_cro/adversarial.js";
import {
  resolveCheckoutExperience,
  resolveWebsiteState,
  validateWebsiteScenario,
  websitePageExperience,
  zeroResultSearchProbability,
} from "../../src/website_cro/runtime.js";
import type {
  WebsiteCustomerContext,
  WebsiteScenario,
} from "../../src/website_cro/types.js";

const DEPLOYED = "2026-01-01T00:00:00.000Z";

const lowIntent: WebsiteCustomerContext = {
  customerId: "low-intent",
  intent: 0.18,
  need: 0.22,
  brandAffinity: 0.2,
  priceSensitivityMultiplier: 1.1,
  promotionSensitivityMultiplier: 1,
  purchaseCount: 0,
};

const highIntent: WebsiteCustomerContext = {
  customerId: "high-intent",
  intent: 0.94,
  need: 0.9,
  brandAffinity: 0.72,
  priceSensitivityMultiplier: 0.8,
  promotionSensitivityMultiplier: 0.7,
  purchaseCount: 1,
};

describe("Step 12 website runtime", () => {
  it("resolves the website version that was actually deployed at the event time", () => {
    const first = healthyWebsiteScenario(DEPLOYED).states[0]!;
    const second = {
      ...first,
      versionId: "website_v2",
      deployedAt: "2026-02-10T00:00:00.000Z",
      checkout: {
        ...first.checkout,
        componentVersion: "checkout_v2",
        mobileUsability: 0.4,
      },
    };
    const scenario: WebsiteScenario = {
      scenarioId: "versioned",
      states: [first, second],
    };

    validateWebsiteScenario(scenario);
    expect(
      resolveWebsiteState(
        scenario,
        Date.parse("2026-02-09T23:59:00.000Z"),
        "mobile",
      ).versionId,
    ).toBe(first.versionId);
    expect(
      resolveWebsiteState(
        scenario,
        Date.parse("2026-02-10T00:01:00.000Z"),
        "mobile",
      ).versionId,
    ).toBe("website_v2");
  });

  it("makes slow mobile PDP latency customer-dependent rather than a global conversion penalty", () => {
    const scenario = slowMobilePdpScenario(DEPLOYED);
    const timestampMs = Date.parse("2026-01-15T00:00:00.000Z");

    const low = websitePageExperience({
      scenario,
      timestampMs,
      component: "pdp",
      device: "mobile",
      customer: lowIntent,
    })!;
    const high = websitePageExperience({
      scenario,
      timestampMs,
      component: "pdp",
      device: "mobile",
      customer: highIntent,
    })!;
    const desktop = websitePageExperience({
      scenario,
      timestampMs,
      component: "pdp",
      device: "desktop",
      customer: lowIntent,
    })!;

    expect(low.frictions).toContain("latency");
    expect(low.transitionMultiplier).toBeLessThan(
      high.transitionMultiplier,
    );
    expect(low.transitionMultiplier).toBeLessThan(
      desktop.transitionMultiplier,
    );
  });

  it("supports evaluator-only website interventions with time and device population semantics", () => {
    const base = slowMobilePdpScenario(DEPLOYED);
    const scenario: WebsiteScenario = {
      ...base,
      interventions: [
        {
          variable: "website.pdp.mobile.latency_seconds",
          operation: "set",
          value: {
            kind: "number",
            value: 1.1,
            unit: "seconds",
          },
          effectiveAt: "2026-02-01T00:00:00.000Z",
          population: { devices: ["mobile"] },
        },
      ],
    };

    expect(
      resolveWebsiteState(
        scenario,
        Date.parse("2026-01-31T00:00:00.000Z"),
        "mobile",
      ).pdp.performance.mobile.latencyMs,
    ).toBe(7_200);
    expect(
      resolveWebsiteState(
        scenario,
        Date.parse("2026-02-02T00:00:00.000Z"),
        "mobile",
      ).pdp.performance.mobile.latencyMs,
    ).toBe(1_100);
    expect(
      resolveWebsiteState(
        scenario,
        Date.parse("2026-02-02T00:00:00.000Z"),
        "desktop",
      ).pdp.performance.desktop.latencyMs,
    ).toBe(620);
  });

  it("produces higher zero-result risk from poor synthetic search quality without forcing abandonment", () => {
    const healthy = healthyWebsiteScenario(DEPLOYED);
    const badState = {
      ...healthy.states[0]!,
      search: {
        ...healthy.states[0]!.search,
        relevance: 0.12,
        synonymCoverage: 0.12,
        zeroResultBaseProbability: 0.35,
        reformulationSupport: 0.35,
      },
    };
    const bad: WebsiteScenario = {
      scenarioId: "bad-search",
      states: [badState],
    };
    const time = Date.parse("2026-01-10T00:00:00.000Z");

    expect(
      zeroResultSearchProbability({
        scenario: bad,
        timestampMs: time,
        device: "mobile",
        intent: 0.55,
      }),
    ).toBeGreaterThan(
      zeroResultSearchProbability({
        scenario: healthy,
        timestampMs: time,
        device: "mobile",
        intent: 0.55,
      }),
    );
  });

  it("models coupon, payment, address and late-shipping defects as separate checkout mechanisms", () => {
    const healthy = healthyWebsiteScenario(DEPLOYED);
    const state = healthy.states[0]!;
    const broken: WebsiteScenario = {
      scenarioId: "checkout-defects",
      states: [
        {
          ...state,
          cart: {
            ...state.cart,
            couponReliability: 0,
            shippingVisibility: 0,
          },
          checkout: {
            ...state.checkout,
            paymentReliability: 0,
            addressValidationReliability: 0,
            shippingCostVisibility: "checkout_review",
          },
        },
      ],
    };
    const experience = resolveCheckoutExperience({
      scenario: broken,
      timestampMs: Date.parse("2026-01-10T00:00:00.000Z"),
      device: "mobile",
      customer: {
        ...lowIntent,
        promotionSensitivityMultiplier: 1.8,
        priceSensitivityMultiplier: 1.8,
      },
      randomness: {
        bool: (_key, probability) => probability > 0,
      },
      key: "checkout-test",
      actualShippingChargeMinor: 2_500,
      cartValueMinor: 8_000,
      expectedAovMinor: 10_000,
      promotionExpected: true,
    })!;

    expect(experience.couponFailed).toBe(true);
    expect(experience.paymentFailed).toBe(true);
    expect(experience.addressValidationFailed).toBe(true);
    expect(experience.shippingSurprise).toBe(true);
    expect(experience.frictions).toEqual(
      expect.arrayContaining([
        "broken_coupon",
        "payment_failure",
        "address_validation_failure",
        "shipping_surprise",
      ]),
    );
    expect(experience.completionMultiplier).toBeLessThan(0.2);
  });
});
