import { describe, expect, it } from "vitest";
import { SCHEDULED_SPEND_VERSION, applyBudgetAdjustments, scheduledSpendLedger, scheduledMeasurementSpend,
  requestWithScheduledSpend, validateScheduledSpend, type ScheduledSpendPlan } from "../../src/evaluation/scheduled-spend.js";
import { InteractiveReplayWorld, type RegisteredSimulatorAction } from "../../src/evaluation/interactive-world.js";
import { buildMeasurementScenario } from "../../src/evaluation/scenario-library.js";
import { measurePerfectWorld } from "../../src/measurement_corruption/index.js";
import { scheduledBookedEconomics } from "../../src/evaluation/scheduled-economics.js";
import { sha256 } from "../../src/evaluation/replay-manifest.js";

const DAY = 86400000;
const START = "2026-01-01T00:00:00.000Z", END = "2026-01-05T00:00:00.000Z";
const ZERO = { meta: 0, google_search: 0, google_shopping: 0, pinterest: 0, affiliate: 0 };
function plan(): ScheduledSpendPlan {
  return { version: SCHEDULED_SPEND_VERSION, periodStart: START, periodEnd: END, referencePeriodMs: DAY,
    execution: "fully_spent_time_prorated_allocation", scope: "explicit_simulated_agents",
    initialAllocation: { ...ZERO, meta: 10000, google_search: 20000 }, changes: [] };
}
const total = (p: ScheduledSpendPlan) => scheduledSpendLedger(p).reduce((s, r) => s + r.amountMinor, 0);

describe("time-based expenditure independent of sales", () => {
  it("charges a fixed rate on every closed day, never charging the future at the beginning of a bucket", () => {
    const rows = scheduledSpendLedger(plan());
    expect(total(plan())).toBe(120000);
    expect(rows).toHaveLength(8);
    expect(rows[0]!.occurredAt).toBe("2026-01-01T23:59:59.999Z");
    expect(rows.every(r => Date.parse(r.occurredAt) < Date.parse(END))).toBe(true);
    expect(rows.filter(r => r.channel === "meta").map(r => r.amountMinor)).toEqual([10000, 10000, 10000, 10000]);
  });
  it("accumulates fractional cents with exact rational arithmetic across partial buckets", () => {
    const p = { ...plan(), periodEnd: "2026-01-03T12:00:00.000Z", referencePeriodMs: 3 * DAY,
      initialAllocation: { ...ZERO, meta: 10 } };
    expect(scheduledSpendLedger(p).map(r => r.amountMinor)).toEqual([3, 3, 2]);
    expect(total(p)).toBe(8); // floor(10 * 2.5 / 3), not independently rounded day sums.
  });
  it("integrates a mid-day change without rewriting an already closed bucket", () => {
    const p = plan(), previous = scheduledSpendLedger(p).filter(r => Date.parse(r.occurredAt) < Date.parse("2026-01-02T00:00:00Z"));
    p.changes.push({ decisionId: "d1", effectiveAt: "2026-01-02T12:00:00.000Z", allocation: { ...ZERO, meta: 30000, google_search: 20000 } });
    expect(scheduledSpendLedger(p).filter(r => Date.parse(r.occurredAt) < Date.parse("2026-01-02T00:00:00Z"))).toEqual(previous);
    expect(scheduledSpendLedger(p).filter(r => r.channel === "meta").map(r => r.amountMinor)).toEqual([10000, 20000, 30000, 30000]);
    expect(total(p)).toBe(170000);
  });
  it("preserves completed-debit prefixes when future decisions are appended", () => {
    const p = plan();
    const cutoff = Date.parse("2026-01-03T12:00:00.000Z");
    const before = scheduledSpendLedger(p).filter(r => Date.parse(r.occurredAt) <= cutoff);
    p.changes.push({ decisionId: "future", effectiveAt: new Date(cutoff + 1).toISOString(), allocation: ZERO });
    expect(scheduledSpendLedger(p).filter(r => Date.parse(r.occurredAt) <= cutoff)).toEqual(before);
  });
  it("keeps Meta and Google reporting as independent expense feeds, not attributed sales", () => {
    const p = { ...plan(), initialAllocation: { ...ZERO, meta: 100, google_search: 200, google_shopping: 300, pinterest: 400 } };
    const feed = scheduledMeasurementSpend(p);
    expect(feed.filter(r => r.platform === "meta").reduce((s, r) => s + r.amountMinor, 0)).toBe(400);
    expect(feed.filter(r => r.platform === "google").reduce((s, r) => s + r.amountMinor, 0)).toBe(2000);
    expect(total(p)).toBe(4000); // Pinterest still counts in true economics even though this feed has only two platforms.
  });
  it("validates dates, duplicate decisions, duplicate adjustments, negative budgets and overflow", () => {
    expect(() => validateScheduledSpend({ ...plan(), referencePeriodMs: 0 })).toThrow();
    const change = { decisionId: "x", effectiveAt: "2026-01-02T00:00:00.000Z", allocation: ZERO };
    expect(() => validateScheduledSpend({ ...plan(), changes: [change, change] })).toThrow();
    expect(() => applyBudgetAdjustments(ZERO, [{ channel: "meta", operation: "delta", amountMinor: -1 }])).toThrow();
    expect(() => applyBudgetAdjustments(ZERO, [{ channel: "meta", operation: "set", amountMinor: 1 }, { channel: "meta", operation: "set", amountMinor: 2 }])).toThrow();
    expect(() => total({ ...plan(), initialAllocation: { ...ZERO, meta: Number.MAX_SAFE_INTEGER } })).toThrow();
  });
});

