import { actionId } from "../action_ontology/identity.js";
import { actionFingerprint } from "../action_ontology/semantics.js";
import type { Action } from "../action_ontology/types.js";
import { assertValidAction } from "../action_ontology/validation.js";
import { utcTimestamp } from "../core/units.js";
import {
  deepFreezeOperator,
  operatorFingerprint,
} from "./identity.js";

export const MERCHANT_POLICY_SCHEMA_VERSION = "1.0.0" as const;

export type MerchantPolicyDomain =
  | "advertising"
  | "pricing"
  | "promotions"
  | "merchandising"
  | "inventory";

export type MerchantPolicyOwnership =
  | "environment_owned"
  | "operator_owned";

export type MerchantPolicyCoverage =
  | "defined"
  | "undefined";

export interface MerchantPolicySource {
  readonly sourceRef: string;
  readonly capturedAt: string;
  readonly description: string;
}

export interface MerchantPolicyEffectivePeriod {
  readonly start: string;
  readonly end?: string;
}

interface MerchantPolicyRuleBase {
  readonly ruleId: string;
  readonly domain: MerchantPolicyDomain;
  readonly behaviorKey: string;
  readonly description: string;
  readonly version: string;
  readonly sourceRef: string;
  readonly effectivePeriod: MerchantPolicyEffectivePeriod;
  readonly ownership: MerchantPolicyOwnership;
}

export interface MaintainStatePolicyRule
  extends MerchantPolicyRuleBase {
  readonly kind: "maintain_state";
  readonly ownership: "environment_owned";
  readonly cadence: "continuous";
  readonly stateRef: string;
}

export interface EnvironmentBehaviorPolicyRule
  extends MerchantPolicyRuleBase {
  readonly kind: "environment_behavior";
  readonly ownership: "environment_owned";
  readonly cadence:
    | "continuous"
    | "simulator_native";
  readonly environmentMechanismRef: string;
}

export interface ScheduledActionPolicyRule
  extends MerchantPolicyRuleBase {
  readonly kind: "scheduled_action";
  readonly ownership: "operator_owned";
  readonly cadence: "scheduled_once";
  readonly executeAt: string;
  readonly actionPrototype: Action;
  readonly simulatorCompatibility:
    | "supported_by_frozen_translation"
    | "unsupported_by_frozen_simulator";
  readonly incompatibilityReason?: string;
}

export type NumericComparison =
  | "LT"
  | "LTE"
  | "GT"
  | "GTE"
  | "EQ";

export interface ObservationTriggeredActionPolicyRule
  extends MerchantPolicyRuleBase {
  readonly kind: "observation_triggered_action";
  readonly ownership: "operator_owned";
  readonly cadence: "every_decision_while_true";
  readonly observationKey: string;
  readonly observationValuePath?: string;
  readonly comparison: NumericComparison;
  readonly threshold: number;
  readonly actionPrototype: Action;
  readonly simulatorCompatibility:
    | "supported_by_frozen_translation"
    | "unsupported_by_frozen_simulator";
  readonly incompatibilityReason?: string;
}

export type MerchantPolicyRule =
  | MaintainStatePolicyRule
  | EnvironmentBehaviorPolicyRule
  | ScheduledActionPolicyRule
  | ObservationTriggeredActionPolicyRule;

export interface MerchantPolicyComponent {
  readonly domain: MerchantPolicyDomain;
  readonly coverage: MerchantPolicyCoverage;
  readonly rules: readonly MerchantPolicyRule[];
}

export interface MerchantPolicyComponents {
  readonly advertising: MerchantPolicyComponent;
  readonly pricing: MerchantPolicyComponent;
  readonly promotions: MerchantPolicyComponent;
  readonly merchandising: MerchantPolicyComponent;
  readonly inventory: MerchantPolicyComponent;
}

export interface MerchantPolicy {
  readonly kind: "merchant_policy";
  readonly schemaVersion: typeof MERCHANT_POLICY_SCHEMA_VERSION;
  readonly policyId: string;
  readonly policyVersion: string;
  readonly description: string;
  readonly source: MerchantPolicySource;
  readonly effectivePeriod: MerchantPolicyEffectivePeriod;
  readonly components: MerchantPolicyComponents;
  readonly policyFingerprint: string;
}

export interface MerchantPolicyInput {
  readonly policyId: string;
  readonly policyVersion: string;
  readonly description: string;
  readonly source: MerchantPolicySource;
  readonly effectivePeriod: MerchantPolicyEffectivePeriod;
  readonly components: MerchantPolicyComponents;
}

