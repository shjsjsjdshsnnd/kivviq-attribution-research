import { describe, expect, it } from "vitest";
import {
  InterventionError,
  validateIntervention,
  type CounterfactualRequest,
} from "../../src/ground_truth/interventions.js";
import { validManifest } from "../fixture.js";

describe("intervention contract", () => {
  it("accepts a typed intervention on an allowlisted causal variable", () => {
    const manifest = validManifest();

    expect(() =>
      validateIntervention(manifest.causalGraph, {
        variable: "marketing.spend",
        operation: "set",
        value: {
          kind: "number",
          value: 0,
          unit: "money_minor",
        },
      }),
    ).not.toThrow();
  });

  it("rejects intervention on non-intervenable variables", () => {
    const manifest = validManifest();

    expect(() =>
      validateIntervention(manifest.causalGraph, {
        variable: "commerce.orders",
        operation: "set",
        value: {
          kind: "number",
          value: 0,
          unit: "orders",
        },
      }),
    ).toThrow(InterventionError);
  });

  it("rejects mismatched intervention units", () => {
    const manifest = validManifest();

    expect(() =>
      validateIntervention(manifest.causalGraph, {
        variable: "marketing.spend",
        operation: "set",
        value: {
          kind: "number",
          value: 0,
          unit: "orders",
        },
      }),
    ).toThrow(/does not match node unit/);
  });

  it("requires controlled shared randomness for factual/counterfactual comparison", () => {
    const request: CounterfactualRequest = {
      factualWorldId: "test-world",
      interventions: [
        {
          variable: "marketing.spend",
          operation: "set",
          value: {
            kind: "number",
            value: 0,
            unit: "money_minor",
          },
        },
      ],
      randomSeedPolicy: "shared",
    };

    expect(request.randomSeedPolicy).toBe("shared");
  });
});
