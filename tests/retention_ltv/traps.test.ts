import {
  describe,
  expect,
  it,
} from "vitest";
import {
  createCheapCustomerTrapFixture,
  createObservedLtvSelectionTrapFixture,
} from "../../src/retention_ltv/adversarial.js";
import {
  evaluateAcquisitionChannelCounterfactual,
  evaluateRetentionLtvEconomics,
} from "../../src/retention_ltv/evaluator.js";

describe("Step 11 deterministic acceptance traps", () => {
  it(
    "cheap first-order acquisition can lose to higher-CAC acquisition on long-term economic value",
    () => {
      const fixture =
        createCheapCustomerTrapFixture();
      const report =
        evaluateRetentionLtvEconomics(
          fixture.evaluation,
        );
      const a =
        report.acquisitionChannels.find(
          (row) =>
            row.channel ===
            fixture.channelA,
        );
      const b =
        report.acquisitionChannels.find(
          (row) =>
            row.channel ===
            fixture.channelB,
        );
      expect(a).toBeDefined();
      expect(b).toBeDefined();

      const aCounterfactual =
        evaluateAcquisitionChannelCounterfactual(
          fixture.evaluation,
          fixture.channelA,
          report,
        );
      const bCounterfactual =
        evaluateAcquisitionChannelCounterfactual(
          fixture.evaluation,
          fixture.channelB,
          report,
        );

      console.info(
        "STEP11_CHEAP_CUSTOMER_TRAP",
        JSON.stringify({
          channelA: a,
          channelB: b,
          channelACounterfactual: {
            incrementalSpendMinor:
              aCounterfactual
                .incrementalSpendMinor,
            incrementalFirstOrders:
              aCounterfactual
                .incrementalFirstOrders,
            incrementalFirstOrderContributionMinor:
              aCounterfactual
                .incrementalFirstOrderContributionMinor,
            incrementalLongTermContributionAfterAcquisitionCostMinor:
              aCounterfactual
                .incrementalLongTermContributionAfterAcquisitionCostMinor,
            trueIncrementalCustomerValueMinor:
              aCounterfactual
                .trueIncrementalCustomerValueMinor,
          },
          channelBCounterfactual: {
            incrementalSpendMinor:
              bCounterfactual
                .incrementalSpendMinor,
            incrementalFirstOrders:
              bCounterfactual
                .incrementalFirstOrders,
            incrementalFirstOrderContributionMinor:
              bCounterfactual
                .incrementalFirstOrderContributionMinor,
            incrementalLongTermContributionAfterAcquisitionCostMinor:
              bCounterfactual
                .incrementalLongTermContributionAfterAcquisitionCostMinor,
            trueIncrementalCustomerValueMinor:
              bCounterfactual
                .trueIncrementalCustomerValueMinor,
          },
        }),
      );

      expect(
        a!.observedFirstOrderCacMinor,
      ).not.toBeNull();
      expect(
        b!.observedFirstOrderCacMinor,
      ).not.toBeNull();
      expect(
        a!.observedFirstOrderCacMinor!,
      ).toBeLessThan(
        b!.observedFirstOrderCacMinor!,
      );
      expect(
        a!.firstOrderPlatformRoas,
      ).not.toBeNull();
      expect(
        b!.firstOrderPlatformRoas,
      ).not.toBeNull();
      expect(
        a!.firstOrderPlatformRoas!,
      ).toBeGreaterThan(
        b!.firstOrderPlatformRoas!,
      );
      expect(
        b!.repeatContribution365dMinor,
      ).toBeGreaterThan(
        a!.repeatContribution365dMinor,
      );
      expect(
        bCounterfactual
          .incrementalLongTermContributionAfterAcquisitionCostMinor,
      ).toBeGreaterThan(
        aCounterfactual
          .incrementalLongTermContributionAfterAcquisitionCostMinor,
      );
      expect(
        bCounterfactual
          .trueIncrementalCustomerValueMinor,
      ).toBeGreaterThan(
        aCounterfactual
          .trueIncrementalCustomerValueMinor,
      );
    },
    300_000,
  );

  it(
    "higher observed cohort LTV can persist with zero channel causal effect because of selection",
    () => {
      const fixture =
        createObservedLtvSelectionTrapFixture();
      const report =
        evaluateRetentionLtvEconomics(
          fixture.evaluation,
        );
      const selected =
        report.cohorts.find(
          (cohort) =>
            cohort.dimension ===
              "acquisition_channel" &&
            cohort.key ===
              fixture.selectedChannel,
        );
      const comparison =
        report.cohorts.find(
          (cohort) =>
            cohort.dimension ===
              "acquisition_channel" &&
            cohort.key ===
              fixture.comparisonChannel,
        );
      const selectedChannelRow =
        report.acquisitionChannels.find(
          (row) =>
            row.channel ===
            fixture.selectedChannel,
        );
      expect(selected).toBeDefined();
      expect(comparison).toBeDefined();
      expect(
        selectedChannelRow,
      ).toBeDefined();

      const selectedObservedValue =
        selected!
          .averageRealized365dContributionMinor +
        selected!
          .averageExpectedRemainingContributionMinor;
      const comparisonObservedValue =
        comparison!
          .averageRealized365dContributionMinor +
        comparison!
          .averageExpectedRemainingContributionMinor;

      const causalMechanism =
        fixture.evaluation.merchantWorld
          .manifest.channelIncrementality.find(
            (mechanism) =>
              mechanism.channelId ===
              fixture.selectedChannel,
          );

      console.info(
        "STEP11_OBSERVED_LTV_SELECTION_TRAP",
        JSON.stringify({
          selectedChannel:
            fixture.selectedChannel,
          comparisonChannel:
            fixture.comparisonChannel,
          selectedObservedValue,
          comparisonObservedValue,
          selectedCausalEffect:
            causalMechanism?.effect.value,
          selectedCausalTreatmentCustomerWeight:
            selectedChannelRow!
              .causalTreatmentCustomerWeight,
          selectedCohort: selected,
          comparisonCohort: comparison,
        }),
      );

      expect(
        Number(
          causalMechanism?.effect.value ?? NaN,
        ),
      ).toBe(0);
      expect(
        selectedChannelRow!
          .causalTreatmentCustomerWeight,
      ).toBe(0);
      expect(
        selectedObservedValue,
      ).toBeGreaterThan(
        comparisonObservedValue,
      );
    },
    240_000,
  );
});
