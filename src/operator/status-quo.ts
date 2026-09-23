import { ACTION_SCHEMA_VERSION } from "../action_ontology/types.js";
import {
  actionsSemanticallyEqual,
} from "../action_ontology/semantics.js";
import {
  deepFreezeOperator,
  operatorFingerprint,
  stableOperatorJson,
} from "./identity.js";
import {
  assertValidMerchantPolicy,
  materializeMerchantPolicyAction,
  MERCHANT_POLICY_SCHEMA_VERSION,
  type MerchantPolicy,
  type MerchantPolicyDomain,
  type MerchantPolicyRule,
  type NumericComparison,
} from "./merchant-policy.js";
import {
  OPERATOR_INTERFACE_VERSION,
  type CanonicalOperator,
  type CanonicalOperatorMetadata,
  type OperatorDecisionAudit,
  type OperatorDecisionInput,
  type OperatorDecisionOutput,
  type OperatorJson,
} from "./types.js";

export const STATUS_QUO_OPERATOR_ID = "baseline.status_quo" as const;
export const STATUS_QUO_OPERATOR_VERSION = "1.1.0" as const;
export const STATUS_QUO_FROZEN_STEP_3_1_COMMIT =
  "c74e9a4ba32f16aa016f06782cbb60e07e765af6" as const;
export const STATUS_QUO_FROZEN_STEP_3_2_COMMIT =
  "a540ffd87d1ff43b96ad481aeae9d62a07b55362" as const;
export const STATUS_QUO_SUPPORTED_CONTRACT_FINGERPRINT =
  "fnv1a64:b1cc22917a3e566b" as const;

export type StatusQuoRuleEvaluationStatus =
  | "POLICY_INACTIVE"
  | "MAINTAIN_STATE_NO_ACTION"
  | "ENVIRONMENT_OWNED_NO_OPERATOR_ACTION"
  | "SCHEDULE_NOT_DUE"
  | "SCHEDULED_ACTION_TRIGGERED"
  | "TRIGGER_FALSE"
  | "TRIGGERED_ACTION"
  | "INCOMPATIBLE_REQUIRED_OBSERVATION_MISSING"
  | "INCOMPATIBLE_REQUIRED_OBSERVATION_NON_NUMERIC";

export interface StatusQuoRuleEvaluation {
  readonly ruleId: string;
  readonly domain: MerchantPolicyDomain;
  readonly behaviorKey: string;
  readonly ownership: MerchantPolicyRule["ownership"];
  readonly status: StatusQuoRuleEvaluationStatus;
  readonly emittedActionIds: readonly string[];
  readonly observationKey?: string;
  readonly observedValue?: number;
  readonly threshold?: number;
  readonly comparison?: NumericComparison;
  readonly simulatorCompatibility?:
    | "supported_by_frozen_translation"
    | "unsupported_by_frozen_simulator";
  readonly incompatibilityReason?: string;
}

export interface StatusQuoPolicyDecision {
  readonly actions: OperatorDecisionOutput["actions"];
  readonly policyAudit: {
    readonly policyId: string;
    readonly policyVersion: string;
    readonly policyFingerprint: string;
    readonly policySchemaVersion: typeof MERCHANT_POLICY_SCHEMA_VERSION;
    readonly coverage: Readonly<
      Record<MerchantPolicyDomain, "defined" | "undefined">
    >;
    readonly evaluatedRules: readonly StatusQuoRuleEvaluation[];
    readonly triggeredRuleIds: readonly string[];
    readonly emittedActionIds: readonly string[];
    readonly incompatibleRuleIds: readonly string[];
    readonly benchmarkCompatibility:
      | "compatible_with_frozen_simulator"
      | "incompatible_required_policy_semantics";
  };
}

function parseTime(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new TypeError("STATUS_QUO decision time must be ISO-8601");
  }
  return parsed;
}

function activeAt(
  period: { readonly start: string; readonly end?: string },
  decisionTime: string,
): boolean {
  const decision = parseTime(decisionTime);
  const start = parseTime(period.start);
  const end =
    period.end === undefined
      ? undefined
      : parseTime(period.end);
  return decision >= start && (end === undefined || decision < end);
}

function sameInstant(left: string, right: string): boolean {
  return parseTime(left) === parseTime(right);
}

function readPath(
  input: unknown,
  path: string | undefined,
): unknown {
  if (path === undefined || path.trim() === "") return input;
  let current: unknown = input;
  for (const segment of path.split(".")) {
    if (
      typeof current !== "object" ||
      current === null ||
      Array.isArray(current)
    ) {
      return undefined;
    }
    const record = current as Record<string, unknown>;
    if (!(segment in record)) return undefined;
    current = record[segment];
  }
  return current;
}

