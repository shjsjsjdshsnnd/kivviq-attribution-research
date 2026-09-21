import {
  ACTION_STATES,
  RISK_DIMENSIONS,
  type Action,
  type ActionConstraint,
  type ActionParameter,
  type ActionRisk,
  type ActionTarget,
  type AtomicActionTarget,
  type KnowledgeValue,
  type MonetaryAmount,
  type ParameterValue,
  type RiskImpact,
} from "./types.js";
import {
  CORE_ACTION_TYPE_CONTRACTS,
  CORE_CONSTRAINT_PROPERTIES,
  getCoreActionTypeContract,
  type ActionTypeContract,
} from "./registry.js";

export interface ActionValidationIssue {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

export type ActionValidationResult =
  | {
      readonly ok: true;
      readonly action: Action;
      readonly errors: readonly [];
    }
  | {
      readonly ok: false;
      readonly errors: readonly ActionValidationIssue[];
    };

export interface ActionValidationOptions {
  readonly additionalConstraintProperties?: readonly string[];
  readonly additionalActionTypeContracts?: readonly ActionTypeContract[];
}

export class ActionValidationError extends Error {
  public readonly issues: readonly ActionValidationIssue[];

  public constructor(issues: readonly ActionValidationIssue[]) {
    super(
      `Invalid Action: ${issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`,
    );
    this.name = "ActionValidationError";
    this.issues = issues;
  }
}

const ACTION_TYPE_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;
const CATEGORY_PATTERN = /^[a-z][a-z0-9_]*$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const ISO_UTC_PATTERN = /Z$/;

function record(value: unknown): value is any {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function add(
  errors: ActionValidationIssue[],
  code: string,
  path: string,
  message: string,
): void {
  errors.push({ code, path, message });
}

function readKnown<T>(value: KnowledgeValue<T>): T | undefined {
  if (value.status === "known" || value.status === "estimated") return value.value;
  return undefined;
}

function validateKnowledge<T>(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
  validateValue: (value: unknown, valuePath: string) => void,
): void {
  if (!record(input) || !nonEmpty(input.status)) {
    add(errors, "INVALID_KNOWLEDGE_VALUE", path, "must be a knowledge value");
    return;
  }

  if (
    !["known", "estimated", "bounded", "unknown", "not_applicable"].includes(
      input.status,
    )
  ) {
    add(errors, "INVALID_KNOWLEDGE_STATUS", `${path}.status`, "unsupported status");
    return;
  }

  if (!nonEmpty(input.provenance)) {
    add(errors, "MISSING_PROVENANCE", `${path}.provenance`, "provenance is required");
  }

  if (input.status === "known" || input.status === "estimated") {
    if (!("value" in input)) {
      add(errors, "MISSING_KNOWLEDGE_VALUE", `${path}.value`, "value is required");
    } else {
      validateValue(input.value, `${path}.value`);
    }
  }

  if (input.status === "bounded") {
    if (!("lower" in input) && !("upper" in input)) {
      add(
        errors,
        "EMPTY_BOUNDS",
        path,
        "bounded values require at least one lower or upper bound",
      );
    }
    if ("lower" in input && input.lower !== undefined) {
      validateValue(input.lower, `${path}.lower`);
    }
    if ("upper" in input && input.upper !== undefined) {
      validateValue(input.upper, `${path}.upper`);
    }
  }

  if (input.status === "unknown" && input.provenance !== "unknown") {
    add(
      errors,
      "UNKNOWN_PROVENANCE_MISMATCH",
      `${path}.provenance`,
      "unknown values must use unknown provenance",
    );
  }

  if (input.status === "not_applicable" && input.provenance !== "not_applicable") {
    add(
      errors,
      "NA_PROVENANCE_MISMATCH",
      `${path}.provenance`,
      "not_applicable values must use not_applicable provenance",
    );
  }
}

function validateMoney(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!record(input)) {
    add(errors, "INVALID_MONEY", path, "must be a monetary amount");
    return;
  }
  if (!Number.isInteger(input.amountMinor) || (input.amountMinor as number) < 0) {
    add(
      errors,
      "INVALID_MONEY_MINOR",
      `${path}.amountMinor`,
      "must be a non-negative integer in minor currency units",
    );
  }
  if (
    typeof input.currency !== "string" ||
    !CURRENCY_PATTERN.test(input.currency)
  ) {
    add(
      errors,
      "INVALID_CURRENCY",
      `${path}.currency`,
      "must be an explicit three-letter uppercase currency code",
    );
  }
}

function validateTimestamp(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (
    typeof input !== "string" ||
    !ISO_UTC_PATTERN.test(input) ||
    !Number.isFinite(Date.parse(input))
  ) {
    add(
      errors,
      "INVALID_TIMESTAMP",
      path,
      "must be valid UTC ISO-8601 ending in Z",
    );
  }
}

function validateNonNegativeNumber(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!finite(input) || input < 0) {
    add(errors, "INVALID_NON_NEGATIVE_NUMBER", path, "must be finite and >= 0");
  }
}

function validateProbability(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!finite(input) || input < 0 || input > 1) {
    add(errors, "INVALID_PROBABILITY", path, "must be within [0,1]");
  }
}

function validateRiskImpact(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!record(input)) {
    add(errors, "INVALID_RISK_IMPACT", path, "must be a risk impact");
    return;
  }
  if (!["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(String(input.severity))) {
    add(errors, "INVALID_RISK_SEVERITY", `${path}.severity`, "invalid severity");
  }
  if (input.economicExposure !== undefined) {
    validateMoney(input.economicExposure, `${path}.economicExposure`, errors);
  }
}

