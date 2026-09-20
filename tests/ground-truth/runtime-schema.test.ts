import { describe, expect, it } from "vitest";
import {
  parseGroundTruthManifest,
  serializeGroundTruthManifest,
} from "../../src/ground_truth/manifest.js";
import {
  validateCounterfactualRequest,
  validateIntervention,
} from "../../src/ground_truth/interventions.js";
import { validManifest } from "../fixture.js";

function rawManifest(): Record<string, any> {
  return JSON.parse(
    serializeGroundTruthManifest(validManifest()),
  ) as Record<string, any>;
}

describe("exhaustive GroundTruth runtime schema", () => {
  it("rejects unknown fields inside nested structures", () => {
    const raw = rawManifest();
    raw["merchant"].secretLatentShortcut = true;

    expect(() => parseGroundTruthManifest(raw)).toThrow(
      /Unrecognized key.*secretLatentShortcut|unrecognized key/i,
    );
  });

  it("rejects missing required nested fields", () => {
    const raw = rawManifest();
    delete raw["customers"].latentIntentDistribution.alpha;

    expect(() => parseGroundTruthManifest(raw)).toThrow(
      /latentIntentDistribution.*alpha|Required/i,
    );
  });

  it("rejects invalid nested probabilities", () => {
    const raw = rawManifest();
    raw["customers"].segmentShares[0].probability = 1.1;

    expect(() => parseGroundTruthManifest(raw)).toThrow(
      /segmentShares.*probability/i,
    );
  });

  it("requires segment-share probabilities to reconcile to one", () => {
    const raw = rawManifest();
    raw["customers"].segmentShares = [
      { segmentId: "a", probability: 0.4 },
      { segmentId: "b", probability: 0.4 },
    ];

    expect(() => parseGroundTruthManifest(raw)).toThrow(
      /segmentShares probabilities must sum to 1/,
    );
  });

  it("rejects incompatible causal-effect scale/unit combinations", () => {
    const raw = rawManifest();
    raw["channelIncrementality"][0].effect = {
      scale: "relative",
      value: 0.2,
      unit: "orders",
    };

    expect(() => parseGroundTruthManifest(raw)).toThrow(
      /relative effects must be dimensionless/,
    );
  });

  it("rejects response-curve output units incompatible with target variable", () => {
    const raw = rawManifest();
    raw["responseCurves"][0].outputUnit = "money_minor";

    expect(() => parseGroundTruthManifest(raw)).toThrow(
      /output unit money_minor does not match outcome variable unit orders/,
    );
  });

  it("rejects causal edges whose mechanisms do not exist", () => {
    const raw = rawManifest();
    raw["causalGraph"].edges[0].mechanismId = "invented-mechanism";

    expect(() => parseGroundTruthManifest(raw)).toThrow(
      /causal edge references unknown mechanism/,
    );
  });

  it("rejects malformed inventory semantics", () => {
    const raw = rawManifest();
    raw["inventoryMechanisms"][0].stockoutBehavior = "backorder";
    raw["inventoryMechanisms"][0].allowBackorders = false;

    expect(() => parseGroundTruthManifest(raw)).toThrow(
      /backorder stockout behavior requires allowBackorders=true/,
    );
  });

  it("rejects external-shock targets that are not causal variables", () => {
    const raw = rawManifest();
    raw["externalShocks"] = [
      {
        id: "shock",
        kind: "weather",
        start: "2026-01-01T00:00:00Z",
        durationSeconds: 3600,
        affectedVariables: ["missing.variable"],
        mechanism: {
          functionalForm: "multiplicative",
          effect: {
            scale: "relative",
            value: -0.1,
            unit: "dimensionless",
          },
        },
      },
    ];

    expect(() => parseGroundTruthManifest(raw)).toThrow(
      /external shock references unknown causal variable/,
    );
  });

  it("rejects duplicate mechanism ids across different ontology domains", () => {
    const raw = rawManifest();
    raw["conversionMechanisms"][0].id =
      raw["channelIncrementality"][0].id;

    expect(() => parseGroundTruthManifest(raw)).toThrow(
      /duplicate mechanism id/,
    );
  });

  it("rejects malformed intervention objects before causal validation", () => {
    const manifest = validManifest();
    const malformed = {
      variable: "marketing.spend",
      operation: "set",
      value: {
        kind: "number",
        value: Number.NaN,
        unit: "money_minor",
      },
      hidden: "not-allowed",
    } as never;

    expect(() =>
      validateIntervention(manifest.causalGraph, malformed),
    ).toThrow(/invalid intervention/);
  });

  it("rejects counterfactual requests without shared random seeds", () => {
    const manifest = validManifest();
    const request = {
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
      randomSeedPolicy: "independent",
    } as never;

    expect(() =>
      validateCounterfactualRequest(manifest.causalGraph, request),
    ).toThrow(/invalid counterfactual request/);
  });
});
