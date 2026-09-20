import { describe, expect, it } from "vitest";
import {
  createPortfolioReallocationTrapFixture,
  createProspectingCutTrapFixture,
} from "../../src/cross_channel/adversarial.js";
import {
  evaluatePairwiseInteraction,
  evaluatePortfolio,
  evaluateReallocation,
  evaluateReallocationAcrossHorizons,
  normalizedPortfolioSpend,
} from "../../src/cross_channel/evaluator.js";
import { buildPlatformChannelReport } from "../../src/advertising_economics/platform.js";
import type {
  CrossChannelFixture,
  PortfolioEvaluationRequest,
} from "../../src/cross_channel/types.js";

function request(
  fixture: CrossChannelFixture,
  end = "2026-04-01T00:00:00.000Z",
): PortfolioEvaluationRequest {
  return {
    merchantWorld: fixture.merchantWorld,
    latentPopulation: fixture.latentPopulation,
    simulationSeed: fixture.simulationSeed,
    periodStart: "2026-01-01T00:00:00.000Z",
    periodEnd: end,
    spendMinorByChannel: {},
    simulationConfig: {
      maxEvents: 320_000,
      maxSessionsPerCustomer: 22,
    },
  };
}

function observedConversion(
  evaluation: ReturnType<typeof evaluatePortfolio>,
  source: string,
): number {
  const metric = evaluation.outcome.sourceMetrics.find(
    (candidate) => candidate.source === source,
  );
  if (!metric || metric.sessions <= 0) return 0;
  return metric.purchases / metric.sessions;
}

describe("Step 6 hard interaction traps", () => {
  it(
    "portfolio reallocation trap: independent channel signals point to Google, but moving Meta budget to Google loses true contribution profit",
    () => {
      const fixture =
        createPortfolioReallocationTrapFixture();
      const req = request(fixture);
      const spend = normalizedPortfolioSpend(req);
      const factual = evaluatePortfolio(req);

      const metaPlatform = buildPlatformChannelReport(
        factual.simulation,
        fixture.latentPopulation,
        "meta",
        spend.meta,
      );
      const googlePlatform = buildPlatformChannelReport(
        factual.simulation,
        fixture.latentPopulation,
        "google_search",
        spend.google_search,
      );

      const pair = evaluatePairwiseInteraction(
        req,
        "meta",
        "google_search",
      );
      const metaStandaloneIroas =
        spend.meta > 0
          ? (pair.leftOnly.representedRevenueMinor -
              pair.neither.representedRevenueMinor) /
            spend.meta
          : 0;
      const googleStandaloneIroas =
        spend.google_search > 0
          ? (pair.rightOnly.representedRevenueMinor -
              pair.neither.representedRevenueMinor) /
            spend.google_search
          : 0;

      const transfer = spend.meta * 0.65;
      const reallocation = evaluateReallocation(
        req,
        {
          meta: -transfer,
          google_search: transfer,
        },
      );

      expect(googlePlatform.reportedRoas).not.toBeNull();
      expect(metaPlatform.reportedRoas).not.toBeNull();
      expect(googlePlatform.reportedRoas!).toBeGreaterThan(
        metaPlatform.reportedRoas!,
      );

      expect(
        observedConversion(factual, "google_search"),
      ).toBeGreaterThan(
        observedConversion(factual, "meta"),
      );

      // Standalone iROAS is diagnostic only here. The source acceptance
      // contract says B "may even" have higher standalone iROAS; the
      // mandatory misleading independent signals are platform ROAS and
      // observed conversion.
      expect(
        reallocation.delta
          .representedContributionProfitMinor,
      ).toBeLessThan(0);

      console.info(
        "STEP6_PORTFOLIO_REALLOCATION_TRAP",
        JSON.stringify({
          metaPlatformRoas:
            metaPlatform.reportedRoas,
          googlePlatformRoas:
            googlePlatform.reportedRoas,
          metaObservedConversion:
            observedConversion(factual, "meta"),
          googleObservedConversion:
            observedConversion(
              factual,
              "google_search",
            ),
          metaStandaloneIroas,
          googleStandaloneIroas,
          transferMinor: transfer,
          contributionProfitDeltaMinor:
            reallocation.delta
              .representedContributionProfitMinor,
          revenueDeltaMinor:
            reallocation.delta
              .representedRevenueMinor,
        }),
      );
    },
    150_000,
  );

  it(
    "prospecting-cut trap: 7-day efficiency improves while 90-day economics and future audiences deteriorate",
    () => {
      const fixture = createProspectingCutTrapFixture();
      const req = request(
        fixture,
        "2026-04-01T00:00:00.000Z",
      );
      const spend = normalizedPortfolioSpend(req);
      const metaCut = -(spend.meta * 0.5);

      const horizons =
        evaluateReallocationAcrossHorizons(
          req,
          { meta: metaCut },
          [7, 90],
        );

      const seven = horizons.find(
        (entry) => entry.horizonDays === 7,
      )!.evaluation.delta;
      const ninety = horizons.find(
        (entry) => entry.horizonDays === 90,
      )!.evaluation.delta;

      console.info(
        "STEP6_PROSPECTING_CUT_TRAP",
        JSON.stringify({
          sevenDayContributionDelta:
            seven.representedContributionProfitMinor,
          ninetyDayContributionDelta:
            ninety.representedContributionProfitMinor,
          ninetyDayRevenueDelta:
            ninety.representedRevenueMinor,
          ninetyDayBrandedAudienceDelta:
            ninety.futureAudience
              .representedBrandedSearchReady,
          ninetyDayRetargetingAudienceDelta:
            ninety.futureAudience
              .representedRetargetingEligible,
          ninetyDayEmailAudienceDelta:
            ninety.futureAudience
              .representedEmailEligible,
        }),
      );

      expect(
        seven.representedContributionProfitMinor,
      ).toBeGreaterThan(0);
      expect(
        ninety.representedContributionProfitMinor,
      ).toBeLessThan(0);
      expect(
        ninety.representedRevenueMinor,
      ).toBeLessThan(0);

      expect(
        ninety.futureAudience
          .representedBrandedSearchReady,
      ).toBeLessThan(0);
      expect(
        ninety.futureAudience
          .representedRetargetingEligible,
      ).toBeLessThan(0);
      expect(
        ninety.futureAudience
          .representedEmailEligible,
      ).toBeLessThan(0);


    },
    150_000,
  );
});