const TARGET_ID_FIELD: Record<AtomicActionTarget["kind"], string> = {
  advertising_channel: "channelId",
  campaign: "campaignId",
  ad_set: "adSetId",
  ad: "adId",
  audience: "audienceId",
  product: "productId",
  sku: "skuId",
  collection: "collectionId",
  landing_page: "landingPageId",
  price: "productId",
  promotion: "promotionId",
  inventory: "skuId",
  email_campaign: "emailCampaignId",
  email_flow: "emailFlowId",
  customer_segment: "segmentId",
  merchandising_placement: "collectionId",
  shipping_policy: "shippingPolicyId",
};

function validateAtomicTarget(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!record(input) || !nonEmpty(input.kind)) {
    add(errors, "INVALID_TARGET", path, "target kind is required");
    return;
  }

  if (!(input.kind in TARGET_ID_FIELD)) {
    add(errors, "UNKNOWN_TARGET_KIND", `${path}.kind`, "unsupported target kind");
    return;
  }

  const idField = TARGET_ID_FIELD[input.kind as AtomicActionTarget["kind"]];
  if (!nonEmpty(input[idField])) {
    add(
      errors,
      "MISSING_TARGET_ID",
      `${path}.${idField}`,
      "typed target identifier is required",
    );
  }

  if (
    input.kind === "merchandising_placement" &&
    !nonEmpty(input.productId)
  ) {
    add(
      errors,
      "MISSING_TARGET_ID",
      `${path}.productId`,
      "productId is required for a merchandising placement",
    );
  }
}

function validateTarget(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!record(input) || !nonEmpty(input.kind)) {
    add(errors, "INVALID_TARGET", path, "target is required");
    return;
  }
  if (input.kind !== "compound") {
    validateAtomicTarget(input, path, errors);
    return;
  }

  if (!Array.isArray(input.targets) || input.targets.length < 2) {
    add(
      errors,
      "INVALID_COMPOUND_TARGET",
      `${path}.targets`,
      "compound targets require at least two atomic targets",
    );
    return;
  }
  input.targets.forEach((target: unknown, index: number) =>
    validateAtomicTarget(target, `${path}.targets[${index}]`, errors),
  );
}

function validateParameterValue(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!record(input) || !nonEmpty(input.kind)) {
    add(errors, "INVALID_PARAMETER_VALUE", path, "parameter value kind is required");
    return;
  }

  switch (input.kind) {
    case "money":
      validateMoney(input, path, errors);
      return;
    case "money_rate":
      validateMoney(input, path, errors);
      if (!["day", "week", "month"].includes(String(input.per))) {
        add(
          errors,
          "INVALID_MONEY_RATE_PERIOD",
          `${path}.per`,
          "money rates require an explicit day, week or month period",
        );
      }
      return;
    case "percentage": {
      if (!Number.isInteger(input.basisPoints) || (input.basisPoints as number) < 0) {
        add(
          errors,
          "INVALID_PERCENTAGE",
          `${path}.basisPoints`,
          "basisPoints must be a non-negative integer; direction belongs to the operation",
        );
      }
      const semantics = String(input.semantics);
      if (
        ![
          "relative_change",
          "absolute_share",
          "percentage_points",
          "discount_rate",
          "margin_rate",
        ].includes(semantics)
      ) {
        add(
          errors,
          "MISSING_PERCENTAGE_SEMANTICS",
          `${path}.semantics`,
          "percentage semantics must be explicit",
        );
      }
      if (
        ["absolute_share", "discount_rate", "margin_rate"].includes(semantics) &&
        Number(input.basisPoints) > 10000
      ) {
        add(
          errors,
          "PERCENTAGE_OUT_OF_RANGE",
          `${path}.basisPoints`,
          "share/rate percentages cannot exceed 100%",
        );
      }
      return;
    }
    case "number":
      if (!finite(input.value) || !nonEmpty(input.unit)) {
        add(
          errors,
          "INVALID_NUMBER_PARAMETER",
          path,
          "number parameters require a finite value and explicit unit",
        );
      }
      return;
    case "boolean":
      if (typeof input.value !== "boolean") {
        add(errors, "INVALID_BOOLEAN_PARAMETER", `${path}.value`, "must be boolean");
      }
      return;
    case "string":
      if (!nonEmpty(input.value)) {
        add(errors, "INVALID_STRING_PARAMETER", `${path}.value`, "must be non-empty");
      }
      return;
    case "frequency":
      if (!finite(input.value) || (input.value as number) <= 0) {
        add(errors, "INVALID_FREQUENCY", `${path}.value`, "must be > 0");
      }
      if (!["day", "week", "month"].includes(String(input.per))) {
        add(errors, "INVALID_FREQUENCY_PERIOD", `${path}.per`, "invalid period");
      }
      return;
    case "position":
      if (!Number.isInteger(input.value) || (input.value as number) < 1) {
        add(errors, "INVALID_POSITION", `${path}.value`, "must be an integer >= 1");
      }
      return;
    case "target":
      validateAtomicTarget(input.target, `${path}.target`, errors);
      return;
    case "action_reference":
      if (!nonEmpty(input.actionId)) {
        add(
          errors,
          "INVALID_ACTION_REFERENCE",
          `${path}.actionId`,
          "actionId is required",
        );
      }
      return;
    default:
      add(errors, "UNKNOWN_PARAMETER_VALUE_KIND", `${path}.kind`, "unsupported kind");
  }
}

