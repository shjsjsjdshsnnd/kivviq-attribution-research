import {
  ACTION_CATEGORIES,
  ACTION_SCHEMA_VERSION,
  type Action,
  type CoreActionCategory,
} from "../action_ontology/types.js";
import {
  actionFingerprint,
  actionSemanticKey,
} from "../action_ontology/semantics.js";
import { assertValidAction } from "../action_ontology/validation.js";
import type {
  BaselineEvaluationContract,
  DecisionOpportunity,
  ActionAvailabilitySnapshot,
  OperatorObservationSnapshot,
} from "../evaluation/baseline-contract.js";
import {
  deepFreezeOperator,
  operatorFingerprint,
  stableOperatorJson,
} from "./identity.js";
import type {
  CanonicalOperator,
  OperatorDecisionAudit,
  OperatorDecisionInput,
  OperatorDecisionOutput,
  OperatorJson,
} from "./types.js";

export const CANONICAL_OPERATOR_INTERFACE_VERSION = "2.0.0" as const;
export const CANONICAL_OPERATOR_INPUT_SCHEMA_VERSION = "1.0.0" as const;
export const CANONICAL_OPERATOR_DECISION_SCHEMA_VERSION = "1.0.0" as const;
export const CANONICAL_OPERATOR_METADATA_SCHEMA_VERSION = "1.0.0" as const;
export const CANONICAL_OPERATOR_CAPABILITY_SCHEMA_VERSION = "1.0.0" as const;
export const CANONICAL_OPERATOR_PROVENANCE_SCHEMA_VERSION = "1.0.0" as const;

export const CANONICAL_OPERATOR_FROZEN_STEP_3_1_COMMIT =
  "c74e9a4ba32f16aa016f06782cbb60e07e765af6" as const;
export const CANONICAL_OPERATOR_FROZEN_STEP_3_9_COMMIT =
  "772546d5d6c23eada255d1b5f7997a1a04896ca2" as const;
export const CANONICAL_OPERATOR_SUPPORTED_CONTRACT_FINGERPRINT =
  "fnv1a64:b1cc22917a3e566b" as const;

export type CanonicalOperatorFamily =
  | "do_nothing"
  | "status_quo"
  | "advertising_heuristic"
  | "inventory_heuristic"
  | "pricing_promotion_heuristic"
  | "merchandising_heuristic"
  | "greedy"
  | "flawed_optimizer"
  | "advanced_decision_system";

export type OperatorRandomnessSemantics =
  | {
      readonly kind: "deterministic";
    }
  | {
      readonly kind: "seeded_stochastic";
      readonly seedNamespace: "operator_internal";
      readonly seedRequired: true;
    };

export interface CanonicalOperatorCapabilities {
  readonly schemaVersion:
    typeof CANONICAL_OPERATOR_CAPABILITY_SCHEMA_VERSION;
  readonly actionDomains: readonly CoreActionCategory[];
  readonly supportsZeroActions: true;
  readonly supportsOneAction: true;
  readonly supportsMultipleActions: true;
  readonly maximumActionsPerDecision: number;
  readonly randomness: OperatorRandomnessSemantics;
}

export interface CanonicalOperatorMetadataV2 {
  readonly schemaVersion:
    typeof CANONICAL_OPERATOR_METADATA_SCHEMA_VERSION;
  readonly interfaceVersion: typeof CANONICAL_OPERATOR_INTERFACE_VERSION;
  readonly operatorId: string;
  readonly operatorVersion: string;
  readonly operatorFamily: CanonicalOperatorFamily;
  readonly description: string;
  readonly implementationFingerprint: string;
  readonly configurationFingerprint: string;
  readonly legacyInterfaceVersion: string | null;
  readonly supportedEvaluationContract: {
    readonly contractId: string;
    readonly contractVersion: string;
    readonly contractFingerprint: string;
    readonly frozenCommit: string;
  };
  readonly supportedActionOntologyVersion: string;
  readonly capabilities: CanonicalOperatorCapabilities;
  readonly adapterFingerprint: string;
}

