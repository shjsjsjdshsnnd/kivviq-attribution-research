import { describe, expect, it } from "vitest";
import {
  healthyWebsiteScenario,
  poorCheckoutScenario,
} from "../../src/website_cro/adversarial.js";
import {
  resolveCheckoutExperience,
} from "../../src/website_cro/runtime.js";

const START = "2026-01-01T00:00:00.000Z";
const context = {
  customerId: "checkout-stage-customer",
  intent: 0.6,
  need: 0.6,
  brandAffinity: 0.5,
  priceSensitivityMultiplier: 1,
  promotionSensitivityMultiplier: 1,
  purchaseCount: 0,
} as const;
const randomness = {
  bool: () => false,
};

describe("Step 12 checkout stage mechanics", () => {
  it("keeps contact, shipping, payment and review friction causally distinct", () => {
    const healthy = resolveCheckoutExperience({
      scenario: healthyWebsiteScenario(START),
      timestampMs: Date.parse(START),
      device: "mobile",
      customer: context,
      randomness,
      key: "healthy",
      actualShippingChargeMinor: 0,
      cartValueMinor: 10_000,
      expectedAovMinor: 10_000,
      promotionExpected: false,
    });
    const poor = resolveCheckoutExperience({
      scenario: poorCheckoutScenario(START),
      timestampMs: Date.parse(START),
      device: "mobile",
      customer: context,
      randomness,
      key: "poor",
      actualShippingChargeMinor: 0,
      cartValueMinor: 10_000,
      expectedAovMinor: 10_000,
      promotionExpected: false,
    });

    expect(healthy).toBeDefined();
    expect(poor).toBeDefined();
    expect(poor!.stageQualities.contact).toBeLessThan(
      healthy!.stageQualities.contact,
    );
    expect(poor!.stageQualities.shipping).toBeLessThan(
      healthy!.stageQualities.shipping,
    );
    expect(poor!.stageQualities.payment).toBeLessThan(
      healthy!.stageQualities.payment,
    );
    expect(poor!.stageQualities.review).toBeLessThan(
      healthy!.stageQualities.review,
    );
    expect(poor!.frictions).toEqual(
      expect.arrayContaining([
        "checkout_contact_friction",
        "checkout_shipping_friction",
        "checkout_payment_friction",
        "checkout_review_friction",
      ]),
    );
  });
});