function validateParameter(
  parameter: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!record(parameter)) {
    add(errors, "INVALID_PARAMETER", path, "must be an action parameter");
    return;
  }
  if (!nonEmpty(parameter.parameterId)) {
    add(errors, "MISSING_PARAMETER_ID", `${path}.parameterId`, "required");
  }
  const mode = String(parameter.mode);
  if (
    ![
      "SET",
      "INCREASE_BY",
      "DECREASE_BY",
      "INCREASE_BY_PERCENT",
      "DECREASE_BY_PERCENT",
      "PAUSE",
      "RESUME",
      "APPLY",
      "REMOVE",
      "MOVE_TO",
      "REVERSE",
    ].includes(mode)
  ) {
    add(errors, "INVALID_PARAMETER_MODE", `${path}.mode`, "unsupported mode");
    return;
  }

  if (parameter.value !== undefined) {
    validateParameterValue(parameter.value, `${path}.value`, errors);
  }
  if (parameter.fromValue !== undefined) {
    validateParameterValue(parameter.fromValue, `${path}.fromValue`, errors);
  }
  if (parameter.toValue !== undefined) {
    validateParameterValue(parameter.toValue, `${path}.toValue`, errors);
  }

  if (
    ["INCREASE_BY", "DECREASE_BY", "INCREASE_BY_PERCENT", "DECREASE_BY_PERCENT"].includes(
      mode,
    ) &&
    parameter.value === undefined
  ) {
    add(errors, "MISSING_CHANGE_VALUE", `${path}.value`, "change magnitude is required");
  }

  if (
    ["INCREASE_BY_PERCENT", "DECREASE_BY_PERCENT"].includes(mode) &&
    record(parameter.value) &&
    parameter.value.kind !== "percentage"
  ) {
    add(
      errors,
      "PERCENT_MODE_REQUIRES_PERCENT",
      `${path}.value`,
      "percent change modes require a percentage value",
    );
  }

  if (
    ["SET", "MOVE_TO", "APPLY", "REMOVE"].includes(mode) &&
    parameter.value === undefined &&
    parameter.toValue === undefined
  ) {
    add(
      errors,
      "MISSING_DESTINATION_VALUE",
      path,
      "set/apply/move operations require value or toValue",
    );
  }

  if (
    parameter.fromValue !== undefined &&
    parameter.toValue !== undefined &&
    record(parameter.fromValue) &&
    record(parameter.toValue) &&
    parameter.fromValue.kind !== parameter.toValue.kind
  ) {
    add(
      errors,
      "CONTRADICTORY_PARAMETER_TYPES",
      path,
      "fromValue and toValue must use the same value kind",
    );
  }
}

function validateConstraint(
  constraint: unknown,
  path: string,
  errors: ActionValidationIssue[],
  validProperties: ReadonlySet<string>,
): void {
  if (!record(constraint) || !nonEmpty(constraint.constraintId)) {
    add(errors, "INVALID_CONSTRAINT", path, "constraintId is required");
    return;
  }

  if (constraint.kind === "property_comparison") {
    if (!nonEmpty(constraint.property) || !validProperties.has(constraint.property)) {
      add(
        errors,
        "UNKNOWN_CONSTRAINT_PROPERTY",
        `${path}.property`,
        "constraint property is not registered",
      );
    }
    if (
      !["LT", "LTE", "EQ", "NEQ", "GTE", "GT", "CONTAINS", "NOT_CONTAINS"].includes(
        String(constraint.operator),
      )
    ) {
      add(errors, "INVALID_CONSTRAINT_OPERATOR", `${path}.operator`, "unsupported");
    }
    validateParameterValue(constraint.value, `${path}.value`, errors);
  } else if (constraint.kind === "action_relation") {
    if (
      !["requires", "mutually_exclusive_with"].includes(String(constraint.relation))
    ) {
      add(errors, "INVALID_ACTION_RELATION", `${path}.relation`, "unsupported");
    }
    if (
      !Array.isArray(constraint.actionIds) ||
      constraint.actionIds.length === 0 ||
      constraint.actionIds.some((id: unknown) => !nonEmpty(id))
    ) {
      add(
        errors,
        "INVALID_ACTION_RELATION_IDS",
        `${path}.actionIds`,
        "at least one valid actionId is required",
      );
    }
  } else if (constraint.kind === "data_available") {
    if (!nonEmpty(constraint.dataRef)) {
      add(errors, "INVALID_DATA_REFERENCE", `${path}.dataRef`, "required");
    }
    if (
      constraint.maximumAgeSeconds !== undefined &&
      (!Number.isInteger(constraint.maximumAgeSeconds) ||
        (constraint.maximumAgeSeconds as number) < 0)
    ) {
      add(
        errors,
        "INVALID_DATA_FRESHNESS",
        `${path}.maximumAgeSeconds`,
        "must be a non-negative integer",
      );
    }
  } else {
    add(errors, "UNKNOWN_CONSTRAINT_KIND", `${path}.kind`, "unsupported");
  }

  if (!["INVALID", "BLOCKED"].includes(String(constraint.whenUnmet))) {
    add(errors, "INVALID_CONSTRAINT_FAILURE_MODE", `${path}.whenUnmet`, "unsupported");
  }
}