export class MerchantPolicyValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "MerchantPolicyValidationError";
  }
}

function requireCondition(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) throw new MerchantPolicyValidationError(message);
}

function parseTime(value: string, label: string): number {
  const parsed = Date.parse(value);
  requireCondition(Number.isFinite(parsed), label + " must be ISO-8601");
  return parsed;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function semver(value: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(value);
}

const DOMAINS: readonly MerchantPolicyDomain[] = [
  "advertising",
  "pricing",
  "promotions",
  "merchandising",
  "inventory",
];

function componentFor(
  components: MerchantPolicyComponents,
  domain: MerchantPolicyDomain,
): MerchantPolicyComponent {
  return components[domain];
}

function validateRule(
  rule: MerchantPolicyRule,
  policyStart: number,
  policyEnd: number | undefined,
): void {
  requireCondition(rule.ruleId.trim().length > 0, "ruleId is required");
  requireCondition(
    rule.behaviorKey.trim().length > 0,
    "behaviorKey is required",
  );
  requireCondition(
    rule.description.trim().length > 0,
    "rule description is required",
  );
  requireCondition(semver(rule.version), "rule version must be semantic");
  requireCondition(
    rule.sourceRef.trim().length > 0,
    "rule sourceRef is required",
  );

  const start = parseTime(
    rule.effectivePeriod.start,
    "rule effectivePeriod.start",
  );
  const end =
    rule.effectivePeriod.end === undefined
      ? undefined
      : parseTime(
          rule.effectivePeriod.end,
          "rule effectivePeriod.end",
        );

  requireCondition(
    start >= policyStart,
    "rule cannot begin before merchant policy effective period",
  );
  if (end !== undefined) {
    requireCondition(end > start, "rule effective end must follow start");
    if (policyEnd !== undefined) {
      requireCondition(
        end <= policyEnd,
        "rule cannot end after merchant policy effective period",
      );
    }
  }

  if (
    rule.kind === "maintain_state" ||
    rule.kind === "environment_behavior"
  ) {
    requireCondition(
      rule.ownership === "environment_owned",
      "non-Action policy behavior must be environment-owned",
    );
    return;
  }

  requireCondition(
    rule.ownership === "operator_owned",
    "Action-emitting policy rule must be operator-owned",
  );
  const action = assertValidAction(rule.actionPrototype);
  requireCondition(
    action.provenance.source !== "optimizer",
    "merchant status-quo Action prototype cannot be optimizer-sourced",
  );
  requireCondition(
    action.provenance.source !== "diagnosis_engine" &&
      action.provenance.source !== "opportunity_engine",
    "merchant status-quo Action prototype cannot come from an optimization/recommendation engine",
  );

  if (rule.kind === "scheduled_action") {
    parseTime(rule.executeAt, "scheduled rule executeAt");
  } else {
    requireCondition(
      rule.observationKey.trim().length > 0,
      "triggered rule observationKey is required",
    );
    requireCondition(
      Number.isFinite(rule.threshold),
      "trigger threshold must be finite",
    );
  }

  if (
    rule.simulatorCompatibility ===
    "unsupported_by_frozen_simulator"
  ) {
    requireCondition(
      rule.incompatibilityReason !== undefined &&
        rule.incompatibilityReason.trim().length > 0,
      "unsupported policy Action must record its simulator incompatibility",
    );
  }
}

function validatePolicyBody(
  body: Omit<MerchantPolicy, "policyFingerprint">,
): void {
  requireCondition(
    body.kind === "merchant_policy",
    "policy kind must be merchant_policy",
  );
  requireCondition(
    body.schemaVersion === MERCHANT_POLICY_SCHEMA_VERSION,
    "unsupported merchant-policy schema",
  );
  requireCondition(body.policyId.trim().length > 0, "policyId is required");
  requireCondition(
    semver(body.policyVersion),
    "policyVersion must be semantic",
  );
  requireCondition(
    body.description.trim().length > 0,
    "policy description is required",
  );
  requireCondition(
    body.source.sourceRef.trim().length > 0,
    "policy sourceRef is required",
  );
  parseTime(body.source.capturedAt, "policy source capturedAt");

  const policyStart = parseTime(
    body.effectivePeriod.start,
    "policy effectivePeriod.start",
  );
  const policyEnd =
    body.effectivePeriod.end === undefined
      ? undefined
      : parseTime(
          body.effectivePeriod.end,
          "policy effectivePeriod.end",
        );
  if (policyEnd !== undefined) {
    requireCondition(
      policyEnd > policyStart,
      "policy effective end must follow start",
    );
  }

  const ruleIds = new Set<string>();
  const behaviorOwners = new Map<string, MerchantPolicyOwnership>();
  const scheduledActionKeys = new Set<string>();

  for (const domain of DOMAINS) {
    const component = componentFor(body.components, domain);
    requireCondition(
      component.domain === domain,
      "policy component domain mismatch for " + domain,
    );
    if (component.coverage === "undefined") {
      requireCondition(
        component.rules.length === 0,
        "undefined policy component must not invent rules",
      );
    }

    for (const rule of component.rules) {
      requireCondition(
        rule.domain === domain,
        "rule domain must match its policy component",
      );
      requireCondition(
        !ruleIds.has(rule.ruleId),
        "duplicate merchant-policy ruleId: " + rule.ruleId,
      );
      ruleIds.add(rule.ruleId);

      const existingOwner = behaviorOwners.get(rule.behaviorKey);
      requireCondition(
        existingOwner === undefined ||
          existingOwner === rule.ownership,
        "behavior cannot be both environment-owned and operator-owned: " +
          rule.behaviorKey,
      );
      behaviorOwners.set(rule.behaviorKey, rule.ownership);

      validateRule(rule, policyStart, policyEnd);

      if (
        rule.kind === "scheduled_action" ||
        rule.kind === "observation_triggered_action"
      ) {
        const duplicateKey =
          rule.kind +
          "|" +
          rule.behaviorKey +
          "|" +
          actionFingerprint(assertValidAction(rule.actionPrototype)) +
          "|" +
          (rule.kind === "scheduled_action"
            ? rule.executeAt
            : rule.observationKey);
        requireCondition(
          !scheduledActionKeys.has(duplicateKey),
          "duplicate operator-owned policy Action rule",
        );
        scheduledActionKeys.add(duplicateKey);
      }
    }
  }
}

export function createMerchantPolicy(
  input: MerchantPolicyInput,
): MerchantPolicy {
  const body = {
    kind: "merchant_policy" as const,
    schemaVersion: MERCHANT_POLICY_SCHEMA_VERSION,
    policyId: input.policyId,
    policyVersion: input.policyVersion,
    description: input.description,
    source: cloneJson(input.source),
    effectivePeriod: cloneJson(input.effectivePeriod),
    components: cloneJson(input.components),
  };

  validatePolicyBody(body);

  return deepFreezeOperator({
    ...body,
    policyFingerprint: operatorFingerprint(body),
  });
}

export function assertValidMerchantPolicy(
  input: MerchantPolicy,
): MerchantPolicy {
  const { policyFingerprint, ...body } = input;
  validatePolicyBody(body);
  requireCondition(
    policyFingerprint === operatorFingerprint(body),
    "merchant-policy fingerprint mismatch",
  );
  return deepFreezeOperator(input);
}

function rebindExactString(
  value: unknown,
  from: string,
  to: string,
): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) =>
      rebindExactString(entry, from, to),
    );
  }
  if (typeof value !== "object" || value === null) {
    return value === from ? to : value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(
      ([key, entry]) => [
        key,
        rebindExactString(entry, from, to),
      ],
    ),
  );
}

