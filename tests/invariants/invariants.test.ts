import { describe, expect, it } from "vitest";
import {
  parseGroundTruthManifest,
  serializeGroundTruthManifest,
  validateGroundTruthManifest,
} from "../../src/ground_truth/manifest.js";
import type { GroundTruthManifest } from "../../src/ground_truth/manifest.js";
import { validManifest } from "../fixture.js";

describe("GroundTruth invariants", () => {
  it("rejects reserved inventory above available inventory", () => {
    const raw = JSON.parse(
      serializeGroundTruthManifest(validManifest()),
    ) as Record<string, any>;

    raw["inventoryMechanisms"][0].initialAvailableUnits = 2;
    raw["inventoryMechanisms"][0].initialReservedUnits = 3;

    expect(() => parseGroundTruthManifest(raw)).toThrow(
      /reserved inventory cannot exceed available inventory/,
    );
  });

  it("rejects non-finite values", () => {
    const manifest = validManifest();

    const corrupted = {
      ...manifest,
      responseCurves: [
        {
          ...manifest.responseCurves[0]!,
          slopePerMoneyMinor: Number.POSITIVE_INFINITY,
        },
      ],
    } as GroundTruthManifest;

    expect(() => validateGroundTruthManifest(corrupted)).toThrow(
      /NaN or Infinity/,
    );
  });

  it("rejects missing response curves referenced by incrementality", () => {
    const raw = JSON.parse(
      serializeGroundTruthManifest(validManifest()),
    ) as Record<string, any>;

    raw["channelIncrementality"][0].responseCurveId = "missing-curve";

    expect(() => parseGroundTruthManifest(raw)).toThrow(
      /unknown response curve/,
    );
  });

  it("rejects negative causal lag", () => {
    const raw = JSON.parse(
      serializeGroundTruthManifest(validManifest()),
    ) as Record<string, any>;

    raw["causalGraph"].edges[0].lagSeconds = -1;

    expect(() => parseGroundTruthManifest(raw)).toThrow(
      /lag must be finite and non-negative/,
    );
  });

  it("supports true zero causal effects without converting them to attribution", () => {
    const raw = JSON.parse(
      serializeGroundTruthManifest(validManifest()),
    ) as Record<string, any>;

    raw["channelIncrementality"][0].effect.value = 0;

    const parsed = parseGroundTruthManifest(raw);
    expect(parsed.channelIncrementality[0]!.effect.value).toBe(0);
  });
});