function validateTiming(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!record(input)) {
    add(errors, "INVALID_TIMING", path, "timing object is required");
    return;
  }
  validateKnowledge(
    input.proposedStart,
    `${path}.proposedStart`,
    errors,
    (value, valuePath) => validateTimestamp(value, valuePath, errors),
  );
  validateKnowledge(
    input.earliestPossibleStart,
    `${path}.earliestPossibleStart`,
    errors,
    (value, valuePath) => validateTimestamp(value, valuePath, errors),
  );
  validateKnowledge(
    input.latestUsefulStart,
    `${path}.latestUsefulStart`,
    errors,
    (value, valuePath) => validateTimestamp(value, valuePath, errors),
  );

  const proposed = record(input.proposedStart)
    ? readKnown(input.proposedStart as unknown as KnowledgeValue<string>)
    : undefined;
  const earliest = record(input.earliestPossibleStart)
    ? readKnown(input.earliestPossibleStart as unknown as KnowledgeValue<string>)
    : undefined;
  const latest = record(input.latestUsefulStart)
    ? readKnown(input.latestUsefulStart as unknown as KnowledgeValue<string>)
    : undefined;

  if (proposed && earliest && Date.parse(proposed) < Date.parse(earliest)) {
    add(
      errors,
      "START_BEFORE_EARLIEST",
      `${path}.proposedStart`,
      "proposed start cannot precede earliest possible start",
    );
  }
  if (proposed && latest && Date.parse(proposed) > Date.parse(latest)) {
    add(
      errors,
      "START_AFTER_LATEST",
      `${path}.proposedStart`,
      "proposed start cannot exceed latest useful start",
    );
  }
  if (earliest && latest && Date.parse(earliest) > Date.parse(latest)) {
    add(
      errors,
      "EARLIEST_AFTER_LATEST",
      path,
      "earliest possible start cannot exceed latest useful start",
    );
  }

  if (!Array.isArray(input.schedulingRequirements)) {
    add(
      errors,
      "INVALID_SCHEDULING_REQUIREMENTS",
      `${path}.schedulingRequirements`,
      "must be an array",
    );
  } else {
    input.schedulingRequirements.forEach((requirement: unknown, index: number) => {
      if (
        !record(requirement) ||
        !nonEmpty(requirement.requirementId) ||
        !nonEmpty(requirement.kind) ||
        !nonEmpty(requirement.description)
      ) {
        add(
          errors,
          "INVALID_SCHEDULING_REQUIREMENT",
          `${path}.schedulingRequirements[${index}]`,
          "requirementId, kind and description are required",
        );
      }
    });
  }

  if (!Array.isArray(input.dependencies)) {
    add(errors, "INVALID_DEPENDENCIES", `${path}.dependencies`, "must be an array");
  } else {
    input.dependencies.forEach((dependency: unknown, index: number) => {
      const depPath = `${path}.dependencies[${index}]`;
      if (!record(dependency) || !nonEmpty(dependency.kind)) {
        add(errors, "INVALID_DEPENDENCY", depPath, "dependency kind is required");
        return;
      }
      if (dependency.kind === "action_state") {
        if (!nonEmpty(dependency.actionId)) {
          add(errors, "INVALID_DEPENDENCY_ACTION", `${depPath}.actionId`, "required");
        }
        if (!ACTION_STATES.includes(dependency.requiredState as never)) {
          add(
            errors,
            "INVALID_DEPENDENCY_STATE",
            `${depPath}.requiredState`,
            "unsupported state",
          );
        }
      } else if (dependency.kind === "event") {
        if (!nonEmpty(dependency.eventType)) {
          add(errors, "INVALID_DEPENDENCY_EVENT", `${depPath}.eventType`, "required");
        }
      } else if (dependency.kind === "manual_approval") {
        if (!nonEmpty(dependency.approvalRole)) {
          add(errors, "INVALID_APPROVAL_ROLE", `${depPath}.approvalRole`, "required");
        }
      } else {
        add(errors, "UNKNOWN_DEPENDENCY_KIND", `${depPath}.kind`, "unsupported");
      }
    });
  }
}

function validateDuration(
  input: unknown,
  path: string,
  timing: unknown,
  errors: ActionValidationIssue[],
): void {
  if (!record(input)) {
    add(errors, "INVALID_DURATION", path, "duration object is required");
    return;
  }
  if (
    !["instantaneous", "temporary", "persistent", "recurring"].includes(
      String(input.kind),
    )
  ) {
    add(errors, "INVALID_DURATION_KIND", `${path}.kind`, "unsupported");
  }

  validateKnowledge(
    input.durationSeconds,
    `${path}.durationSeconds`,
    errors,
    (value, valuePath) => validateNonNegativeNumber(value, valuePath, errors),
  );
  validateKnowledge(
    input.endTime,
    `${path}.endTime`,
    errors,
    (value, valuePath) => validateTimestamp(value, valuePath, errors),
  );

  const duration = record(input.durationSeconds)
    ? readKnown(input.durationSeconds as unknown as KnowledgeValue<number>)
    : undefined;
  if (input.kind === "instantaneous" && duration !== undefined && duration !== 0) {
    add(
      errors,
      "INSTANTANEOUS_NONZERO_DURATION",
      `${path}.durationSeconds`,
      "instantaneous actions must have zero duration",
    );
  }

  if (
    input.kind === "temporary" &&
    input.endCondition === undefined &&
    record(input.endTime) &&
    input.endTime.status === "not_applicable" &&
    record(input.durationSeconds) &&
    ["unknown", "not_applicable"].includes(String(input.durationSeconds.status))
  ) {
    add(
      errors,
      "TEMPORARY_ACTION_WITHOUT_END",
      path,
      "temporary actions require an explicit duration, end time or end condition",
    );
  }

  if (input.kind === "recurring") {
    if (
      !record(input.recurrence) ||
      !["daily", "weekly", "monthly"].includes(String(input.recurrence.frequency)) ||
      !Number.isInteger(input.recurrence.interval) ||
      (input.recurrence.interval as number) <= 0
    ) {
      add(
        errors,
        "INVALID_RECURRENCE",
        `${path}.recurrence`,
        "recurring actions require a positive interval and valid frequency",
      );
    }
  } else if (input.recurrence !== undefined) {
    add(
      errors,
      "RECURRENCE_ON_NON_RECURRING_ACTION",
      `${path}.recurrence`,
      "recurrence metadata only applies to recurring actions",
    );
  }

  const end = record(input.endTime)
    ? readKnown(input.endTime as unknown as KnowledgeValue<string>)
    : undefined;
  const proposed =
    record(timing) && record(timing.proposedStart)
      ? readKnown(timing.proposedStart as unknown as KnowledgeValue<string>)
      : undefined;
  if (end && proposed && Date.parse(end) < Date.parse(proposed)) {
    add(
      errors,
      "END_BEFORE_START",
      `${path}.endTime`,
      "end time cannot precede proposed start",
    );
  }
}