function compare(
  value: number,
  comparison: NumericComparison,
  threshold: number,
): boolean {
  switch (comparison) {
    case "LT":
      return value < threshold;
    case "LTE":
      return value <= threshold;
    case "GT":
      return value > threshold;
    case "GTE":
      return value >= threshold;
    case "EQ":
      return value === threshold;
  }
}

function evaluateRule(
  rule: MerchantPolicyRule,
  input: Readonly<OperatorDecisionInput>,
): {
  readonly evaluation: StatusQuoRuleEvaluation;
  readonly actions: OperatorDecisionOutput["actions"];
} {
  if (!activeAt(rule.effectivePeriod, input.decisionTime)) {
    return {
      evaluation: {
        ruleId: rule.ruleId,
        domain: rule.domain,
        behaviorKey: rule.behaviorKey,
        ownership: rule.ownership,
        status: "POLICY_INACTIVE",
        emittedActionIds: [],
      },
      actions: [],
    };
  }

  if (rule.kind === "maintain_state") {
    return {
      evaluation: {
        ruleId: rule.ruleId,
        domain: rule.domain,
        behaviorKey: rule.behaviorKey,
        ownership: rule.ownership,
        status: "MAINTAIN_STATE_NO_ACTION",
        emittedActionIds: [],
      },
      actions: [],
    };
  }

  if (rule.kind === "environment_behavior") {
    return {
      evaluation: {
        ruleId: rule.ruleId,
        domain: rule.domain,
        behaviorKey: rule.behaviorKey,
        ownership: rule.ownership,
        status: "ENVIRONMENT_OWNED_NO_OPERATOR_ACTION",
        emittedActionIds: [],
      },
      actions: [],
    };
  }

  if (rule.kind === "scheduled_action") {
    if (!sameInstant(rule.executeAt, input.decisionTime)) {
      return {
        evaluation: {
          ruleId: rule.ruleId,
          domain: rule.domain,
          behaviorKey: rule.behaviorKey,
          ownership: rule.ownership,
          status: "SCHEDULE_NOT_DUE",
          emittedActionIds: [],
          simulatorCompatibility: rule.simulatorCompatibility,
          ...(rule.incompatibilityReason === undefined
            ? {}
            : { incompatibilityReason: rule.incompatibilityReason }),
        },
        actions: [],
      };
    }

    const action = materializeMerchantPolicyAction(
      rule,
      input.decisionTime,
    );
    return {
      evaluation: {
        ruleId: rule.ruleId,
        domain: rule.domain,
        behaviorKey: rule.behaviorKey,
        ownership: rule.ownership,
        status: "SCHEDULED_ACTION_TRIGGERED",
        emittedActionIds: [String(action.actionId)],
        simulatorCompatibility: rule.simulatorCompatibility,
        ...(rule.incompatibilityReason === undefined
          ? {}
          : { incompatibilityReason: rule.incompatibilityReason }),
      },
      actions: [action],
    };
  }

  const observation = input.observation.records.find(
    (record) => record.observationKey === rule.observationKey,
  );
  if (observation === undefined) {
    return {
      evaluation: {
        ruleId: rule.ruleId,
        domain: rule.domain,
        behaviorKey: rule.behaviorKey,
        ownership: rule.ownership,
        status: "INCOMPATIBLE_REQUIRED_OBSERVATION_MISSING",
        emittedActionIds: [],
        observationKey: rule.observationKey,
        threshold: rule.threshold,
        comparison: rule.comparison,
        simulatorCompatibility: rule.simulatorCompatibility,
        incompatibilityReason:
          "Frozen merchant policy requires an observation that is not available through the governed operator input.",
      },
      actions: [],
    };
  }

  const observed = readPath(
    observation.value,
    rule.observationValuePath,
  );
  if (typeof observed !== "number" || !Number.isFinite(observed)) {
    return {
      evaluation: {
        ruleId: rule.ruleId,
        domain: rule.domain,
        behaviorKey: rule.behaviorKey,
        ownership: rule.ownership,
        status: "INCOMPATIBLE_REQUIRED_OBSERVATION_NON_NUMERIC",
        emittedActionIds: [],
        observationKey: rule.observationKey,
        threshold: rule.threshold,
        comparison: rule.comparison,
        simulatorCompatibility: rule.simulatorCompatibility,
        incompatibilityReason:
          "Frozen merchant policy trigger observation is present but cannot be evaluated as the required finite numeric value.",
      },
      actions: [],
    };
  }

  if (!compare(observed, rule.comparison, rule.threshold)) {
    return {
      evaluation: {
        ruleId: rule.ruleId,
        domain: rule.domain,
        behaviorKey: rule.behaviorKey,
        ownership: rule.ownership,
        status: "TRIGGER_FALSE",
        emittedActionIds: [],
        observationKey: rule.observationKey,
        observedValue: observed,
        threshold: rule.threshold,
        comparison: rule.comparison,
        simulatorCompatibility: rule.simulatorCompatibility,
        ...(rule.incompatibilityReason === undefined
          ? {}
          : { incompatibilityReason: rule.incompatibilityReason }),
      },
      actions: [],
    };
  }

  const action = materializeMerchantPolicyAction(
    rule,
    input.decisionTime,
  );
  return {
    evaluation: {
      ruleId: rule.ruleId,
      domain: rule.domain,
      behaviorKey: rule.behaviorKey,
      ownership: rule.ownership,
      status: "TRIGGERED_ACTION",
      emittedActionIds: [String(action.actionId)],
      observationKey: rule.observationKey,
      observedValue: observed,
      threshold: rule.threshold,
      comparison: rule.comparison,
      simulatorCompatibility: rule.simulatorCompatibility,
      ...(rule.incompatibilityReason === undefined
        ? {}
        : { incompatibilityReason: rule.incompatibilityReason }),
    },
    actions: [action],
  };
}

