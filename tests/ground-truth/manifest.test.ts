import { describe, expect, it } from "vitest";
import {
  contributionProfitMinor,
  deserializeGroundTruthManifest,
  parseGroundTruthManifest,
  reproducibilityKey,
  serializeGroundTruthManifest,
} from "../../src/ground_truth/manifest.js";
import { moneyMinor } from "../../src/core/units.js";
import { validManifest } from "../fixture.js";

describe("GroundTruthManifest", () => {
  it("round-trips deterministically", () => {
    const manifest = validManifest();
    const serialized = serializeGroundTruthManifest(manifest);
    const parsed = deserializeGroundTruthManifest(serialized);

    expect(serializeGroundTruthManifest(parsed)).toBe(serialized);
    expect(reproducibilityKey(parsed)).toBe(reproducibilityKey(manifest));
  });

  it("fails safely on unsupported schema versions", () => {
    const raw = JSON.parse(serializeGroundTruthManifest(validManifest())) as Record<string, unknown>;
    raw.schemaVersion = "2.0.0";

    expect(() => parseGroundTruthManifest(raw)).toThrow(/unsupported GroundTruth schema version/);
  });

  it("fails on missing required fields", () => {
    const raw = JSON.parse(serializeGroundTruthManifest(validManifest())) as Record<string, unknown>;
    delete raw.causalGraph;

    expect(() => parseGroundTruthManifest(raw)).toThrow(/missing required field: causalGraph/);
  });

  it("rejects unknown top-level fields", () => {
    const raw = JSON.parse(serializeGroundTruthManifest(validManifest())) as Record<string, unknown>;
    raw.hiddenTruth = { value: 1 };

    expect(() => parseGroundTruthManifest(raw)).toThrow(/unknown top-level field/);
  });

  it("enforces probability bounds", () => {
    const raw = JSON.parse(serializeGroundTruthManifest(validManifest())) as Record<string, any>;
    raw.conversionMechanisms[0].baseProbability = 1.2;

    expect(() => parseGroundTruthManifest(raw)).toThrow(/must be within \[0,1\]/);
  });

  it("keeps baseline demand free of modeled paid lift", () => {
    const raw = JSON.parse(serializeGroundTruthManifest(validManifest())) as Record<string, any>;
    raw.baselineDemand[0].paidMarketingIncluded = true;

    expect(() => parseGroundTruthManifest(raw)).toThrow(/baseline demand must exclude/);
  });

  it("reconciles contribution profit in integer minor units", () => {
    const result = contributionProfitMinor({
      grossRevenueMinor: moneyMinor(100_000),
      discountsMinor: moneyMinor(5_000),
      returnsMinor: moneyMinor(2_000),
      cogsMinor: moneyMinor(40_000),
      paymentFeesMinor: moneyMinor(2_500),
      shippingSubsidyMinor: moneyMinor(3_000),
      fulfillmentCostsMinor: moneyMinor(4_000),
      variableOperatingCostsMinor: moneyMinor(1_500),
      marketingSpendMinor: moneyMinor(10_000),
    });

    expect(Number(result)).toBe(32_000);
  });
});
