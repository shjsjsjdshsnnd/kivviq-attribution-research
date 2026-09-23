import { describe, expect, it } from "vitest";
import {
  brokenCouponScenario,
  healthyWebsiteScenario,
} from "../../src/website_cro/adversarial.js";
import {
  resolveCheckoutExperience,
} from "../../src/website_cro/runtime.js";

const START = "2026-01-01T00:00:00.000Z";
const customer = {
  customerId: "coupon-customer",
  intent: 0.7,
  need: 0.7,
  brandAffinity: 0.4,
  priceSensitivityMultiplier: 1.2,
  promotionSensitivityMultiplier: 1.8,
  purchaseCount: 0,
} as const;

describe("Step 12 coupon mechanisms", () => {
  it("distinguishes an invalid searched code from a valid coupon functionality defect", () => {
    const invalid = resolveCheckoutExperience({
      scenario: healthyWebsiteScenario(START),
      timestampMs: Date.parse(START),
      device: "desktop",
      customer,
      randomness: {
        bool: (key) =>
          key.includes("coupon-search") ||
          key.includes("coupon-attempt") ||
          key.includes("coupon-invalid"),
      },
      key: "invalid",
      actualShippingChargeMinor: 0,
      cartValueMinor: 10_000,
      expectedAovMinor: 10_000,
      promotionExpected: true,
      validCouponAvailable: false,
    });
    const defect = resolveCheckoutExperience({
      scenario: brokenCouponScenario(START),
      timestampMs: Date.parse(START),
      device: "desktop",
      customer,
      randomness: {
        bool: (key) =>
          key.includes("coupon-attempt") ||
          key.includes("coupon-defect"),
      },
      key: "defect",
      actualShippingChargeMinor: 0,
      cartValueMinor: 10_000,
      expectedAovMinor: 10_000,
      promotionExpected: true,
      validCouponAvailable: true,
    });

    expect(invalid?.couponSearched).toBe(true);
    expect(invalid?.couponInvalid).toBe(true);
    expect(invalid?.frictions).toContain(
      "invalid_coupon",
    );
    expect(invalid?.frictions).not.toContain(
      "broken_coupon",
    );

    expect(defect?.couponInvalid).toBe(false);
    expect(defect?.couponFailed).toBe(true);
    expect(defect?.frictions).toContain(
      "broken_coupon",
    );
    expect(defect?.frictions).not.toContain(
      "invalid_coupon",
    );
  });
});