const DOMAINS: readonly MerchantPolicyDomain[] = [
  "advertising",
  "pricing",
  "promotions",
  "merchandising",
  "inventory",
];

export function evaluateStatusQuoPolicy(
  policyInput: MerchantPolicy,
  input: Readonly<OperatorDecisionInput>,
): StatusQuoPolicyDecision {
  const policy = assertValidMerchantPolicy(policyInput);
  const policyActive = activeAt(
    policy.effectivePeriod,
    input.decisionTime,
  );

  const evaluations: StatusQuoRuleEvaluation[] = [];
  const actions: OperatorDecisionOutput["actions"][number][] = [];

  for (const domain of DOMAINS) {
    const component = policy.components[domain];
    for (const rule of component.rules) {
      if (!policyActive) {
        evaluations.push({
          ruleId: rule.ruleId,
          domain: rule.domain,
          behaviorKey: rule.behaviorKey,
          ownership: rule.ownership,
          status: "POLICY_INACTIVE",
          emittedActionIds: [],
        });
        continue;
      }

      const result = evaluateRule(rule, input);
      evaluations.push(result.evaluation);
      actions.push(...result.actions);
    }
  }

  const triggered = evaluations.filter(
    (entry) =>
      entry.status === "SCHEDULED_ACTION_TRIGGERED" ||
      entry.status === "TRIGGERED_ACTION",
  );
  const incompatible = evaluations.filter(
    (entry) =>
      entry.status.startsWith("INCOMPATIBLE_") ||
      (entry.simulatorCompatibility ===
        "unsupported_by_frozen_simulator" &&
        (entry.status === "SCHEDULED_ACTION_TRIGGERED" ||
          entry.status === "TRIGGERED_ACTION")),
  );

  return deepFreezeOperator({
    actions,
    policyAudit: {
      policyId: policy.policyId,
      policyVersion: policy.policyVersion,
      policyFingerprint: policy.policyFingerprint,
      policySchemaVersion: policy.schemaVersion,
      coverage: Object.fromEntries(
        DOMAINS.map((domain) => [
          domain,
          policy.components[domain].coverage,
        ]),
      ) as Readonly<
        Record<MerchantPolicyDomain, "defined" | "undefined">
      >,
      evaluatedRules: evaluations,
      triggeredRuleIds: triggered.map((entry) => entry.ruleId),
      emittedActionIds: actions.map((action) =>
        String(action.actionId),
      ),
      incompatibleRuleIds: incompatible.map(
        (entry) => entry.ruleId,
      ),
      benchmarkCompatibility:
        incompatible.length === 0
          ? "compatible_with_frozen_simulator"
          : "incompatible_required_policy_semantics",
    },
  });
}

const STATUS_QUO_IMPLEMENTATION_SEMANTICS = deepFreezeOperator({
  operatorInterfaceVersion: OPERATOR_INTERFACE_VERSION,
  operatorId: STATUS_QUO_OPERATOR_ID,
  operatorVersion: STATUS_QUO_OPERATOR_VERSION,
  supportedEvaluationContract: {
    contractId: "kivviq.baseline-evaluation",
    contractVersion: "1.0.0",
    contractFingerprint: STATUS_QUO_SUPPORTED_CONTRACT_FINGERPRINT,
    frozenCommit: STATUS_QUO_FROZEN_STEP_3_1_COMMIT,
  },
  supportedActionOntologyVersion: ACTION_SCHEMA_VERSION,
  merchantPolicySchemaVersion: MERCHANT_POLICY_SCHEMA_VERSION,
  decisionAlgorithm:
    "evaluate only frozen merchant-policy rules against permitted operator observations and the current decision timestamp; emit canonical Actions required by that pre-existing policy; never optimize; explicitly mark a decision incompatible when a required triggered policy Action cannot be faithfully represented by the frozen simulator",
  randomness: "none_unless_future_policy_schema_explicitly_versions_and_seeds_it",
} as const);