function validateCosts(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!record(input)) {
    add(errors, "INVALID_COST", path, "cost object is required");
    return;
  }

  const fields = [
    "incrementalSpend",
    "implementationCost",
    "discountMarginCost",
    "operationalCost",
    "opportunityCost",
    "totalEconomicExposure",
  ] as const;

  const knownCurrencies = new Set<string>();
  for (const field of fields) {
    validateKnowledge(
      input[field],
      `${path}.${field}`,
      errors,
      (value, valuePath) => {
        validateMoney(value, valuePath, errors);
        if (record(value) && typeof value.currency === "string") {
          knownCurrencies.add(value.currency);
        }
      },
    );
  }

  if (knownCurrencies.size > 1) {
    add(
      errors,
      "MIXED_COST_CURRENCIES",
      path,
      "cost components in one action must use one currency",
    );
  }
}

function validateReversibility(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!record(input)) {
    add(errors, "INVALID_REVERSIBILITY", path, "reversibility object is required");
    return;
  }
  if (
    !["fully_reversible", "partially_reversible", "irreversible"].includes(
      String(input.classification),
    )
  ) {
    add(errors, "INVALID_REVERSIBILITY_CLASS", `${path}.classification`, "unsupported");
  }

  validateKnowledge(
    input.reversalMechanism,
    `${path}.reversalMechanism`,
    errors,
    (value, valuePath) => {
      if (!nonEmpty(value)) {
        add(errors, "INVALID_REVERSAL_MECHANISM", valuePath, "must be non-empty");
      }
    },
  );
  validateKnowledge(
    input.reversalCost,
    `${path}.reversalCost`,
    errors,
    (value, valuePath) => validateMoney(value, valuePath, errors),
  );
  validateKnowledge(
    input.reversalDelaySeconds,
    `${path}.reversalDelaySeconds`,
    errors,
    (value, valuePath) => validateNonNegativeNumber(value, valuePath, errors),
  );

  if (input.classification === "irreversible") {
    for (const field of [
      "reversalMechanism",
      "reversalCost",
      "reversalDelaySeconds",
    ] as const) {
      if (!record(input[field]) || input[field].status !== "not_applicable") {
        add(
          errors,
          "IRREVERSIBLE_HAS_REVERSAL_METADATA",
          `${path}.${field}`,
          "irreversible actions must mark reversal metadata not_applicable",
        );
      }
    }
  } else if (
    !record(input.reversalMechanism) ||
    ["unknown", "not_applicable"].includes(String(input.reversalMechanism.status))
  ) {
    add(
      errors,
      "REVERSIBLE_ACTION_WITHOUT_MECHANISM",
      `${path}.reversalMechanism`,
      "reversible actions require a known or estimated reversal mechanism",
    );
  }
}

function validateRisks(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!Array.isArray(input)) {
    add(errors, "INVALID_RISKS", path, "risks must be an array");
    return;
  }

  const seen = new Set<string>();
  input.forEach((risk, index) => {
    const riskPath = `${path}[${index}]`;
    if (!record(risk) || !nonEmpty(risk.dimension)) {
      add(errors, "INVALID_RISK", riskPath, "risk dimension is required");
      return;
    }
    if (seen.has(risk.dimension)) {
      add(errors, "DUPLICATE_RISK_DIMENSION", `${riskPath}.dimension`, "duplicate");
    }
    seen.add(risk.dimension);
    validateKnowledge(
      risk.probability,
      `${riskPath}.probability`,
      errors,
      (value, valuePath) => validateProbability(value, valuePath, errors),
    );
    validateKnowledge(
      risk.impact,
      `${riskPath}.impact`,
      errors,
      (value, valuePath) => validateRiskImpact(value, valuePath, errors),
    );
  });

  for (const dimension of RISK_DIMENSIONS) {
    if (!seen.has(dimension)) {
      add(
        errors,
        "MISSING_CORE_RISK_DIMENSION",
        path,
        `missing required risk dimension: ${dimension}`,
      );
    }
  }
}