export interface CanonicalOperatorInputV2
  extends OperatorDecisionInput {
  readonly schemaVersion:
    typeof CANONICAL_OPERATOR_INPUT_SCHEMA_VERSION;
  readonly decisionContext: {
    readonly sequence: number;
    readonly trigger: DecisionOpportunity["trigger"];
  };
  readonly constraints: {
    readonly dimensions: readonly string[];
    readonly evaluationBoundary: "decision_time";
    readonly invalidActionHandling: "reject";
    readonly infeasibleActionHandling: "reject";
    readonly partialFeasibilityHandling:
      "require_explicit_modified_action";
    readonly conflictHandling: "reject";
    readonly silentModificationForbidden: true;
  };
  readonly provenance: {
    readonly schemaVersion:
      typeof CANONICAL_OPERATOR_PROVENANCE_SCHEMA_VERSION;
    readonly evaluationContractFingerprint: string;
    readonly evaluationContractVersion: string;
    readonly observationFingerprint: string;
    readonly legalActionSpaceFingerprint: string;
    readonly actionOntologyVersion: string;
    readonly source: "step3.1-governed-evaluator-adapter";
  };
}

export interface CanonicalOperatorDecisionMetadata {
  readonly interfaceVersion: typeof CANONICAL_OPERATOR_INTERFACE_VERSION;
  readonly decisionTimestamp: string;
  readonly deterministicReplayExpected: boolean;
  readonly randomness: OperatorRandomnessSemantics;
  readonly canonicalActionOrdering:
    "ACTION_TYPE_TARGET_PARAMETERS_ACTION_ID_ASC";
}

export interface CanonicalOperatorDecisionV2 {
  readonly schemaVersion:
    typeof CANONICAL_OPERATOR_DECISION_SCHEMA_VERSION;
  readonly actions: readonly Action[];
  readonly operatorMetadata: CanonicalOperatorMetadataV2;
  readonly decisionMetadata: CanonicalOperatorDecisionMetadata;
}

export interface CanonicalOperatorV2 {
  readonly metadata: CanonicalOperatorMetadataV2;
  decide(
    input: Readonly<CanonicalOperatorInputV2>,
  ): CanonicalOperatorDecisionV2;
  auditDecision?(
    input: Readonly<CanonicalOperatorInputV2>,
    output: Readonly<CanonicalOperatorDecisionV2>,
  ): OperatorDecisionAudit;
}

export interface LegacyOperatorConformanceDescriptor {
  readonly family: CanonicalOperatorFamily;
  readonly actionDomains: readonly CoreActionCategory[];
  readonly maximumActionsPerDecision: number;
  readonly randomness: OperatorRandomnessSemantics;
}

const ALL_EXECUTABLE_DOMAINS = ACTION_CATEGORIES.filter(
  (entry) => entry !== "no_op",
) as readonly CoreActionCategory[];

const LEGACY_OPERATOR_CONFORMANCE: Readonly<
  Record<string, LegacyOperatorConformanceDescriptor>