export const STATUS_QUO_IMPLEMENTATION_FINGERPRINT =
  operatorFingerprint(STATUS_QUO_IMPLEMENTATION_SEMANTICS);

export function statusQuoConfigurationFingerprint(
  policyInput: MerchantPolicy,
): string {
  const policy = assertValidMerchantPolicy(policyInput);
  return operatorFingerprint({
    configurationSchemaVersion: "1.0.0",
    merchantPolicySchemaVersion: policy.schemaVersion,
    merchantPolicyId: policy.policyId,
    merchantPolicyVersion: policy.policyVersion,
    merchantPolicyFingerprint: policy.policyFingerprint,
    componentFingerprints: {
      advertising: policy.components.advertising.componentFingerprint,
      pricing: policy.components.pricing.componentFingerprint,
      promotions: policy.components.promotions.componentFingerprint,
      merchandising: policy.components.merchandising.componentFingerprint,
      inventory: policy.components.inventory.componentFingerprint,
    },
    frozenStep32InterfaceCommit:
      STATUS_QUO_FROZEN_STEP_3_2_COMMIT,
    optimizationObjective: null,
    policyRandomness: false,
  });
}

export function createStatusQuoOperator(
  policyInput: MerchantPolicy,
): CanonicalOperator {
  const policy = assertValidMerchantPolicy(policyInput);
  const configurationFingerprint =
    statusQuoConfigurationFingerprint(policy);

  const metadata: CanonicalOperatorMetadata = deepFreezeOperator({
    interfaceVersion: OPERATOR_INTERFACE_VERSION,
    operatorId: STATUS_QUO_OPERATOR_ID,
    operatorType: "baseline",
    operatorVersion: STATUS_QUO_OPERATOR_VERSION,
    description:
      "Canonical business-as-usual baseline. Reproduces the merchant's frozen pre-existing operating policy without optimization.",
    supportedEvaluationContract: {
      contractId: "kivviq.baseline-evaluation",
      contractVersion: "1.0.0",
      contractFingerprint: STATUS_QUO_SUPPORTED_CONTRACT_FINGERPRINT,
      frozenCommit: STATUS_QUO_FROZEN_STEP_3_1_COMMIT,
    },
    supportedActionOntologyVersion: ACTION_SCHEMA_VERSION,
    deterministicConfiguration: {
      configurationSchemaVersion: "1.0.0",
      configurationFingerprint,
      merchantPolicySchemaVersion: policy.schemaVersion,
      merchantPolicyId: policy.policyId,
      merchantPolicyVersion: policy.policyVersion,
      merchantPolicyFingerprint: policy.policyFingerprint,
      componentFingerprints: {
        advertising: policy.components.advertising.componentFingerprint,
        pricing: policy.components.pricing.componentFingerprint,
        promotions: policy.components.promotions.componentFingerprint,
        merchandising: policy.components.merchandising.componentFingerprint,
        inventory: policy.components.inventory.componentFingerprint,
      },
      frozenStep32InterfaceCommit:
        STATUS_QUO_FROZEN_STEP_3_2_COMMIT,
      optimizationObjective: null,
      policyRandomness: false,
    },
    implementationFingerprint:
      STATUS_QUO_IMPLEMENTATION_FINGERPRINT,
  });

  return deepFreezeOperator({
    metadata,
    decide(
      input: Readonly<OperatorDecisionInput>,
    ): OperatorDecisionOutput {
      return {
        actions: evaluateStatusQuoPolicy(policy, input).actions,
      };
    },
    auditDecision(
      input: Readonly<OperatorDecisionInput>,
      output: Readonly<OperatorDecisionOutput>,
    ): OperatorDecisionAudit {
      const decision = evaluateStatusQuoPolicy(policy, input);
      if (
        output.actions.length !== decision.actions.length ||
        output.actions.some(
          (action, index) =>
            !actionsSemanticallyEqual(
              action,
              decision.actions[index]!,
            ),
        )
      ) {
        throw new TypeError(
          "STATUS_QUO audit does not match operator decision output",
        );
      }

      return {
        auditType: "merchant_policy_evaluation",
        payload: JSON.parse(
          stableOperatorJson(
            decision.policyAudit,
          ),
        ) as OperatorJson,
      };
    },
  });
}
