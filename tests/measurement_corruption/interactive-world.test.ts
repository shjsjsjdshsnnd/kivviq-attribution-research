import { describe, expect, it } from "vitest";
import { InteractiveReplayWorld, type RegisteredSimulatorAction } from "../../src/evaluation/interactive-world.js";
import { zeroPaidSpendInterventions } from "../../src/simulation/counterfactual.js";
import { MEASUREMENT_VERSION } from "../../src/measurement_corruption/index.js";
import { EXTERNAL_REALITY_MODEL_VERSION } from "../../src/external_reality/index.js";
import { utcTimestamp } from "../../src/core/units.js";
import { baseAdversarialWorld, populationFor } from "../simulation/fixture.js";

function setup() {
  const merchantWorld = baseAdversarialWorld(64121);
  const initial = {
    merchantWorld, latentPopulation: populationFor(merchantWorld, 74121, 40), simulationSeed: 1421,
    startTime: "2026-01-01T00:00:00.000Z", endTime: "2026-02-01T00:00:00.000Z",
    interventions: zeroPaidSpendInterventions(merchantWorld),
    config: { maxEvents: 120000, maxSessionsPerCustomer: 12 },
    commercePolicy: { customerShippingChargeMinor: 1200, externalRealityEnvironment: {
      version: EXTERNAL_REALITY_MODEL_VERSION, environmentId: "preserved-environment", seed: 4, events: [],
    } },
  };
  const actions: RegisteredSimulatorAction[] = [
    { actionId: "no_op", interventions: [] },
    { actionId: "set_price", interventions: [{ variable: "pricing.product_price", operation: "set",
      value: { kind: "number", unit: "money_minor", value: 15000 } }] },
  ];
  const settings = { initial, actions, stepMs: 7 * 86400000, measurement: {
    corruption: { version: MEASUREMENT_VERSION, seed: 55, identitySalt: "private-interactive-fixture-salt",
      delayedEventRate: 0.2, maxEventDelayMs: 86400000, cookieLossRate: 0.3, duplicateEventRate: 0.1 },
    platformSpend: [], scope: "explicit_simulated_agents" as const,
  } };
  return { settings, world: new InteractiveReplayWorld(settings) };
}

describe("interactive observed-world replay", () => {
  it("reset with the same seed removes action history and reproduces identical steps", () => {
    const { world } = setup();
    const initial = world.observe();
    const first = world.step("no_op");
    const second = world.step("set_price");
    expect(Date.parse(first.asOf)).toBe(Date.parse(initial.asOf) + 7 * 86400000);
    expect(world.reset(1421)).toEqual(initial);
    expect(world.step("no_op")).toEqual(first);
    expect(world.step("set_price")).toEqual(second);
  }, 45000);
  it("an action cannot change delivered past observations and policies remain attached", () => {
    const { world, settings } = setup();
    const before = world.step("no_op");
    const after = world.step("set_price");
    expect(after.events.filter(e => Date.parse(e.receivedAt) <= Date.parse(before.asOf))).toEqual(before.events);
    const snapshot = world.evaluatorSnapshot();
    expect(snapshot.latentTruth.request.commercePolicy).toEqual(settings.initial.commercePolicy);
    expect(snapshot.latentTruth.request.latentPopulation).toEqual(settings.initial.latentPopulation);
    const last = snapshot.latentTruth.request.interventions?.at(-1);
    expect(last?.variable).toBe("pricing.product_price");
    expect(Date.parse(last!.effectiveAt!)).toBe(Date.parse(before.asOf) + 1);
  }, 45000);
  it("the Operator facade returns only independent corrupted snapshots, with no truth/reset handle", () => {
    const { world } = setup();
    const handle = world.observedHandle();
    expect(Object.keys(handle).sort()).toEqual(["observe", "step"]);
    const view = handle.step("no_op");
    const saved = JSON.stringify(view);
    view.events.length = 0;
    expect(JSON.stringify(handle.observe())).toBe(saved);
    expect(saved).not.toContain("latentTruth");
    expect(saved).not.toContain("simulationSeed");
    expect(saved).not.toContain("private-interactive-fixture-salt");
    const beforeError = handle.observe();
    expect(() => handle.step("unknown")).toThrow("unregistered");
    expect(handle.observe()).toEqual(beforeError);
  }, 45000);
  it("rejects retroactive/scoped scheduling and budget actions without true-spend accounting", () => {
    const { settings } = setup();
    expect(() => new InteractiveReplayWorld({ ...settings, actions: [settings.actions[0]!, {
      actionId: "past", interventions: [{ variable: "pricing.product_price", operation: "set",
        effectiveAt: utcTimestamp("2025-01-01T00:00:00.000Z"), value: { kind: "number", unit: "money_minor", value: 1000 } }],
    }] })).toThrow();
    const spend = settings.initial.interventions[0];
    expect(spend).toBeDefined();
    expect(() => new InteractiveReplayWorld({ ...settings, actions: [settings.actions[0]!, { actionId: "change_budget", interventions: [spend!] }] })).toThrow("actual-spend adapter");
    expect(() => new InteractiveReplayWorld({ ...settings, stepMs: 0 })).toThrow();
  }, 45000);
});