function setup() {
  const built = buildMeasurementScenario("adv-013", 1410);
  const initial = { ...built.request, endTime: END,
    interventions: built.request.interventions!.filter(i => !i.variable.startsWith("marketing.")) };
  const actions: RegisteredSimulatorAction[] = [
    { actionId: "a0", interventions: [] },
    { actionId: "a1", interventions: [], budgetAdjustments: [{ channel: "meta", operation: "delta", amountMinor: 100000 }] },
    { actionId: "a2", interventions: [], budgetAdjustments: [{ channel: "google_search", operation: "delta", amountMinor: 100000 }] },
    { actionId: "a3", interventions: [], budgetAdjustments: [{ channel: "meta", operation: "set", amountMinor: 0 }] },
    { actionId: "a4", interventions: [], budgetAdjustments: [{ channel: "meta", operation: "delta", amountMinor: -200000 }] },
  ];
  const settings = { initial, actions, stepMs: DAY, spendPlan: plan(),
    measurement: { corruption: built.controlCorruption, platformSpend: [], scope: "explicit_simulated_agents" as const } };
  return { settings, world: new InteractiveReplayWorld(settings) };
}

describe("adaptive budget actions in world.step", () => {
  it("resets action history and reproduces both budget decisions and observed output exactly", () => {
    const { world } = setup();
    const empty = world.observe();
    const first = world.step("a0"), second = world.step("a1"), spend = world.evaluatorSpendSnapshot();
    expect(world.reset(1410)).toEqual(empty);
    expect(world.step("a0")).toEqual(first);
    expect(world.step("a1")).toEqual(second);
    expect(world.evaluatorSpendSnapshot()).toEqual(spend);
    expect(spend!.plan.changes[0]!.allocation.meta).toBe(110000);
    expect(spend!.plan.changes[0]!.effectiveAt).toBe("2026-01-02T00:00:00.001Z");
  }, 45000);
  it("cannot rewrite delivered orders, events or past spend after increasing Google", () => {
    const { world, settings } = setup();
    const before = world.step("a0");
    world.step("a2");
    const bundle = world.evaluatorSnapshot();
    const past = measurePerfectWorld(bundle.perfectObservableTruth, settings.measurement.corruption, before.asOf).observation;
    expect(sha256(past)).toBe(sha256(before));
    const interventions = bundle.latentTruth.request.interventions!.filter(i => i.variable === "marketing.google_search.spend");
    expect(interventions.map(i => i.value.kind === "number" ? i.value.value : null)).toEqual([80000, 480000]);
    expect(Date.parse(interventions[1]!.effectiveAt!)).toBe(Date.parse(before.asOf) + 1);
  }, 45000);
  it("does not commit invalid budget changes and sanitizes internal details for the Operator", () => {
    const { world } = setup();
    const handle = world.observedHandle(), before = handle.observe(), ledger = world.evaluatorSpendSnapshot();
    expect(() => handle.step("a4")).toThrow("OBSERVED_WORLD_OPERATION_FAILED");
    expect(handle.observe()).toEqual(before);
    expect(world.evaluatorSpendSnapshot()).toEqual(ledger);
    expect(Object.keys(handle).sort()).toEqual(["observe", "step"]);
    expect(JSON.stringify(handle)).not.toContain("allocation");
  }, 45000);
  it("disables future Meta expenditure but retains already reported debits", () => {
    const { world } = setup();
    const before = world.step("a0"); world.step("a3");
    const ledger = world.evaluatorSpendSnapshot()!.debits;
    expect(ledger.filter(r => r.channel === "meta").map(r => r.amountMinor)).toEqual([10000]);
    expect(world.observe().platformReports.find(r => r.platform === "meta")!.spendMinor).toBe(before.platformReports.find(r => r.platform === "meta")!.spendMinor);
  }, 45000);
  it("rejects competing ledgers, raw marketing actions, inactive channels and preloaded future decisions", () => {
    const { settings } = setup();
    expect(() => new InteractiveReplayWorld({ ...settings, measurement: { ...settings.measurement,
      platformSpend: [{ id: "x", platform: "meta", occurredAt: START, amountMinor: 1 }] } })).toThrow("sole spend authority");
    expect(() => requestWithScheduledSpend({ ...settings.initial,
      interventions: [{ variable: "marketing.meta.spend", operation: "set", value: { kind: "number", value: 1, unit: "money_minor" } }] }, plan())).toThrow("two competing");
    expect(() => new InteractiveReplayWorld({ ...settings, spendPlan: { ...plan(), changes: [{ decisionId: "future", effectiveAt: "2026-01-02T00:00:00.000Z", allocation: ZERO }] } })).toThrow();
  }, 45000);
});


