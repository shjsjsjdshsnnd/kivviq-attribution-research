import { afterAll, describe, expect, it } from "vitest";
import { MEASUREMENT_SCENARIO_IDS, SCENARIO_SEED_SPLIT, runMeasurementScenario,
  buildMeasurementScenario, evaluateMeasurementScenarioActions, measurementScenarioAdmission, type ScenarioVerification } from "../../src/evaluation/scenario-library.js";
import { measurementSpendLedger, requestWithScenarioSpend, scenarioBookedEconomics,
  scenarioSpendLedger, validateScenarioSpend } from "../../src/evaluation/scenario-spend.js";
import { runMeasuredWorld, operatorPayload } from "../../src/evaluation/measured-world.js";
import { parseOperatorObservation } from "../../src/observation/corrupted-world.js";
import { createMeasuredManifest, replayMeasuredManifest, sha256 } from "../../src/evaluation/replay-manifest.js";
import { decisionRegret } from "../../src/evaluation/finite-decision-oracle.js";

import { parseSimulationArgs } from "../../src/evaluation/simulate-cli.js";

const REVISION = "0123456789abcdef0123456789abcdef01234567";
describe("executable measurement scenario mechanisms", () => {
  const records: ScenarioVerification[] = [];
  afterAll(() => {
    const admission = measurementScenarioAdmission(records);
    expect(admission.verifiedMeasurementFamilies).toHaveLength(8);
    expect(admission.families.find(f => f.scenarioId === "adv-015")?.status).toBe("UNQUALIFIED");
    expect(admission.phase1AcceptedScenarioIds).toEqual([]);
    console.log("MEASUREMENT_SCENARIO_ADMISSION", JSON.stringify(admission));
    expect(() => measurementScenarioAdmission(records.slice(1))).toThrow("every preregistered");
    const corruptedRecord = records.map((record, index) => index === 0 ? { ...record, predicates: [] } : record);
    expect(() => measurementScenarioAdmission(corruptedRecord)).toThrow("incomplete scenario verification");
  });
  it("separates public development and validation seeds without pretending either is a sealed benchmark", () => {
    expect(SCENARIO_SEED_SPLIT.development.every(s => !(SCENARIO_SEED_SPLIT.validation as readonly number[]).includes(s))).toBe(true);
    expect(new Set(MEASUREMENT_SCENARIO_IDS).size).toBe(9);
  });
  for (const partition of ["development", "validation"] as const) {
    for (const id of MEASUREMENT_SCENARIO_IDS) {
      for (const seed of SCENARIO_SEED_SPLIT[partition]) {
        it(`${partition}: ${id} / ${seed} verifies both the apparent trap and measurement-only control`, () => {
          const result = runMeasurementScenario(id, seed);
          const failures = result.verification.predicates.filter(p => !p.passed);
          records.push(result.verification);
          // Retain the discovered validation failure. This is a negative admission
          // regression, NOT a weaker definition of successful platform overlap.
          if (partition === "validation" && id === "adv-015") {
            expect(failures.map(p => p.id)).toEqual(["independent_platform_claims_overlap"]);
            expect(result.verification.status).toBe("FAIL");
          } else {
            expect(failures, JSON.stringify(result.verification)).toEqual([]);
            expect(result.verification.status).toBe("PASS");
          }
          expect(result.verification.qualification).toBe("measurement_mechanism_only_not_phase1_scenario_acceptance");
          expect(() => parseOperatorObservation(JSON.parse(operatorPayload(result.bundle)))).not.toThrow();
        }, 45000);
      }
    }
  }
  it("CLI accepts the registered scenario IDs without opening arbitrary file paths", () => {
    for (const id of MEASUREMENT_SCENARIO_IDS) expect(parseSimulationArgs(["--scenario", id, "--seed", "1410"]))
      .toEqual({ mode: "generate", scenario: id, seed: 1410 });
  });
  it("rejects unknown scenarios and invalid seeds", () => {
    expect(() => buildMeasurementScenario("not-a-scenario", 1)).toThrow();
    expect(() => buildMeasurementScenario("adv-008", -1)).toThrow();
  });
  it("replays the full latent/perfect/corrupted fixture without sharing its manifest", () => {
    const input = buildMeasurementScenario("adv-015", 1410);
    const { manifest, bundle } = createMeasuredManifest({ request: input.request, options: input.options,
      scenarioId: "adv-015", scenarioVersion: "measurement-scenario-library/0.1.0", codeRevision: REVISION });
    const replayed = replayMeasuredManifest(manifest, REVISION);
    expect(sha256(replayed.latentTruth)).toBe(sha256(bundle.latentTruth));
    expect(operatorPayload(replayed)).toBe(operatorPayload(bundle));
    expect(operatorPayload(bundle)).not.toContain(manifest.sha256);
  }, 45000);
});