> = deepFreezeOperator({
  "baseline.do_nothing": {
    family: "do_nothing",
    actionDomains: [],
    maximumActionsPerDecision: 0,
    randomness: { kind: "deterministic" },
  },
  "baseline.status_quo": {
    family: "status_quo",
    actionDomains: [
      "advertising",
      "pricing",
      "promotion",
      "merchandising",
      "inventory",
    ],
    maximumActionsPerDecision: 16,
    randomness: { kind: "deterministic" },
  },

  "baseline.advertising.equal_budget_allocation": {
    family: "advertising_heuristic",
    actionDomains: ["advertising"],
    maximumActionsPerDecision: 8,
    randomness: { kind: "deterministic" },
  },
  "baseline.advertising.roas_threshold_increase": {
    family: "advertising_heuristic",
    actionDomains: ["advertising"],
    maximumActionsPerDecision: 8,
    randomness: { kind: "deterministic" },
  },
  "baseline.advertising.roas_threshold_decrease": {
    family: "advertising_heuristic",
    actionDomains: ["advertising"],
    maximumActionsPerDecision: 8,
    randomness: { kind: "deterministic" },
  },
  "baseline.advertising.highest_observed_roas": {
    family: "advertising_heuristic",
    actionDomains: ["advertising"],
    maximumActionsPerDecision: 2,
    randomness: { kind: "deterministic" },
  },
  "baseline.advertising.fixed_channel_allocation": {
    family: "advertising_heuristic",
    actionDomains: ["advertising"],
    maximumActionsPerDecision: 8,
    randomness: { kind: "deterministic" },
  },

  "baseline.inventory.fixed_reorder_threshold": {
    family: "inventory_heuristic",
    actionDomains: ["inventory"],
    maximumActionsPerDecision: 1,
    randomness: { kind: "deterministic" },
  },
  "baseline.inventory.fixed_reorder_quantity": {
    family: "inventory_heuristic",
    actionDomains: ["inventory"],
    maximumActionsPerDecision: 1,
    randomness: { kind: "deterministic" },
  },
  "baseline.inventory.low_inventory_depromotion": {
    family: "inventory_heuristic",
    actionDomains: ["promotion"],
    maximumActionsPerDecision: 1,
    randomness: { kind: "deterministic" },
  },
  "baseline.inventory.no_inventory_aware_intervention": {
    family: "inventory_heuristic",
    actionDomains: [],
    maximumActionsPerDecision: 0,
    randomness: { kind: "deterministic" },
  },

  "baseline.pricing.never_discount": {
    family: "pricing_promotion_heuristic",
    actionDomains: ["pricing"],
    maximumActionsPerDecision: 1,
    randomness: { kind: "deterministic" },
  },
  "baseline.pricing.fixed_discount": {
    family: "pricing_promotion_heuristic",
    actionDomains: ["pricing"],
    maximumActionsPerDecision: 1,
    randomness: { kind: "deterministic" },
  },
  "baseline.pricing.excess_inventory_discount": {
    family: "pricing_promotion_heuristic",
    actionDomains: ["pricing"],
    maximumActionsPerDecision: 1,
    randomness: { kind: "deterministic" },
  },
  "baseline.promotion.fixed_promotional_calendar": {
    family: "pricing_promotion_heuristic",
    actionDomains: ["promotion"],
    maximumActionsPerDecision: 8,
    randomness: { kind: "deterministic" },
  },

  "baseline.merchandising.rank_by_revenue": {
    family: "merchandising_heuristic",
    actionDomains: ["merchandising"],
    maximumActionsPerDecision: 8,
    randomness: { kind: "deterministic" },
  },
  "baseline.merchandising.rank_by_conversion_rate": {
    family: "merchandising_heuristic",
    actionDomains: ["merchandising"],
    maximumActionsPerDecision: 8,
    randomness: { kind: "deterministic" },
  },
  "baseline.merchandising.rank_by_units_sold": {
    family: "merchandising_heuristic",
    actionDomains: ["merchandising"],
    maximumActionsPerDecision: 8,
    randomness: { kind: "deterministic" },
  },

  "baseline.greedy.immediate_revenue": {
    family: "greedy",
    actionDomains: [
      "advertising",
      "pricing",
      "promotion",
      "merchandising",
      "inventory",
    ],
    maximumActionsPerDecision: 1,
    randomness: { kind: "deterministic" },
  },
  "baseline.greedy.immediate_gross_profit": {
    family: "greedy",
    actionDomains: [
      "advertising",
      "pricing",
      "promotion",
      "merchandising",
      "inventory",
    ],
    maximumActionsPerDecision: 1,
    randomness: { kind: "deterministic" },
  },
  "baseline.greedy.immediate_contribution": {
    family: "greedy",
    actionDomains: [
      "advertising",
      "pricing",
      "promotion",
      "merchandising",
      "inventory",
    ],
    maximumActionsPerDecision: 1,
    randomness: { kind: "deterministic" },
  },

  "baseline.flawed.max_roas": {
    family: "flawed_optimizer",
    actionDomains: ["advertising"],
    maximumActionsPerDecision: 1,
    randomness: { kind: "deterministic" },
  },
  "baseline.flawed.min_cac": {
    family: "flawed_optimizer",
    actionDomains: ["advertising"],
    maximumActionsPerDecision: 1,
    randomness: { kind: "deterministic" },
  },
  "baseline.flawed.max_revenue": {
    family: "flawed_optimizer",
    actionDomains: [
      "advertising",
      "pricing",
      "promotion",
      "merchandising",
    ],
    maximumActionsPerDecision: 1,
    randomness: { kind: "deterministic" },
  },
  "baseline.flawed.best_seller_push": {
    family: "flawed_optimizer",
    actionDomains: ["promotion", "merchandising"],
    maximumActionsPerDecision: 1,
    randomness: { kind: "deterministic" },
  },
  "baseline.flawed.lowest_cpa": {
    family: "flawed_optimizer",
    actionDomains: ["advertising"],
    maximumActionsPerDecision: 1,
    randomness: { kind: "deterministic" },
  },
  "baseline.flawed.highest_conversion_rate": {
    family: "flawed_optimizer",
    actionDomains: ["promotion", "merchandising"],
    maximumActionsPerDecision: 1,
    randomness: { kind: "deterministic" },
  },
});

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function semver(value: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(value);
}

