import { beforeAll, describe, expect, it } from "vitest";
import { customerValueFromFixedEpisode } from "../../src/evaluation/customer-value-ledger.js";
import { buildRetentionValidationPair } from "../../src/evaluation/domain-validation-suite.js";
import { simulateWorld } from "../../src/simulation/simulator.js";
import type { SimulateWorldRequest, SimulationResult, RealizedPurchase } from "../../src/simulation/types.js";
import { sha256 } from "../../src/evaluation/replay-manifest.js";
const ASOF = "2026-04-01T00:00:00.000Z";
describe("customer value uses one fixed episode, not a resimulated shorter world", () => {
  let request: SimulateWorldRequest, simulation: SimulationResult;
  beforeAll(() => { request = buildRetentionValidationPair(211201).treatment; simulation = simulateWorld(request); }, 90000);
  it("reconciles every realized customer value to the orders and keeps future truth separate", () => {
    const ledger = customerValueFromFixedEpisode(request, simulation, ASOF);
    expect(ledger.access).toBe("evaluator_only");
    expect(ledger.realizedAtAsOf.totals.orders).toBeGreaterThan(0);
    expect(ledger.futureRealizedTruthNotForecast.totals.orders).toBeGreaterThan(0);
    const full = customerValueFromFixedEpisode(request, simulation, request.endTime);
    expect(ledger.realizedAtAsOf.totals.netMerchandiseSalesMinor + ledger.futureRealizedTruthNotForecast.totals.netMerchandiseSalesMinor)
      .toBe(full.realizedAtAsOf.totals.netMerchandiseSalesMinor);
    expect(full.futureRealizedTruthNotForecast.totals.orders).toBe(0);
    expect(ledger.realizedAtAsOf.rows).toHaveLength(request.latentPopulation.customers.length);
  });
  it("does not change the earlier customer ledger when future order value changes", () => {
    const baseline = customerValueFromFixedEpisode(request, simulation, ASOF);
    const altered = structuredClone(simulation);
    const future = altered.purchases.find(p => Date.parse(p.occurredAt) > Date.parse(ASOF))!;
    // A self-consistent one-unit COGS/fee adjustment; altering history is not needed.
    (future as { paymentFeeMinor: number }).paymentFeeMinor += 1;
    (future as { contributionProfitMinor: number }).contributionProfitMinor -= 1;
    const changed = customerValueFromFixedEpisode(request, altered, ASOF);
    expect(changed.realizedAtAsOf).toEqual(baseline.realizedAtAsOf);
    expect(changed.futureRealizedTruthNotForecast.totals.bookedContributionBeforeAdvertisingMinor)
      .toBe(baseline.futureRealizedTruthNotForecast.totals.bookedContributionBeforeAdvertisingMinor - 1);
  });
  it("is input-order invariant and does not mutate caller data", () => {
    const before = sha256({ request, simulation });
    const baseline = customerValueFromFixedEpisode(request, simulation, ASOF);
    const reverse = customerValueFromFixedEpisode({ ...request, latentPopulation: { ...request.latentPopulation,
      customers: [...request.latentPopulation.customers].reverse() } }, { ...simulation, purchases: [...simulation.purchases].reverse() }, ASOF);
    expect(reverse).toEqual(baseline); expect(sha256({ request, simulation })).toBe(before);
  });
  it("rejects duplicate orders, unknown customers, pre-episode orders and unbalanced accounting", () => {
    const duplicate = { ...simulation, purchases: [...simulation.purchases, simulation.purchases[0]!] };
    expect(() => customerValueFromFixedEpisode(request, duplicate, ASOF)).toThrow();
    const patch = (changes: Partial<RealizedPurchase>) => ({ ...simulation, purchases: [{ ...simulation.purchases[0]!, ...changes }, ...simulation.purchases.slice(1)] });
    for (const changes of [{ customerId: "unknown" }, { occurredAt: "2025-12-01T00:00:00.000Z" }, { netRevenueMinor: -1 },
      { contributionProfitMinor: simulation.purchases[0]!.contributionProfitMinor + 1 }]) {
      expect(() => customerValueFromFixedEpisode(request, patch(changes), ASOF)).toThrow();
    }
  });
  it("rejects wrong provenance and invalid asOf windows", () => {
    expect(() => customerValueFromFixedEpisode({ ...request, simulationSeed: request.simulationSeed + 1 }, simulation, ASOF)).toThrow();
    for (const asOf of ["not-a-time", "2025-12-31T00:00:00.000Z", "2027-02-01T00:00:00.000Z"]) {
      expect(() => customerValueFromFixedEpisode(request, simulation, asOf)).toThrow();
    }
  });
});
