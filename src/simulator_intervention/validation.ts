import {
  SIMULATOR_INTERVENTION_SCHEMA_VERSION,
  SIMULATOR_INTERVENTION_TYPES,
  type SimulatorIntervention,
  type SimulatorScalarValue,
} from "./types.js";

export interface SimulatorInterventionValidationIssue {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

export type SimulatorInterventionValidationResult =
  | {
      readonly ok: true;
      readonly intervention: SimulatorIntervention;
      readonly errors: readonly [];
    }
  | {
      readonly ok: false;
      readonly errors: readonly SimulatorInterventionValidationIssue[];
    };

export class SimulatorInterventionValidationError extends Error {
  public readonly issues: readonly SimulatorInterventionValidationIssue[];

  public constructor(issues: readonly SimulatorInterventionValidationIssue[]) {
    super(
      "Invalid SimulatorIntervention: " +
        issues.map((issue) => issue.path + ": " + issue.message).join("; "),
    );
    this.name = "SimulatorInterventionValidationError";
    this.issues = issues;
  }
}

const FORBIDDEN_KEYS = new Set([
  "recommendationScore",
  "rank",
  "priority",
  "bestAction",
  "predictedOutcome",
  "predictedLift",
  "expectedProfit",
  "expectedRevenue",
  "confidence",
  "lifecycleStatus",
  "executionStatus",
  "merchantRationale",
  "trueIncrementalROAS",
  "futureDemand",
  "futureConversions",
  "counterfactualRevenue",
  "oracleState",
]);

function record(value: unknown): value is any {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function add(
  errors: SimulatorInterventionValidationIssue[],
  code: string,
  path: string,
  message: string,
): void {
  errors.push({ code, path, message });
}

function scanForbidden(
  input: unknown,
  path: string,
  errors: SimulatorInterventionValidationIssue[],
): void {
  if (Array.isArray(input)) {
    input.forEach((entry, index) =>
      scanForbidden(entry, path + "[" + index + "]", errors),
    );
    return;
  }
  if (!record(input)) return;

  for (const [key, value] of Object.entries(input)) {
    const next = path === "$" ? key : path + "." + key;
    if (FORBIDDEN_KEYS.has(key)) {
      add(
        errors,
        "FORBIDDEN_INTERVENTION_INFORMATION",
        next,
        "prediction, ranking, lifecycle, merchant rationale and oracle data are forbidden",
      );
    }
    scanForbidden(value, next, errors);
  }
}

function validateTimestamp(
  input: unknown,
  path: string,
  errors: SimulatorInterventionValidationIssue[],
): void {
  if (
    typeof input !== "string" ||
    !input.endsWith("Z") ||
    !Number.isFinite(Date.parse(input))
  ) {
    add(errors, "INVALID_TIMESTAMP", path, "must be UTC ISO-8601 ending in Z");
  }
}

function validateScalar(
  input: unknown,
  path: string,
  errors: SimulatorInterventionValidationIssue[],
): void {
  if (!record(input) || !nonEmpty(input.kind)) {
    add(errors, "INVALID_INTERVENTION_VALUE", path, "typed value is required");
    return;
  }

  switch (input.kind) {
    case "money":
      if (!Number.isInteger(input.amountMinor) || Number(input.amountMinor) < 0) {
        add(errors, "INVALID_MONEY", path + ".amountMinor", "must be integer >= 0");
      }
      if (typeof input.currency !== "string" || !/^[A-Z]{3}$/.test(input.currency)) {
        add(errors, "INVALID_CURRENCY", path + ".currency", "invalid currency");
      }
      return;
    case "money_rate":
      if (!Number.isInteger(input.amountMinor) || Number(input.amountMinor) < 0) {
        add(errors, "INVALID_MONEY_RATE", path + ".amountMinor", "must be integer >= 0");
      }
      if (typeof input.currency !== "string" || !/^[A-Z]{3}$/.test(input.currency)) {
        add(errors, "INVALID_CURRENCY", path + ".currency", "invalid currency");
      }
      if (!["day", "week", "month"].includes(String(input.per))) {
        add(errors, "INVALID_RATE_PERIOD", path + ".per", "invalid rate period");
      }
      return;
    case "percentage":
      if (
        !Number.isInteger(input.basisPoints) ||
        Number(input.basisPoints) < 0 ||
        Number(input.basisPoints) > 10_000
      ) {
        add(errors, "INVALID_PERCENTAGE", path + ".basisPoints", "invalid basis points");
      }
      return;
    case "quantity":
      if (!finite(input.value) || Number(input.value) < 0 || !nonEmpty(input.unit)) {
        add(errors, "INVALID_QUANTITY", path, "invalid quantity");
      }
      return;
    case "frequency":
      if (!finite(input.count) || Number(input.count) <= 0) {
        add(errors, "INVALID_FREQUENCY", path + ".count", "must be finite and > 0");
      }
      if (!["day", "week", "month"].includes(String(input.per))) {
        add(errors, "INVALID_FREQUENCY_PERIOD", path + ".per", "invalid period");
      }
      return;
    case "boolean":
      if (typeof input.value !== "boolean") {
        add(errors, "INVALID_BOOLEAN", path + ".value", "must be boolean");
      }
      return;
    case "integer":
      if (!Number.isInteger(input.value)) {
        add(errors, "INVALID_INTEGER", path + ".value", "must be integer");
      }
      return;
    case "string":
      if (!nonEmpty(input.value)) {
        add(errors, "INVALID_STRING", path + ".value", "must be non-empty");
      }
      return;
    default:
      add(errors, "UNKNOWN_INTERVENTION_VALUE_KIND", path + ".kind", "unsupported");
  }
}

function scalarUnitKey(input: SimulatorScalarValue): string {
  switch (input.kind) {
    case "money":
      return "money:" + input.currency;
    case "money_rate":
      return "money_rate:" + input.currency + "/" + input.per;
    case "percentage":
      return "percentage:bp";
    case "quantity":
      return "quantity:" + input.unit;
    case "frequency":
      return "frequency:" + input.per;
    case "boolean":
      return "boolean";
    case "integer":
      return "integer";
    case "string":
      return "string";
  }
}

function validateOperation(
  input: unknown,
  path: string,
  errors: SimulatorInterventionValidationIssue[],
): void {
  if (!record(input) || !nonEmpty(input.kind)) {
    add(errors, "INVALID_INTERVENTION_OPERATION", path, "operation is required");
    return;
  }

  if (input.kind === "SET") {
    validateScalar(input.value, path + ".value", errors);
    return;
  }

  if (input.kind === "DELTA") {
    if (!["increase", "decrease"].includes(String(input.direction))) {
      add(errors, "INVALID_DELTA_DIRECTION", path + ".direction", "invalid direction");
    }
    validateScalar(input.amount, path + ".amount", errors);
    if (!record(input.baseline)) {
      add(errors, "MISSING_BASELINE", path + ".baseline", "baseline is required");
      return;
    }
    validateScalar(input.baseline.value, path + ".baseline.value", errors);
    if (
      record(input.amount) &&
      record(input.baseline.value) &&
      nonEmpty(input.amount.kind) &&
      nonEmpty(input.baseline.value.kind)
    ) {
      try {
        const left = scalarUnitKey(input.amount as SimulatorScalarValue);
        const right = scalarUnitKey(input.baseline.value as SimulatorScalarValue);
        if (left !== right) {
          add(errors, "INTERVENTION_UNIT_MISMATCH", path, "amount and baseline units differ");
        }
      } catch {
        // Detailed scalar validation already reports malformed values.
      }
    }
    if (!nonEmpty(input.baseline.sourceRef)) {
      add(errors, "MISSING_BASELINE_SOURCE", path + ".baseline.sourceRef", "required");
    }
    return;
  }

  if (input.kind === "MULTIPLY") {
    if (!finite(input.factor) || Number(input.factor) <= 0) {
      add(errors, "INVALID_MULTIPLIER", path + ".factor", "must be finite and > 0");
    }
    if (!record(input.baseline)) {
      add(errors, "MISSING_BASELINE", path + ".baseline", "baseline is required");
      return;
    }
    validateScalar(input.baseline.value, path + ".baseline.value", errors);
    if (!nonEmpty(input.baseline.sourceRef)) {
      add(errors, "MISSING_BASELINE_SOURCE", path + ".baseline.sourceRef", "required");
    }
    return;
  }

  add(errors, "UNKNOWN_INTERVENTION_OPERATION", path + ".kind", "unsupported");
}

function validateTarget(
  input: unknown,
  path: string,
  errors: SimulatorInterventionValidationIssue[],
): void {
  if (!record(input) || !nonEmpty(input.kind)) {
    add(errors, "INVALID_SIMULATOR_TARGET", path, "target is required");
    return;
  }

  const required: Readonly<Record<string, readonly string[]>> = {
    channel: ["simulatorChannelId"],
    campaign: ["simulatorChannelId", "simulatorCampaignId"],
    product: ["simulatorProductId"],
    sku: ["simulatorSkuId"],
    category: ["simulatorCategoryId"],
    collection: ["simulatorCollectionId"],
    page: ["simulatorPageId"],
    merchant: ["simulatorMerchantId"],
  };
  const fields = required[input.kind];
  if (!fields) {
    add(errors, "UNKNOWN_SIMULATOR_TARGET", path + ".kind", "unsupported target");
    return;
  }
  for (const field of fields) {
    if (!nonEmpty(input[field])) {
      add(errors, "MISSING_SIMULATOR_TARGET_ID", path + "." + field, "required");
    }
  }
}

function validateDuration(
  input: unknown,
  path: string,
  errors: SimulatorInterventionValidationIssue[],
): void {
  if (!record(input) || !nonEmpty(input.kind)) {
    add(errors, "INVALID_INTERVENTION_DURATION", path, "duration is required");
    return;
  }
  if (input.kind === "temporary") {
    if (!Number.isInteger(input.durationSeconds) || Number(input.durationSeconds) <= 0) {
      add(errors, "INVALID_DURATION_SECONDS", path + ".durationSeconds", "must be > 0");
    }
  } else if (input.kind === "recurring") {
    if (!record(input.recurrence) || !nonEmpty(input.recurrence.kind)) {
      add(errors, "INVALID_RECURRENCE", path + ".recurrence", "required");
    }
  } else if (
    !["instantaneous", "persistent", "until_reversed"].includes(String(input.kind))
  ) {
    add(errors, "UNKNOWN_INTERVENTION_DURATION", path + ".kind", "unsupported");
  }
}

export function validateSimulatorIntervention(
  input: unknown,
): SimulatorInterventionValidationResult {
  const errors: SimulatorInterventionValidationIssue[] = [];

  if (!record(input)) {
    return {
      ok: false,
      errors: [{ code: "INVALID_INTERVENTION", path: "$", message: "must be an object" }],
    };
  }

  scanForbidden(input, "$", errors);

  if (!nonEmpty(input.interventionId) || !/^intervention_[a-f0-9]{16}$/.test(input.interventionId)) {
    add(errors, "INVALID_INTERVENTION_ID", "interventionId", "invalid deterministic ID");
  }
  if (input.schemaVersion !== SIMULATOR_INTERVENTION_SCHEMA_VERSION) {
    add(errors, "UNSUPPORTED_INTERVENTION_SCHEMA", "schemaVersion", "unsupported version");
  }
  if (!SIMULATOR_INTERVENTION_TYPES.includes(input.interventionType as never)) {
    add(errors, "UNKNOWN_INTERVENTION_TYPE", "interventionType", "unsupported");
  }

  validateTarget(input.target, "target", errors);
  if (!record(input.scope) || !Array.isArray(input.scope.dimensions)) {
    add(errors, "INVALID_INTERVENTION_SCOPE", "scope", "scope.dimensions must be an array");
  }
  validateOperation(input.operation, "operation", errors);
  validateTimestamp(input.effectiveTime, "effectiveTime", errors);
  validateDuration(input.duration, "duration", errors);

  if (!record(input.endCondition) || !nonEmpty(input.endCondition.kind)) {
    add(errors, "INVALID_END_CONDITION", "endCondition", "required");
  }

  if (!record(input.provenance)) {
    add(errors, "INVALID_INTERVENTION_PROVENANCE", "provenance", "required");
  } else {
    for (const field of [
      "originatingBusinessActionId",
      "sourceActionId",
      "translationVersion",
      "translatorId",
    ]) {
      if (!nonEmpty(input.provenance[field])) {
        add(errors, "INVALID_INTERVENTION_PROVENANCE", "provenance." + field, "required");
      }
    }
    for (const field of [
      "componentIndex",
      "componentCount",
      "interventionIndexWithinComponent",
      "interventionCountWithinComponent",
    ]) {
      if (!Number.isInteger(input.provenance[field]) || Number(input.provenance[field]) < 0) {
        add(errors, "INVALID_INTERVENTION_PROVENANCE_INDEX", "provenance." + field, "invalid");
      }
    }
    if (
      Number.isInteger(input.provenance.componentIndex) &&
      Number.isInteger(input.provenance.componentCount) &&
      Number(input.provenance.componentIndex) >= Number(input.provenance.componentCount)
    ) {
      add(errors, "INVALID_COMPONENT_INDEX", "provenance.componentIndex", "out of range");
    }
    if (
      Number.isInteger(input.provenance.interventionIndexWithinComponent) &&
      Number.isInteger(input.provenance.interventionCountWithinComponent) &&
      Number(input.provenance.interventionIndexWithinComponent) >=
        Number(input.provenance.interventionCountWithinComponent)
    ) {
      add(
        errors,
        "INVALID_INTERVENTION_COMPONENT_INDEX",
        "provenance.interventionIndexWithinComponent",
        "out of range",
      );
    }

    if (input.provenance.membershipSourceRef !== undefined) {
      if (
        !nonEmpty(input.provenance.membershipSourceRef) ||
        !nonEmpty(input.provenance.membershipBindingRef) ||
        !["decision_time", "translation_time", "effective_time"].includes(
          String(input.provenance.membershipBoundary),
        )
      ) {
        add(
          errors,
          "INVALID_MEMBERSHIP_PROVENANCE",
          "provenance",
          "membership expansion provenance is incomplete",
        );
      }
      if (input.provenance.membershipSnapshotTime !== undefined) {
        validateTimestamp(
          input.provenance.membershipSnapshotTime,
          "provenance.membershipSnapshotTime",
          errors,
        );
      }
    }
  }

  return errors.length === 0
    ? { ok: true, intervention: input as SimulatorIntervention, errors: [] }
    : { ok: false, errors };
}

export function assertValidSimulatorIntervention(
  input: unknown,
): SimulatorIntervention {
  const result = validateSimulatorIntervention(input);
  if (!result.ok) throw new SimulatorInterventionValidationError(result.errors);
  return result.intervention;
}