function finiteJson(value: unknown, path = "$"): void {
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new TypeError(
      "canonical operator output contains non-finite number at " + path,
    );
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      finiteJson(entry, path + "[" + index + "]"),
    );
    return;
  }
  if (!record(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    finiteJson(entry, path + "." + key);
  }
}

function configurationFingerprint(
  operator: CanonicalOperator,
): string {
  const config = operator.metadata.deterministicConfiguration;
  if (
    record(config) &&
    typeof config["configurationFingerprint"] === "string" &&
    config["configurationFingerprint"].trim().length > 0
  ) {
    return config["configurationFingerprint"];
  }
  return operatorFingerprint(config);
}

function descriptorFor(
  operator: CanonicalOperator,
): LegacyOperatorConformanceDescriptor {
  return (
    LEGACY_OPERATOR_CONFORMANCE[operator.metadata.operatorId] ?? {
      family:
        operator.metadata.operatorType === "decision_system"
          ? "advanced_decision_system"
          : "advanced_decision_system",
      actionDomains: ALL_EXECUTABLE_DOMAINS,
      maximumActionsPerDecision: 64,
      randomness: { kind: "deterministic" },
    }
  );
}

function actionSortKey(action: Action): string {
  return [
    String(action.actionType),
    stableOperatorJson(action.target),
    stableOperatorJson(action.parameters),
    String(action.actionId),
  ].join("|");
}

export function canonicalizeActionOrdering(
  actions: readonly Action[],
): readonly Action[] {
  return deepFreezeOperator(
    [...actions].sort((left, right) =>
      actionSortKey(left).localeCompare(actionSortKey(right)),
    ),
  );
}

function assertNoDuplicateOrConflictingActions(
  actions: readonly Action[],
  input: Readonly<CanonicalOperatorInputV2>,
): void {
  const actionIds = new Set<string>();
  const semanticKeys = new Set<string>();
  const targetType = new Map<string, string>();

  for (const action of actions) {
    const id = String(action.actionId);
    if (actionIds.has(id)) {
      throw new TypeError("duplicate Action ID in operator output: " + id);
    }
    actionIds.add(id);

    const semantic = actionSemanticKey(action);
    if (semanticKeys.has(semantic)) {
      throw new TypeError("duplicate semantic Action in operator output");
    }
    semanticKeys.add(semantic);

    const collisionKey =
      String(action.actionType) + "|" + stableOperatorJson(action.target);
    const existingSemantic = targetType.get(collisionKey);
    if (existingSemantic !== undefined && existingSemantic !== semantic) {
      throw new TypeError(
        "conflicting Actions target the same Action type/target in one decision",
      );
    }
    targetType.set(collisionKey, semantic);
  }

  for (const group of input.legalActionSpace.mutualExclusionGroups) {
    const emitted = actions.filter((action) =>
      group.actionTypes.includes(String(action.actionType)),
    );
    if (emitted.length > 1) {
      throw new TypeError(
        "operator output violates mutual exclusion group " + group.groupId,
      );
    }
  }
}

function assertCapabilityConformance(
  metadata: CanonicalOperatorMetadataV2,
  actions: readonly Action[],
): void {
  if (actions.length > metadata.capabilities.maximumActionsPerDecision) {
    throw new TypeError(
      "operator emitted more Actions than its declared capability",
    );
  }
  const allowed = new Set(metadata.capabilities.actionDomains);
  for (const action of actions) {
    const category = String(action.actionCategory);
    if (!allowed.has(category as CoreActionCategory)) {
      throw new TypeError(
        "operator emitted undeclared Action domain " + category,
      );
    }
  }
}