describe("scheduled budget consequences reconcile", () => {
  it("null-effect budget decisions change expense, not purchases, and do not count future spending", () => {
    const { world } = setup();
    world.step("a0"); world.step("a0");
    const base = world.evaluatorSnapshot(), basePlan = world.evaluatorSpendSnapshot()!.plan;
    const baseline = scheduledBookedEconomics(base.latentTruth.request, base.latentTruth.simulation, basePlan, world.observe().asOf);
    world.reset(1410); world.step("a0"); world.step("a1");
    const changed = world.evaluatorSnapshot(), changedPlan = world.evaluatorSpendSnapshot()!.plan;
    const treatment = scheduledBookedEconomics(changed.latentTruth.request, changed.latentTruth.simulation, changedPlan, world.observe().asOf);
    // This fixture has known zero direct AND mediated effects; no causal inference is made from its ROAS.
    expect(treatment.economics.netSalesMinor).toBe(baseline.economics.netSalesMinor);
    expect(treatment.orders).toBe(baseline.orders);
    const delta = treatment.economics.paidSpendMinor - baseline.economics.paidSpendMinor;
    expect(delta).toBe(99999); // Exact debit after a one-ms-later activation, no rounded $1,000 fiction.
    expect(treatment.contributionMinor - baseline.contributionMinor).toBe(-delta);
    expect(treatment.economics.paidSpendMinor).toBeLessThan(total(changedPlan));
    expect(() => scheduledBookedEconomics(changed.latentTruth.request, changed.latentTruth.simulation, basePlan)).toThrow();
  }, 45000);
  it("rejects unsupported economics and changed action histories instead of silently understating cost", () => {
    const { world } = setup(); world.step("a0");
    const bundle = world.evaluatorSnapshot(), p = world.evaluatorSpendSnapshot()!.plan;
    const { request, simulation } = bundle.latentTruth;
    expect(() => scheduledBookedEconomics({ ...request, commercePolicy: { enableInventoryDynamics: true } }, simulation, p)).toThrow("does not cover");
    expect(() => scheduledBookedEconomics(request, { ...simulation, provenance: { ...simulation.provenance, simulationSeed: 99 } }, p)).toThrow("mismatch");
  }, 45000);
});
