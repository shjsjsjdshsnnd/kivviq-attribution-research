import { describe, expect, it } from "vitest";
import {
  createRetargetingTrapFixture,
  createVanityRoasTrapFixture,
} from "../../src/advertising_economics/adversarial.js";
import { buildAdvertisingPerformanceReport } from "../../src/advertising_economics/evaluator.js";

describe("Step 5 adversarial advertising worlds", () => {
  it(
    "vanity ROAS trap: dashboard leader has poor true marginal economics",
    () => {
      const fixture = createVanityRoasTrapFixture();
      const report = buildAdvertisingPerformanceReport(
        fixture.evaluation,
      );

      const withPlatformRoas = report.rows
        .filter(
          (row): row is typeof row & { platformRoas: number } =>
            row.platformRoas !== null,
        )
        .sort(
          (left, right) =>
            right.platformRoas - left.platformRoas,
        );

      expect(withPlatformRoas.length).toBeGreaterThan(1);
      const dashboardLeader = withPlatformRoas[0]!;
      expect(dashboardLeader.channel).toBe(
        fixture.expectedTrapChannel,
      );

      const trap = report.rows.find(
        (row) => row.channel === fixture.expectedTrapChannel,
      )!;
      const alternatives = report.rows.filter(
        (row) =>
          row.channel !== fixture.expectedTrapChannel &&
          row.marginalIncrementalRoas !== null,
      );

      expect(alternatives.length).toBeGreaterThan(0);
      const bestAlternativeMarginal = Math.max(
        ...alternatives.map(
          (row) => row.marginalIncrementalRoas!,
        ),
      );

      expect(trap.marginalIncrementalRoas).not.toBeNull();
      expect(trap.marginalIncrementalRoas!).toBeLessThan(
        bestAlternativeMarginal,
      );
      expect(trap.platformRoas!).toBeGreaterThan(
        trap.marginalIncrementalRoas!,
      );

      console.info(
        "STEP5_VANITY_TRAP",
        JSON.stringify({
          dashboardLeader: dashboardLeader.channel,
          platformRoas: trap.platformRoas,
          trueIncrementalRoas: trap.trueIncrementalRoas,
          marginalIncrementalRoas: trap.marginalIncrementalRoas,
          incrementalContributionProfitMinor:
            trap.incrementalContributionProfitMinor,
          bestAlternativeMarginalRoas: bestAlternativeMarginal,
        }),
      );
    },
    120_000,
  );

  it(
    "retargeting trap: excellent platform performance materially overstates true incrementality",
    () => {
      const fixture = createRetargetingTrapFixture();
      const report = buildAdvertisingPerformanceReport(
        fixture.evaluation,
      );

      const trap = report.rows.find(
        (row) => row.channel === fixture.expectedTrapChannel,
      );
      expect(trap).toBeDefined();
      expect(trap!.platformRoas).not.toBeNull();
      expect(trap!.platformRoas!).toBeGreaterThan(1);
      expect(trap!.trueIncrementalRoas).not.toBeNull();
      expect(trap!.platformRoas!).toBeGreaterThan(
        trap!.trueIncrementalRoas!,
      );

      if (
        trap!.platformReportedCacMinor !== null &&
        trap!.averageIncrementalCacMinor !== null
      ) {
        expect(trap!.platformReportedCacMinor).toBeLessThan(
          trap!.averageIncrementalCacMinor,
        );
      }

      expect(trap!.platformAttributedRevenueMinor).toBeGreaterThan(
        trap!.trueIncrementalRevenueMinor,
      );

      console.info(
        "STEP5_RETARGETING_TRAP",
        JSON.stringify({
          channel: trap!.channel,
          platformRoas: trap!.platformRoas,
          trueIncrementalRoas: trap!.trueIncrementalRoas,
          platformReportedCacMinor:
            trap!.platformReportedCacMinor,
          averageIncrementalCacMinor:
            trap!.averageIncrementalCacMinor,
          platformAttributedRevenueMinor:
            trap!.platformAttributedRevenueMinor,
          trueIncrementalRevenueMinor:
            trap!.trueIncrementalRevenueMinor,
        }),
      );
    },
    120_000,
  );
});