export function validateCanonicalDecisionEnvelope(
  input: Readonly<CanonicalOperatorInputV2>,
  metadata: CanonicalOperatorMetadataV2,
  value: unknown,
): CanonicalOperatorDecisionV2 {
  if (!record(value)) {
    throw new TypeError("canonical operator decision must be an object");
  }
  const allowed = new Set([
    "schemaVersion",
    "actions",
    "operatorMetadata",
    "decisionMetadata",
  ]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new TypeError(
        "canonical operator decision contains unsupported field " + key,
      );
    }
  }

  if (
    value["schemaVersion"] !== CANONICAL_OPERATOR_DECISION_SCHEMA_VERSION
  ) {
    throw new TypeError("unsupported canonical operator decision schema");
  }
  if (!Array.isArray(value["actions"])) {
    throw new TypeError("canonical operator decision actions must be an array");
  }
  if (stableOperatorJson(value["operatorMetadata"]) !== stableOperatorJson(metadata)) {
    throw new TypeError(
      "canonical operator decision metadata differs from operator metadata",
    );
  }
  if (!record(value["decisionMetadata"])) {
    throw new TypeError("canonical decision metadata is required");
  }

  finiteJson(value);

  const actions = (value["actions"] as unknown[]).map((entry) =>
    assertValidAction(entry as Action),
  );
  const canonicalActions = canonicalizeActionOrdering(actions);

  assertCapabilityConformance(metadata, canonicalActions);
  assertNoDuplicateOrConflictingActions(canonicalActions, input);

  return deepFreezeOperator({
    schemaVersion: CANONICAL_OPERATOR_DECISION_SCHEMA_VERSION,
    actions: canonicalActions,
    operatorMetadata: metadata,
    decisionMetadata:
      value["decisionMetadata"] as unknown as CanonicalOperatorDecisionMetadata,
  });
}

export function buildCanonicalOperatorInput(
  contract: BaselineEvaluationContract,
  opportunity: DecisionOpportunity,
  observation: OperatorObservationSnapshot,
  availability: ActionAvailabilitySnapshot,
  legacyInput: OperatorDecisionInput,
): CanonicalOperatorInputV2 {
  const body = {
    schemaVersion: CANONICAL_OPERATOR_INPUT_SCHEMA_VERSION,
    ...legacyInput,
    decisionContext: {
      sequence: opportunity.sequence,
      trigger: opportunity.trigger,
    },
    constraints: {
      dimensions: [...contract.businessConstraints.dimensions],
      evaluationBoundary: contract.businessConstraints.evaluationBoundary,
      invalidActionHandling:
        contract.businessConstraints.invalidActionHandling,
      infeasibleActionHandling:
        contract.businessConstraints.infeasibleActionHandling,
      partialFeasibilityHandling:
        contract.businessConstraints.partialFeasibilityHandling,
      conflictHandling: contract.businessConstraints.conflictHandling,
      silentModificationForbidden:
        contract.businessConstraints.silentModificationForbidden,
    },
    provenance: {
      schemaVersion: CANONICAL_OPERATOR_PROVENANCE_SCHEMA_VERSION,
      evaluationContractFingerprint: contract.contractFingerprint,
      evaluationContractVersion: contract.contractVersion,
      observationFingerprint: observation.observationFingerprint,
      legalActionSpaceFingerprint: availability.availabilityFingerprint,
      actionOntologyVersion: contract.actionSpace.ontologySchemaVersion,
      source: "step3.1-governed-evaluator-adapter" as const,
    },
  };

  return deepFreezeOperator(body);
}

export function canonicalInputFingerprint(
  input: CanonicalOperatorInputV2,
): string {
  return operatorFingerprint(input);
}