function validateMeasurement(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!record(input)) {
    add(errors, "INVALID_MEASUREMENT", path, "measurement horizon is required");
    return;
  }

  for (const field of [
    "earliestMeaningfulObservationSeconds",
    "primaryEvaluationSeconds",
    "longerTermEvaluationSeconds",
  ] as const) {
    validateKnowledge(
      input[field],
      `${path}.${field}`,
      errors,
      (value, valuePath) => validateNonNegativeNumber(value, valuePath, errors),
    );
  }

  const earliest = record(input.earliestMeaningfulObservationSeconds)
    ? readKnown(
        input.earliestMeaningfulObservationSeconds as unknown as KnowledgeValue<number>,
      )
    : undefined;
  const primary = record(input.primaryEvaluationSeconds)
    ? readKnown(input.primaryEvaluationSeconds as unknown as KnowledgeValue<number>)
    : undefined;
  const longer = record(input.longerTermEvaluationSeconds)
    ? readKnown(
        input.longerTermEvaluationSeconds as unknown as KnowledgeValue<number>,
      )
    : undefined;

  if (earliest !== undefined && primary !== undefined && primary < earliest) {
    add(
      errors,
      "PRIMARY_HORIZON_BEFORE_EARLIEST",
      `${path}.primaryEvaluationSeconds`,
      "primary evaluation cannot precede earliest meaningful observation",
    );
  }
  if (primary !== undefined && longer !== undefined && longer < primary) {
    add(
      errors,
      "LONG_TERM_HORIZON_BEFORE_PRIMARY",
      `${path}.longerTermEvaluationSeconds`,
      "longer-term horizon cannot precede primary evaluation",
    );
  }

  if (!Array.isArray(input.metrics) || input.metrics.length === 0) {
    add(
      errors,
      "MISSING_MEASUREMENT_METRICS",
      `${path}.metrics`,
      "at least one metric must be observed",
    );
  } else {
    input.metrics.forEach((metric: unknown, index: number) => {
      if (!record(metric) || !nonEmpty(metric.metricId)) {
        add(
          errors,
          "INVALID_MEASUREMENT_METRIC",
          `${path}.metrics[${index}]`,
          "metricId is required",
        );
      }
    });
  }

  if (!record(input.baseline)) {
    add(errors, "MISSING_BASELINE", `${path}.baseline`, "baseline is required");
  } else {
    if (
      ![
        "same_length_prior",
        "matched_period",
        "holdout",
        "synthetic_control",
        "custom",
      ].includes(String(input.baseline.strategy))
    ) {
      add(
        errors,
        "INVALID_BASELINE_STRATEGY",
        `${path}.baseline.strategy`,
        "unsupported",
      );
    }
    if (
      !Number.isInteger(input.baseline.lookbackSeconds) ||
      (input.baseline.lookbackSeconds as number) <= 0
    ) {
      add(
        errors,
        "INVALID_BASELINE_LOOKBACK",
        `${path}.baseline.lookbackSeconds`,
        "must be a positive integer",
      );
    }
  }
}

function compatibleOntologyVersion(version: unknown): boolean {
  if (typeof version !== "string") return false;
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  return Boolean(match && Number(match[1]) === 1);
}

function contractFor(
  actionType: string,
  options: ActionValidationOptions,
): ActionTypeContract | undefined {
  return (
    options.additionalActionTypeContracts?.find(
      (contract) => contract.actionType === actionType,
    ) ?? getCoreActionTypeContract(actionType)
  );
}

function validateReallocation(
  action: Action,
  errors: ActionValidationIssue[],
): void {
  if (action.actionType !== "paid_media.reallocate_budget") return;

  const components = action.components ?? [];
  if (components.length !== 2) {
    add(
      errors,
      "REALLOCATION_REQUIRES_TWO_COMPONENTS",
      "components",
      "budget reallocation must contain exactly two component actions",
    );
    return;
  }

  const budgetParameters = components.map((component) =>
    component.parameters.find(
      (parameter) => parameter.parameterId === "budget_change",
    ),
  );

  const decreases = budgetParameters.filter(
    (parameter) => parameter?.mode === "DECREASE_BY",
  );
  const increases = budgetParameters.filter(
    (parameter) => parameter?.mode === "INCREASE_BY",
  );

  if (decreases.length !== 1 || increases.length !== 1) {
    add(
      errors,
      "REALLOCATION_DIRECTION_MISMATCH",
      "components",
      "reallocation requires one decrease and one increase",
    );
    return;
  }

  const left = decreases[0]?.value;
  const right = increases[0]?.value;
  const leftMoney =
    left?.kind === "money" || left?.kind === "money_rate" ? left : undefined;
  const rightMoney =
    right?.kind === "money" || right?.kind === "money_rate" ? right : undefined;
  const ratePeriodMismatch =
    leftMoney?.kind === "money_rate" &&
    rightMoney?.kind === "money_rate" &&
    leftMoney.per !== rightMoney.per;
  if (
    !leftMoney ||
    !rightMoney ||
    leftMoney.kind !== rightMoney.kind ||
    leftMoney.amountMinor !== rightMoney.amountMinor ||
    leftMoney.currency !== rightMoney.currency ||
    ratePeriodMismatch
  ) {
    add(
      errors,
      "REALLOCATION_AMOUNT_MISMATCH",
      "components",
      "decrease and increase must transfer the same explicit monetary amount, currency and period",
    );
  }
}

