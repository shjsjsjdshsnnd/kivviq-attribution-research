import { describe, expect, it } from "vitest";
import {
  createMediationFixture,
  createPositiveSynergyFixture,
  createZeroInteractionControlFixture,
} from "../../src/cross_channel/adversarial.js";
import {
  audienceOverlapMatrix,
  compileCrossChannelNetwork,
  customerInteractionMultiplier,
} from "../../src/cross_channel/network.js";

describe("Step 6 interaction network", () => {
  it("compiles zero interactions explicitly without manufacturing nonzero rules", () => {
    const fixture = createZeroInteractionControlFixture();
    const network = compileCrossChannelNetwork(
      fixture.merchantWorld,
    );

    expect(network.rules.length).toBeGreaterThan(0);
    expect(network.realizedNonZeroRuleCount).toBe(0);
    expect(network.zeroInteractionMechanismIds.length).toBe(
      network.rules.length,
    );
  });

  it("preserves sparse higher-order and asymmetric structure", () => {
    const fixture = createPositiveSynergyFixture();
    const network = compileCrossChannelNetwork(
      fixture.merchantWorld,
    );

    expect(network.rules.some((rule) => rule.higherOrder)).toBe(true);
    expect(network.maximumPossiblePairCount).toBeGreaterThan(0);
    expect(network.sparsity).toBeGreaterThan(0);
    expect(
      network.rules.some(
        (rule) =>
          rule.kind === "synergy" &&
          rule.participantChannels.includes("meta") &&
          rule.participantChannels.includes("google_search"),
      ),
    ).toBe(true);
  });

  it("compiles directed mediation targets from causal-graph edges", () => {
    const fixture = createMediationFixture();
    const network = compileCrossChannelNetwork(
      fixture.merchantWorld,
    );

    const meta = network.rules.find(
      (rule) =>
        rule.mechanismId === "step6_meta_branded_search",
    );
    const pinterest = network.rules.find(
      (rule) =>
        rule.mechanismId === "step6_pinterest_organic_direct",
    );

    expect(meta).toBeDefined();
    expect(meta!.asymmetric).toBe(true);
    expect(meta!.driverChannels).toEqual(["meta"]);
    expect(meta!.targetSemantic).toBe(
      "branded_search_probability",
    );
    expect(meta!.targetVariableIds).toContain(
      "marketing.google_search.branded_probability",
    );

    expect(pinterest).toBeDefined();
    expect(pinterest!.targetSemantic).toBe(
      "organic_direct_probability",
    );
    expect(pinterest!.lagMs).toBeGreaterThan(0);
  });

  it("represents explicit audience overlap without assuming independent audiences", () => {
    const fixture = createPositiveSynergyFixture();
    const matrix = audienceOverlapMatrix(
      fixture.merchantWorld,
      fixture.latentPopulation,
    );

    expect(matrix.cells.length).toBeGreaterThan(0);
    for (const cell of matrix.cells) {
      expect(cell.weightedOverlap).toBeGreaterThanOrEqual(0);
      expect(cell.weightedOverlap).toBeLessThanOrEqual(1);
      expect(cell.jointReachPotential).toBeGreaterThanOrEqual(0);
      expect(cell.jointReachPotential).toBeLessThanOrEqual(1);
    }
    expect(
      matrix.cells.some((cell) => cell.weightedOverlap > 0.05),
    ).toBe(true);
  });

  it("retains customer-level interaction heterogeneity", () => {
    const fixture = createPositiveSynergyFixture();
    const network = compileCrossChannelNetwork(
      fixture.merchantWorld,
    );
    const rule = network.rules.find(
      (candidate) => candidate.kind === "synergy",
    )!;

    const values = fixture.latentPopulation.customers.map(
      (customer) =>
        customerInteractionMultiplier(rule, customer),
    );

    expect(Math.max(...values)).toBeGreaterThan(Math.min(...values));
    expect(
      new Set(values.map((value) => value.toFixed(4))).size,
    ).toBeGreaterThan(20);
  });

  it("merchant fixtures have structurally different interaction networks", () => {
    const synergy = compileCrossChannelNetwork(
      createPositiveSynergyFixture().merchantWorld,
    );
    const mediation = compileCrossChannelNetwork(
      createMediationFixture().merchantWorld,
    );

    expect(synergy.mechanismIds).not.toEqual(mediation.mechanismIds);
    expect(
      new Set(synergy.rules.map((rule) => rule.kind)),
    ).not.toEqual(
      new Set(mediation.rules.map((rule) => rule.kind)),
    );
  });
});