function adapterMetadata(
  operator: CanonicalOperator,
): CanonicalOperatorMetadataV2 {
  const descriptor = descriptorFor(operator);
  const configFingerprint = configurationFingerprint(operator);
  const body = {
    schemaVersion: CANONICAL_OPERATOR_METADATA_SCHEMA_VERSION,
    interfaceVersion: CANONICAL_OPERATOR_INTERFACE_VERSION,
    operatorId: operator.metadata.operatorId,
    operatorVersion: operator.metadata.operatorVersion,
    operatorFamily: descriptor.family,
    description: operator.metadata.description,
    implementationFingerprint:
      operator.metadata.implementationFingerprint,
    configurationFingerprint: configFingerprint,
    legacyInterfaceVersion: operator.metadata.interfaceVersion,
    supportedEvaluationContract:
      operator.metadata.supportedEvaluationContract,
    supportedActionOntologyVersion:
      operator.metadata.supportedActionOntologyVersion,
    capabilities: {
      schemaVersion: CANONICAL_OPERATOR_CAPABILITY_SCHEMA_VERSION,
      actionDomains: [...descriptor.actionDomains],
      supportsZeroActions: true as const,
      supportsOneAction: true as const,
      supportsMultipleActions: true as const,
      maximumActionsPerDecision: descriptor.maximumActionsPerDecision,
      randomness: descriptor.randomness,
    },
  };

  return deepFreezeOperator({
    ...body,
    adapterFingerprint: operatorFingerprint({
      canonicalInterfaceVersion: CANONICAL_OPERATOR_INTERFACE_VERSION,
      legacyOperatorId: body.operatorId,
      legacyOperatorVersion: body.operatorVersion,
      legacyImplementationFingerprint: body.implementationFingerprint,
      configurationFingerprint: body.configurationFingerprint,
      family: body.operatorFamily,
      capabilities: body.capabilities,
    }),
  });
}

export function conformLegacyOperator(
  operator: CanonicalOperator,
): CanonicalOperatorV2 {
  const metadata = adapterMetadata(operator);

  if (
    !semver(metadata.operatorVersion) ||
    !semver(metadata.supportedEvaluationContract.contractVersion)
  ) {
    throw new TypeError("operator metadata version must be semantic");
  }
  if (
    metadata.supportedActionOntologyVersion !== ACTION_SCHEMA_VERSION
  ) {
    throw new TypeError(
      "operator Action Ontology version differs from frozen canonical version",
    );
  }

  return deepFreezeOperator({
    metadata,
    decide(
      input: Readonly<CanonicalOperatorInputV2>,
    ): CanonicalOperatorDecisionV2 {
      const legacyOutput = operator.decide(input);
      const canonicalActions = canonicalizeActionOrdering(
        legacyOutput.actions.map((action) => assertValidAction(action)),
      );
      const envelope = {
        schemaVersion: CANONICAL_OPERATOR_DECISION_SCHEMA_VERSION,
        actions: canonicalActions,
        operatorMetadata: metadata,
        decisionMetadata: {
          interfaceVersion: CANONICAL_OPERATOR_INTERFACE_VERSION,
          decisionTimestamp: input.decisionTime,
          deterministicReplayExpected:
            metadata.capabilities.randomness.kind === "deterministic",
          randomness: metadata.capabilities.randomness,
          canonicalActionOrdering:
            "ACTION_TYPE_TARGET_PARAMETERS_ACTION_ID_ASC" as const,
        },
      };
      return validateCanonicalDecisionEnvelope(input, metadata, envelope);
    },
    ...(operator.auditDecision === undefined
      ? {}
      : {
          auditDecision(
            input: Readonly<CanonicalOperatorInputV2>,
            output: Readonly<CanonicalOperatorDecisionV2>,
          ): OperatorDecisionAudit {
            const legacyOutput: OperatorDecisionOutput = {
              actions: output.actions,
            };
            return operator.auditDecision!(input, legacyOutput);
          },
        }),
  });
}

export function assertCanonicalOperatorCompatibleWithContract(
  contract: BaselineEvaluationContract,
  operator: CanonicalOperatorV2,
): void {
  const metadata = operator.metadata;
  if (
    metadata.interfaceVersion !== CANONICAL_OPERATOR_INTERFACE_VERSION
  ) {
    throw new TypeError("operator does not implement canonical v2 interface");
  }
  if (
    metadata.supportedEvaluationContract.contractId !== contract.contractId ||
    metadata.supportedEvaluationContract.contractVersion !==
      contract.contractVersion ||
    metadata.supportedEvaluationContract.contractFingerprint !==
      contract.contractFingerprint
  ) {
    throw new TypeError(
      "canonical operator does not support this frozen evaluation contract",
    );
  }
  if (
    metadata.supportedActionOntologyVersion !==
    contract.actionSpace.ontologySchemaVersion
  ) {
    throw new TypeError(
      "canonical operator does not support this Action Ontology version",
    );
  }
}