export function materializeMerchantPolicyAction(
  rule:
    | ScheduledActionPolicyRule
    | ObservationTriggeredActionPolicyRule,
  decisionTime: string,
): Action {
  const prototype = assertValidAction(rule.actionPrototype);
  const rebound = rebindExactString(
    cloneJson(prototype),
    String(prototype.timing.decisionTime),
    decisionTime,
  ) as Action;

  const materialized = {
    ...rebound,
    actionId: actionId(
      String(prototype.actionId) +
        ":status_quo:" +
        rule.ruleId +
        ":" +
        decisionTime.replace(/[^0-9]/g, ""),
    ),
    provenance: {
      source: "rule_based_baseline" as const,
      sourceId:
        "merchant-policy:" +
        rule.ruleId +
        "@" +
        rule.version,
      createdAt: utcTimestamp(decisionTime),
      evidenceRefs: [
        "merchant-policy:" + rule.ruleId,
        rule.sourceRef,
      ],
    },
    intent: {
      ...rebound.intent,
      statement:
        "Execute the merchant's frozen pre-existing policy without optimization.",
      intentRef: "merchant-policy:" + rule.ruleId,
    },
  };

  return assertValidAction(materialized);
}

export function merchantPolicyRuleActionFingerprint(
  rule:
    | ScheduledActionPolicyRule
    | ObservationTriggeredActionPolicyRule,
): string {
  return actionFingerprint(assertValidAction(rule.actionPrototype));
}