describe("period expenditure is not a revenue allocation", () => {
  it("debits every cent for a fractional-day horizon without arithmetic drift", () => {
    const input = buildMeasurementScenario("adv-013", 1410);
    const plan = { ...input.spendPlan, periodEnd: "2026-01-03T12:00:00.000Z",
      allocation: { meta: 101, google_search: 1, google_shopping: 0, pinterest: 0, affiliate: 0 } };
    const ledger = scenarioSpendLedger(plan);
    expect(ledger.filter(e => e.channel === "meta").map(e => e.amountMinor)).toEqual([40, 40, 21]);
    expect(ledger.reduce((s, e) => s + e.amountMinor, 0)).toBe(102);
    expect(measurementSpendLedger(plan).reduce((s, e) => s + e.amountMinor, 0)).toBe(102);
  });
  it("rejects negative/overflow allocations, mismatched horizons and competing spend authorities", () => {
    const input = buildMeasurementScenario("adv-013", 1410);
    expect(() => validateScenarioSpend({ ...input.spendPlan, allocation: { ...input.spendPlan.allocation, meta: -1 } })).toThrow();
    expect(() => validateScenarioSpend({ ...input.spendPlan, allocation: { ...input.spendPlan.allocation, meta: Number.MAX_SAFE_INTEGER } })).toThrow();
    expect(() => requestWithScenarioSpend(input.request, input.spendPlan)).toThrow("two competing");
    expect(() => requestWithScenarioSpend(input.request, { ...input.spendPlan, periodEnd: input.spendPlan.periodStart })).toThrow();
  });
  it("keeps expenditure when no purchases occur and never silently drops uncovered economics", () => {
    const input = buildMeasurementScenario("adv-012", 1410);
    const request = { ...input.request, interventions: [...(input.request.interventions ?? []), {
      variable: "inventory.available", operation: "set" as const,
      value: { kind: "number" as const, value: 0, unit: "units" as const },
    }] };
    const result = runMeasuredWorld(request, input.options);
    expect(result.latentTruth.simulation.purchases).toHaveLength(0);
    const value = scenarioBookedEconomics(request, result.latentTruth.simulation, input.spendPlan);
    expect(value.economics.netSalesMinor).toBe(0);
    expect(value.economics.paidSpendMinor).toBe(125000);
    expect(() => scenarioBookedEconomics({ ...request, commercePolicy: { enableInventoryDynamics: true } },
      result.latentTruth.simulation, input.spendPlan)).toThrow("does not cover");
    expect(() => scenarioBookedEconomics(request, result.latentTruth.simulation,
      { ...input.spendPlan, allocation: { ...input.spendPlan.allocation, meta: 0 } })).toThrow("ledger differ");
  }, 45000);
});

describe("simulator-backed finite allocation oracle", () => {
  it("recovers exactly negative marginal spend for zero-effect channels on every declared validation seed", async () => {
    const result = await evaluateMeasurementScenarioActions("adv-015", SCENARIO_SEED_SPLIT.validation);
    expect(result.evaluatedActions).toBe(6);
    expect(result.bestActionId).toBe("a5");
    for (const id of ["a1", "a2"]) {
      const row = result.ranking.find(r => r.actionId === id)!;
      expect(row.meanDeltaVersusBaselineMinor).toBe(-100000);
      expect(row.pairedDeltaStandardErrorMinor).toBe(0);
    }
    expect(decisionRegret(result, "a1").regretMinor).toBe(225000);
    expect(result.scope).toContain("no_returns_no_clv_no_overhead");
    expect(result.access).toBe("evaluator_only");
    expect(decisionRegret(result, "a1").expectedRegretVerified).toBe(false);
  }, 120000);
});
