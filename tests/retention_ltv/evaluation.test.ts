import {
  describe,
  expect,
  it,
} from "vitest";
import {
  createCheapCustomerTrapFixture,
} from "../../src/retention_ltv/adversarial.js";
import {
  evaluateRetentionLtvEconomics,
} from "../../src/retention_ltv/evaluator.js";

describe("Step 11 longitudinal evaluator", () => {
  it(
    "separates realized economics, expected future value, and oracle future outcomes",
    () => {
      const fixture =
        createCheapCustomerTrapFixture();
      const report =
        evaluateRetentionLtvEconomics(
          fixture.evaluation,
        );

      expect(report.godModeOnly).toBe(true);
      expect(
        report.observedReport.simulation
          .provenance.endTime,
      ).toBe(fixture.evaluation.asOf);
      expect(
        report.fullHorizonReport.simulation
          .provenance.endTime,
      ).toBe(
        fixture.evaluation.simulationEnd,
      );

      const weightedLedgerContribution =
        report.customerLedger.reduce(
          (sum, ledger) =>
            sum +
            ledger
              .realizedContributionProfitBeforeAdvertisingMinor *
              ledger.populationWeight,
          0,
        );
      const weights = new Map(
        report.customerLedger.map(
          (ledger) =>
            [
              ledger.customerId,
              ledger.populationWeight,
            ] as const,
        ),
      );
      const weightedOrderContribution =
        report.observedReport.orders.reduce(
          (sum, order) =>
            sum +
            order
              .contributionProfitBeforeAdvertisingMinor *
              (weights.get(order.customerId) ??
                1),
          0,
        );

      expect(
        Math.round(
          weightedLedgerContribution,
        ),
      ).toBe(
        Math.round(
          weightedOrderContribution,
        ),
      );

      const futureObserved =
        report.customerLedger.find(
          (ledger) =>
            ledger.expectedValue
              .expectedFutureOrders > 0,
        );
      expect(futureObserved).toBeDefined();
      expect(
        futureObserved!.expectedValue
          .horizonDays,
      ).toBe(730);
      expect(
        Number.isFinite(
          futureObserved!.expectedValue
            .uncertainty
            .standardDeviationContributionMinor,
        ),
      ).toBe(true);

      expect(
        report.retentionCurve.map(
          (point) => point.day,
        ),
      ).toEqual([
        30,
        60,
        90,
        180,
        365,
      ]);
      expect(
        report.cohorts.some(
          (cohort) =>
            cohort.dimension ===
            "acquisition_channel",
        ),
      ).toBe(true);
    },
    180_000,
  );

  it(
    "generates second and third purchases through the normal commerce path",
    () => {
      const fixture =
        createCheapCustomerTrapFixture();
      const report =
        evaluateRetentionLtvEconomics(
          fixture.evaluation,
        );
      const ordersByCustomer = new Map<
        string,
        typeof report.fullHorizonReport.orders
      >();
      for (const order of report
        .fullHorizonReport.orders) {
        const list =
          ordersByCustomer.get(
            order.customerId,
          ) ?? [];
        ordersByCustomer.set(
          order.customerId,
          [...list, order],
        );
      }
      const maxOrders = Math.max(
        0,
        ...[...ordersByCustomer.values()].map(
          (orders) => orders.length,
        ),
      );
      expect(maxOrders).toBeGreaterThanOrEqual(
        3,
      );

      const repeatOrders =
        report.fullHorizonReport.orders.filter(
          (order) => order.repeatPurchase,
        );
      expect(
        repeatOrders.length,
      ).toBeGreaterThan(0);
      const purchaseEventIds = new Set(
        report.fullHorizonReport.simulation
          .observableEvents
          .filter(
            (event) =>
              event.eventType === "purchase",
          )
          .map((event) => event.orderId),
      );
      for (const repeat of repeatOrders) {
        expect(
          purchaseEventIds.has(
            repeat.orderId,
          ),
        ).toBe(true);
      }

      expect(
        report.timeToSecondPurchase
          .representedCustomersWithSecondPurchase,
      ).toBeGreaterThan(0);
    },
    180_000,
  );
});