export function canonicalOperatorDecisionFingerprint(
  decision: CanonicalOperatorDecisionV2,
): string {
  return operatorFingerprint(decision);
}

export const CANONICAL_OPERATOR_COMPATIBILITY_RULES =
  deepFreezeOperator({
    legacyFrozenOperators:
      "adapt without changing implementation/configuration identity or decision logic",
    nativeV2Operators:
      "must implement the same input/output/metadata/capability schemas",
    breakingChange:
      "requires a new canonical interface version",
    compoundActions:
      "Action[] supported; no new compound execution semantics introduced",
    constraints:
      "evaluator-owned; operator only proposes canonical Actions",
    prohibitedInput:
      "simulator internals, GroundTruth, future outcomes, evaluator-only metrics, latent variables and counterfactuals remain structurally absent",
  });

export const CANONICAL_OPERATOR_INPUT_SCHEMA_FINGERPRINT =
  operatorFingerprint({
    schemaVersion: CANONICAL_OPERATOR_INPUT_SCHEMA_VERSION,
    fields: [
      "opportunityId",
      "decisionTime",
      "observation.records",
      "legalActionSpace.rules",
      "legalActionSpace.mutualExclusionGroups",
      "decisionContext.sequence",
      "decisionContext.trigger",
      "constraints",
      "provenance",
    ],
    forbiddenDirectReferences: [
      "simulator",
      "groundTruth",
      "futureEvents",
      "futureOutcomes",
      "evaluatorMetrics",
      "latentCustomers",
      "counterfactualOutcomes",
    ],
  });

export const CANONICAL_OPERATOR_OUTPUT_SCHEMA_FINGERPRINT =
  operatorFingerprint({
    schemaVersion: CANONICAL_OPERATOR_DECISION_SCHEMA_VERSION,
    fields: [
      "actions",
      "operatorMetadata",
      "decisionMetadata",
    ],
    actionType: "canonical Step 2 Action[]",
    supportsZeroOneMany: true,
  });

export const CANONICAL_OPERATOR_METADATA_SCHEMA_FINGERPRINT =
  operatorFingerprint({
    schemaVersion: CANONICAL_OPERATOR_METADATA_SCHEMA_VERSION,
    fields: [
      "operatorId",
      "operatorVersion",
      "operatorFamily",
      "implementationFingerprint",
      "configurationFingerprint",
      "supportedEvaluationContract",
      "supportedActionOntologyVersion",
      "capabilities",
      "adapterFingerprint",
    ],
  });

export const CANONICAL_OPERATOR_CAPABILITY_SCHEMA_FINGERPRINT =
  operatorFingerprint({
    schemaVersion: CANONICAL_OPERATOR_CAPABILITY_SCHEMA_VERSION,
    semantics: {
      restrictsEmissionDomains: true,
      grantsAdditionalObservationAccess: false,
      supportsZeroOneMany: true,
      randomnessMustBeDeclared: true,
    },
  });

export const CANONICAL_OPERATOR_INTERFACE_SCHEMA_FINGERPRINT =
  operatorFingerprint({
    interfaceVersion: CANONICAL_OPERATOR_INTERFACE_VERSION,
    inputSchemaFingerprint:
      CANONICAL_OPERATOR_INPUT_SCHEMA_FINGERPRINT,
    outputSchemaFingerprint:
      CANONICAL_OPERATOR_OUTPUT_SCHEMA_FINGERPRINT,
    metadataSchemaFingerprint:
      CANONICAL_OPERATOR_METADATA_SCHEMA_FINGERPRINT,
    capabilitySchemaFingerprint:
      CANONICAL_OPERATOR_CAPABILITY_SCHEMA_FINGERPRINT,
    compatibilityRules: CANONICAL_OPERATOR_COMPATIBILITY_RULES,
    frozenStep31Commit: CANONICAL_OPERATOR_FROZEN_STEP_3_1_COMMIT,
    frozenStep39Commit: CANONICAL_OPERATOR_FROZEN_STEP_3_9_COMMIT,
    actionOntologyVersion: ACTION_SCHEMA_VERSION,
  });
