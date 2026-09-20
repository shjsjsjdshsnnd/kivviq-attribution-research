import { describe, expect, it } from "vitest";
import * as operatorSafeApi from "../../src/index.js";
import {
  assertNoLatentLeakage,
  OperatorLeakageError,
  toOperatorInput,
} from "../../src/observation/operator-boundary.js";
import type { MerchantObservation } from "../../src/observation/types.js";
import {
  currencyCode,
  moneyMinor,
  utcTimestamp,
} from "../../src/core/units.js";

function observation(): MerchantObservation {
  return {
    schemaVersion: "1.0.0",
    observationId: "obs-1",
    generatedAt: utcTimestamp("2026-01-02T00:00:00Z"),
    events: [
      {
        eventId: "event-1",
        eventType: "purchase",
        occurredAt: utcTimestamp("2026-01-01T12:00:00Z"),
        subjectCreatedAt: utcTimestamp("2026-01-01T10:00:00Z"),
        anonymousSubjectId: "subject-1",
        sessionId: "session-1",
        channel: "meta",
        device: "mobile",
        orderId: "order-1",
        amountMinor: moneyMinor(15000),
        currency: currencyCode("CAD"),
      },
    ],
    platformReports: [
      {
        channel: "meta",
        reportedSpendMinor: moneyMinor(5000),
        reportedRevenueMinor: moneyMinor(15000),
        reportedConversions: 1,
      },
    ],
    measurementFlags: {
      consentExcluded: false,
      identityFragmented: false,
      trackingFailure: false,
      utmMissing: false,
    },
  };
}

describe("Operator information boundary", () => {
  it("constructs OperatorInput by explicit allowlist", () => {
    const source = observation() as MerchantObservation & {
      groundTruth?: unknown;
      metadata?: unknown;
    };
    source.groundTruth = { trueIncrementality: 99 };
    source.metadata = { latentIntent: 0.99 };

    const operatorInput = toOperatorInput(source);
    const serialized = JSON.parse(JSON.stringify(operatorInput)) as Record<string, unknown>;

    expect(serialized).not.toHaveProperty("groundTruth");
    expect(serialized).not.toHaveProperty("metadata");
    expect(() => assertNoLatentLeakage(serialized)).not.toThrow();
  });

  it("recursively rejects forbidden latent fields", () => {
    expect(() =>
      assertNoLatentLeakage({
        sessions: [
          {
            safe: true,
            nested: {
              trueIncrementality: 0.8,
            },
          },
        ],
      }),
    ).toThrow(OperatorLeakageError);
  });

  it("rejects unrestricted metadata as a covert channel", () => {
    expect(() =>
      assertNoLatentLeakage({
        observationId: "obs",
        metadata: {
          anyFutureHiddenField: "secret",
        },
      }),
    ).toThrow(/unrestricted metadata is forbidden/);
  });

  it("rejects future information leaking into earlier observable state", () => {
    const source = observation();
    const bad: MerchantObservation = {
      ...source,
      events: [
        {
          ...source.events[0]!,
          occurredAt: utcTimestamp("2025-12-31T23:59:59Z"),
        },
      ],
    };

    expect(() => toOperatorInput(bad)).toThrow(/cannot occur before subject creation/);
  });

  it("does not expose evaluator or GroundTruth validators on the Operator-safe root API", () => {
    expect(operatorSafeApi).not.toHaveProperty("createGroundTruthEvaluatorAccess");
    expect(operatorSafeApi).not.toHaveProperty("validateGroundTruthManifest");
    expect(operatorSafeApi).not.toHaveProperty("serializeGroundTruthManifest");
    expect(operatorSafeApi).not.toHaveProperty("generateMerchantWorld");
    expect(operatorSafeApi).not.toHaveProperty("generateMerchantWorldRecord");
    expect(operatorSafeApi).not.toHaveProperty("generateCustomerPopulation");
    expect(operatorSafeApi).not.toHaveProperty("validateLatentCustomerPopulation");
    expect(operatorSafeApi).not.toHaveProperty("simulateWorld");
    expect(operatorSafeApi).not.toHaveProperty("replayCounterfactual");
    expect(operatorSafeApi).not.toHaveProperty("replayPaidMediaOff");
    expect(operatorSafeApi).not.toHaveProperty("evaluateZeroPaidEffectAcceptance");
    expect(operatorSafeApi).not.toHaveProperty("buildAdvertisingPerformanceReport");
    expect(operatorSafeApi).not.toHaveProperty("evaluateAverageTruePerformance");
    expect(operatorSafeApi).not.toHaveProperty("evaluateMarginalTruePerformance");
    expect(operatorSafeApi).not.toHaveProperty("buildPlatformChannelReport");
    expect(operatorSafeApi).not.toHaveProperty("createVanityRoasTrapFixture");
    expect(operatorSafeApi).not.toHaveProperty("createRetargetingTrapFixture");
  });
});
