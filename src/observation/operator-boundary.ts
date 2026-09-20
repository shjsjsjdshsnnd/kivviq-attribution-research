import type {
  MerchantObservation,
  ObservableEvent,
  OperatorInput,
  PlatformChannelReport,
} from "./types.js";

const FORBIDDEN_OPERATOR_KEYS = new Set([
  "groundTruth",
  "ground_truth",
  "latent",
  "latentIntent",
  "trueIncrementality",
  "trueElasticity",
  "responseCurve",
  "causalGraph",
  "counterfactualProbability",
  "oracle",
  "simulationSeed",
  "seed",
  "simulatorParameters",
  "mechanismId",
]);

export class OperatorLeakageError extends Error {}

function copyEvent(event: ObservableEvent): ObservableEvent {
  return {
    eventId: event.eventId,
    eventType: event.eventType,
    occurredAt: event.occurredAt,
    subjectCreatedAt: event.subjectCreatedAt,
    anonymousSubjectId: event.anonymousSubjectId,
    ...(event.sessionId === undefined ? {} : { sessionId: event.sessionId }),
    ...(event.channel === undefined ? {} : { channel: event.channel }),
    ...(event.device === undefined ? {} : { device: event.device }),
    ...(event.productId === undefined ? {} : { productId: event.productId }),
    ...(event.orderId === undefined ? {} : { orderId: event.orderId }),
    ...(event.amountMinor === undefined ? {} : { amountMinor: event.amountMinor }),
    ...(event.currency === undefined ? {} : { currency: event.currency }),
  };
}

function copyPlatformReport(
  report: PlatformChannelReport,
): PlatformChannelReport {
  return {
    channel: report.channel,
    reportedSpendMinor: report.reportedSpendMinor,
    ...(report.reportedRevenueMinor === undefined
      ? {}
      : { reportedRevenueMinor: report.reportedRevenueMinor }),
    ...(report.reportedConversions === undefined
      ? {}
      : { reportedConversions: report.reportedConversions }),
  };
}

export function assertNoLatentLeakage(
  value: unknown,
  path = "$",
): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertNoLatentLeakage(entry, `${path}[${index}]`),
    );
    return;
  }

  if (typeof value !== "object" || value === null) return;

  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_OPERATOR_KEYS.has(key)) {
      throw new OperatorLeakageError(
        `forbidden latent key at ${path}.${key}`,
      );
    }

    if (
      key === "metadata" &&
      typeof entry === "object" &&
      entry !== null
    ) {
      throw new OperatorLeakageError(
        `unrestricted metadata is forbidden in Operator-facing structures at ${path}.metadata`,
      );
    }

    assertNoLatentLeakage(entry, `${path}.${key}`);
  }
}

export function validateObservableChronology(
  event: ObservableEvent,
): void {
  if (
    Date.parse(event.occurredAt) <
    Date.parse(event.subjectCreatedAt)
  ) {
    throw new RangeError(
      "observable event cannot occur before subject creation",
    );
  }
}

export function toOperatorInput(
  observation: MerchantObservation,
): OperatorInput {
  const output: OperatorInput = {
    schemaVersion: "1.0.0",
    observationId: observation.observationId,
    generatedAt: observation.generatedAt,
    events: observation.events.map((event) => {
      validateObservableChronology(event);
      return copyEvent(event);
    }),
    platformReports: observation.platformReports.map(
      copyPlatformReport,
    ),
    measurementFlags: {
      consentExcluded: observation.measurementFlags.consentExcluded,
      identityFragmented:
        observation.measurementFlags.identityFragmented,
      trackingFailure: observation.measurementFlags.trackingFailure,
      utmMissing: observation.measurementFlags.utmMissing,
    },
  };

  assertNoLatentLeakage(
    JSON.parse(JSON.stringify(output)) as unknown,
  );

  return output;
}
