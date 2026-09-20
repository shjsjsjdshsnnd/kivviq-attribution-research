import { describe, expect, it } from "vitest";
import { MERCHANT_ARCHETYPES } from "../../src/generation/config.js";
import { runDiversityBenchmark } from "../../src/generation/diversity-report.js";

describe("10,000-world merchant diversity benchmark", () => {
  it(
    "produces a diverse population rather than disguised clones",
    () => {
      const report = runDiversityBenchmark(10_000);

      console.info(
        "STEP2_DIVERSITY_REPORT",
        JSON.stringify(report, null, 2),
      );

      expect(report.uniqueWorldIds).toBe(10_000);
      expect(report.exactDuplicateRate).toBeLessThan(0.002);
      expect(report.coarseSignatureCount).toBeGreaterThan(5_000);
      expect(report.maxCoarseSignatureShare).toBeLessThan(0.005);
      expect(report.activeChannelCombinationCount).toBeGreaterThan(40);
      expect(report.responseCurveKinds.length).toBeGreaterThanOrEqual(3);
      expect(report.catalogProfiles.length).toBe(5);
      expect(report.promotionProfiles.length).toBe(5);
      expect(report.seasonalityProfiles.length).toBe(7);
      expect(report.inventoryProfiles.length).toBe(6);
      expect(Object.keys(report.archetypeCounts)).toHaveLength(
        MERCHANT_ARCHETYPES.length,
      );

      const metrics = report.metrics;
      expect(
        metrics["annualRevenuePotentialMinor"]!.standardDeviation,
      ).toBeGreaterThan(
        metrics["annualRevenuePotentialMinor"]!.mean * 0.7,
      );
      expect(
        metrics["expectedAovMinor"]!.standardDeviation,
      ).toBeGreaterThan(metrics["expectedAovMinor"]!.mean * 0.45);
      expect(metrics["skuCount"]!.standardDeviation).toBeGreaterThan(20);
      expect(
        metrics["repeatProbability"]!.standardDeviation,
      ).toBeGreaterThan(0.12);
      expect(
        metrics["mobileTrafficShare"]!.standardDeviation,
      ).toBeGreaterThan(0.07);
      expect(
        metrics["paidDependence"]!.standardDeviation,
      ).toBeGreaterThan(0.12);
      expect(
        metrics["productConcentrationTop5"]!.standardDeviation,
      ).toBeGreaterThan(0.05);
    },
    120_000,
  );
});