export function validateAction(
  input: unknown,
  options: ActionValidationOptions = {},
): ActionValidationResult {
  const errors: ActionValidationIssue[] = [];
  if (!record(input)) {
    return {
      ok: false,
      errors: [
        {
          code: "INVALID_ACTION",
          path: "$",
          message: "Action must be an object",
        },
      ],
    };
  }

  if (!compatibleOntologyVersion(input.ontologyVersion)) {
    add(
      errors,
      "INCOMPATIBLE_ONTOLOGY_VERSION",
      "ontologyVersion",
      "only ontology major version 1 is supported",
    );
  }
  if (!nonEmpty(input.actionId)) add(errors, "MISSING_ACTION_ID", "actionId", "required");
  if (!nonEmpty(input.actionType) || !ACTION_TYPE_PATTERN.test(input.actionType)) {
    add(
      errors,
      "INVALID_ACTION_TYPE",
      "actionType",
      "must be a namespaced action type such as paid_media.adjust_budget",
    );
  }
  if (!nonEmpty(input.actionCategory) || !CATEGORY_PATTERN.test(input.actionCategory)) {
    add(
      errors,
      "INVALID_ACTION_CATEGORY",
      "actionCategory",
      "must be a non-empty snake_case category",
    );
  }
  if (!Number.isInteger(input.version) || (input.version as number) < 1) {
    add(errors, "INVALID_ACTION_VERSION", "version", "must be an integer >= 1");
  }
  if (!nonEmpty(input.description)) {
    add(errors, "MISSING_DESCRIPTION", "description", "human-readable description is required");
  }
  if (!["ATOMIC", "COMPOUND"].includes(String(input.atomicity))) {
    add(errors, "INVALID_ATOMICITY", "atomicity", "must be ATOMIC or COMPOUND");
  }
  if (!ACTION_STATES.includes(input.state as never)) {
    add(errors, "INVALID_ACTION_STATE", "state", "unsupported lifecycle state");
  }

  validateTarget(input.target, "target", errors);

  if (!Array.isArray(input.parameters) || input.parameters.length === 0) {
    add(errors, "MISSING_PARAMETERS", "parameters", "at least one intervention parameter is required");
  } else {
    const parameterIds = new Set<string>();
    input.parameters.forEach((parameter: unknown, index: number) => {
      validateParameter(parameter, `parameters[${index}]`, errors);
      if (record(parameter) && typeof parameter.parameterId === "string") {
        if (parameterIds.has(parameter.parameterId)) {
          add(
            errors,
            "DUPLICATE_PARAMETER_ID",
            `parameters[${index}].parameterId`,
            "duplicate parameter IDs are contradictory",
          );
        }
        parameterIds.add(parameter.parameterId);
      }
    });
  }

  const actionType =
    typeof input.actionType === "string" ? input.actionType : "";
  const contract = contractFor(actionType, options);
  if (!contract && actionType.length > 0) {
    add(
      errors,
      "UNREGISTERED_ACTION_TYPE",
      "actionType",
      `action type ${actionType} must have an explicit ActionTypeContract`,
    );
  }
  if (contract) {
    if (input.actionCategory !== contract.category) {
      add(
        errors,
        "ACTION_CATEGORY_MISMATCH",
        "actionCategory",
        `expected category ${contract.category} for ${contract.actionType}`,
      );
    }
    if (input.atomicity !== contract.atomicity) {
      add(
        errors,
        "ACTION_ATOMICITY_MISMATCH",
        "atomicity",
        `expected ${contract.atomicity} for ${contract.actionType}`,
      );
    }
    if (
      record(input.target) &&
      typeof input.target.kind === "string" &&
      !contract.allowedTargetKinds.includes(input.target.kind as never)
    ) {
      add(
        errors,
        "ACTION_TARGET_KIND_MISMATCH",
        "target.kind",
        `${contract.actionType} cannot target ${input.target.kind}`,
      );
    }

    const presentParameterIds = new Set(
      Array.isArray(input.parameters)
        ? input.parameters
            .filter(record)
            .map((parameter: any) => String(parameter.parameterId))
        : [],
    );
    for (const requiredId of contract.requiredParameterIds) {
      if (!presentParameterIds.has(requiredId)) {
        add(
          errors,
          "MISSING_REQUIRED_PARAMETER",
          "parameters",
          `${contract.actionType} requires parameter ${requiredId}`,
        );
      }
    }
  }

  validateTiming(input.timing, "timing", errors);
  validateDuration(input.duration, "duration", input.timing, errors);
  validateCosts(input.cost, "cost", errors);

  const validProperties = new Set<string>([
    ...CORE_CONSTRAINT_PROPERTIES,
    ...(options.additionalConstraintProperties ?? []),
  ]);
  if (!Array.isArray(input.constraints)) {
    add(errors, "INVALID_CONSTRAINTS", "constraints", "must be an array");
  } else {
    input.constraints.forEach((constraint: unknown, index: number) =>
      validateConstraint(
        constraint,
        `constraints[${index}]`,
        errors,
        validProperties,
      ),
    );
  }

  validateReversibility(input.reversibility, "reversibility", errors);
  validateRisks(input.risks, "risks", errors);
  validateMeasurement(input.measurement, "measurement", errors);

  if (input.reversalOfActionId !== undefined) {
    if (!nonEmpty(input.reversalOfActionId)) {
      add(
        errors,
        "INVALID_REVERSAL_ACTION_ID",
        "reversalOfActionId",
        "must be a non-empty actionId",
      );
    } else if (input.reversalOfActionId === input.actionId) {
      add(
        errors,
        "SELF_REVERSAL",
        "reversalOfActionId",
        "an action cannot reverse itself",
      );
    }
  }

  if (input.atomicity === "ATOMIC") {
    if (record(input.target) && input.target.kind === "compound") {
      add(
        errors,
        "ATOMIC_ACTION_COMPOUND_TARGET",
        "target",
        "atomic actions cannot have compound targets",
      );
    }
    if (Array.isArray(input.components) && input.components.length > 0) {
      add(
        errors,
        "ATOMIC_ACTION_HAS_COMPONENTS",
        "components",
        "atomic actions cannot contain components",
      );
    }
    if (input.coordination !== undefined) {
      add(
        errors,
        "ATOMIC_ACTION_HAS_COORDINATION",
        "coordination",
        "atomic actions cannot declare compound coordination",
      );
    }
  }

  if (input.atomicity === "COMPOUND") {
    if (!record(input.target) || input.target.kind !== "compound") {
      add(
        errors,
        "COMPOUND_ACTION_REQUIRES_COMPOUND_TARGET",
        "target",
        "compound actions require a compound target",
      );
    }
    if (!nonEmpty(input.sharedIntentId)) {
      add(
        errors,
        "MISSING_SHARED_INTENT",
        "sharedIntentId",
        "compound actions require a shared intent identifier",
      );
    }
    if (!Array.isArray(input.components) || input.components.length < 2) {
      add(
        errors,
        "MISSING_COMPOUND_COMPONENTS",
        "components",
        "compound actions require at least two component actions",
      );
    } else {
      const componentIds = new Set<string>();
      input.components.forEach((component: unknown, index: number) => {
        const componentResult = validateAction(component, options);
        if (!componentResult.ok) {
          componentResult.errors.forEach((issue) =>
            add(
              errors,
              `COMPONENT_${issue.code}`,
              `components[${index}].${issue.path}`,
              issue.message,
            ),
          );
        }
        if (!record(component)) return;
        if (component.atomicity !== "ATOMIC") {
          add(
            errors,
            "NESTED_COMPOUND_NOT_ALLOWED",
            `components[${index}].atomicity`,
            "compound components must be atomic",
          );
        }
        if (component.parentActionId !== input.actionId) {
          add(
            errors,
            "COMPONENT_PARENT_MISMATCH",
            `components[${index}].parentActionId`,
            "component must reference the compound parent actionId",
          );
        }
        if (component.sharedIntentId !== input.sharedIntentId) {
          add(
            errors,
            "COMPONENT_INTENT_MISMATCH",
            `components[${index}].sharedIntentId`,
            "component must preserve the parent's shared intent",
          );
        }
        if (typeof component.actionId === "string") {
          if (componentIds.has(component.actionId)) {
            add(
              errors,
              "DUPLICATE_COMPONENT_ACTION_ID",
              `components[${index}].actionId`,
              "component action IDs must be unique",
            );
          }
          componentIds.add(component.actionId);
        }
      });

      if (!record(input.coordination)) {
        add(
          errors,
          "MISSING_COMPOUND_COORDINATION",
          "coordination",
          "compound actions require an explicit coordination contract",
        );
      } else {
        if (
          !["all_or_nothing", "ordered", "best_effort"].includes(
            String(input.coordination.executionPolicy),
          )
        ) {
          add(
            errors,
            "INVALID_COMPOUND_EXECUTION_POLICY",
            "coordination.executionPolicy",
            "unsupported compound execution policy",
          );
        }

        if (!Array.isArray(input.coordination.dependencies)) {
          add(
            errors,
            "INVALID_COMPONENT_DEPENDENCIES",
            "coordination.dependencies",
            "component dependencies must be an array",
          );
        } else {
          input.coordination.dependencies.forEach(
            (dependency: unknown, dependencyIndex: number) => {
              const dependencyPath =
                `coordination.dependencies[${dependencyIndex}]`;
              if (
                !record(dependency) ||
                !nonEmpty(dependency.componentActionId) ||
                !Array.isArray(dependency.dependsOnActionIds)
              ) {
                add(
                  errors,
                  "INVALID_COMPONENT_DEPENDENCY",
                  dependencyPath,
                  "componentActionId and dependsOnActionIds are required",
                );
                return;
              }

              if (!componentIds.has(dependency.componentActionId)) {
                add(
                  errors,
                  "UNKNOWN_COMPONENT_DEPENDENCY_SOURCE",
                  `${dependencyPath}.componentActionId`,
                  "dependency source must reference a component action",
                );
              }

              dependency.dependsOnActionIds.forEach(
                (dependencyActionId: unknown, actionIndex: number) => {
                  if (
                    !nonEmpty(dependencyActionId) ||
                    !componentIds.has(dependencyActionId)
                  ) {
                    add(
                      errors,
                      "UNKNOWN_COMPONENT_DEPENDENCY_TARGET",
                      `${dependencyPath}.dependsOnActionIds[${actionIndex}]`,
                      "dependency target must reference a component action",
                    );
                  } else if (
                    dependencyActionId === dependency.componentActionId
                  ) {
                    add(
                      errors,
                      "SELF_COMPONENT_DEPENDENCY",
                      `${dependencyPath}.dependsOnActionIds[${actionIndex}]`,
                      "a component cannot depend on itself",
                    );
                  }
                },
              );
            },
          );
        }
      }
    }
  }

  if (errors.length === 0) {
    const action = input as unknown as Action;
    validateReallocation(action, errors);
  }

  return errors.length === 0
    ? { ok: true, action: input as unknown as Action, errors: [] }
    : { ok: false, errors };
}

export function assertValidAction(
  input: unknown,
  options: ActionValidationOptions = {},
): Action {
  const result = validateAction(input, options);
  if (!result.ok) throw new ActionValidationError(result.errors);
  return result.action;
}

/** Exposed for extension registries and tests. */
export const DEFAULT_ACTION_TYPE_CONTRACTS = CORE_ACTION_TYPE_CONTRACTS;
