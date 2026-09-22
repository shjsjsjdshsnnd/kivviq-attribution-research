import {
  ACTION_SCHEMA_VERSION,
  type Action,
  type ActionTarget,
} from "../action_ontology/types.js";
import {
  CORE_ACTION_TYPE_CONTRACTS,
  CORE_CONSTRAINT_PROPERTIES,
} from "../action_ontology/registry.js";
import { actionFingerprint } from "../action_ontology/semantics.js";
import { assertValidAction } from "../action_ontology/validation.js";
import { assertNoLatentLeakage } from "../observation/operator-boundary.js";

export const BASELINE_EVALUATION_CONTRACT_SCHEMA_VERSION = "1.0.0" as const;
export const BASELINE_METRIC_SET_VERSION = "1.0.0" as const;
export const EVALUATION_ARTIFACT_SCHEMA_VERSION = "1.0.0" as const;

const SEMVER = /^\d+\.\d+\.\d+$/;
const ONE_DAY_SECONDS = 24 * 60 * 60;

export class BaselineEvaluationContractError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "BaselineEvaluationContractError";
  }
}

function requireCondition(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) throw new BaselineEvaluationContractError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}

export function stableEvaluationJson(value: unknown): string {
  try {
    const serialized = JSON.stringify(canonicalize(value));
    if (serialized === undefined) {
      throw new TypeError("value is not JSON serializable");
    }
    return serialized;
  } catch (error) {
    throw new BaselineEvaluationContractError(
      "evaluation values must be deterministic JSON: " +
        (error instanceof Error ? error.message : String(error)),
    );
  }
}

/**
 * Deterministic FNV-1a 64-bit fingerprint.
 * This is a reproducibility fingerprint, not a security primitive.
 */
export function evaluationFingerprint(value: unknown): string {
  const input = stableEvaluationJson(value);
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= BigInt(input.charCodeAt(index));
    hash = (hash * prime) & mask;
  }

  return "fnv1a64:" + hash.toString(16).padStart(16, "0");
}

export function deepFreezeEvaluation<T>(value: T): T {
  if (
    typeof value !== "object" ||
    value === null ||
    Object.isFrozen(value)
  ) {
    return value;
  }

  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreezeEvaluation(child);
  }
  return value;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(stableEvaluationJson(value)) as T;
}

function parseTime(value: string, label: string): number {
  const parsed = Date.parse(value);
  requireCondition(Number.isFinite(parsed), label + " must be ISO-8601");
  return parsed;
}

function unique(values: readonly string[], label: string): void {
  requireCondition(
    new Set(values).size === values.length,
    label + " must not contain duplicates",
  );
}

export type ObservationInformationClass =
  | "observable_merchant_data"
  | "derived_observable_metric"
  | "historical_information"
  | "current_state_information"
  | "simulator_latent_state"
  | "future_information"
  | "evaluator_only_metric";

export interface ObservationContract {
  readonly permittedClasses: readonly ObservationInformationClass[];
  readonly forbiddenClasses: readonly ObservationInformationClass[];
  readonly maxHistorySeconds: number;
  readonly requireAvailableAtOrBeforeDecision: true;
  readonly failClosedOnUnknownClass: true;
  readonly unrestrictedMetadataForbidden: true;
}

export type DecisionCadence =
  | {
      readonly kind: "fixed_interval";
      readonly anchor: "intervention_start";
      readonly intervalSeconds: number;
    }
  | {
      readonly kind: "simulation_ticks";
      readonly everyTicks: number;
    }
  | {
      readonly kind: "event_triggered";
      readonly eventTypes: readonly string[];
    };

export interface ActionSpaceRule {
  readonly actionType: string;
  readonly category: string;
  readonly allowedTargetKinds: readonly ActionTarget["kind"][];
  readonly parameterKind: string;
}

export interface ActionSpaceContract {
  readonly source: "canonical_action_ontology";
  readonly ontologySchemaVersion: string;
  readonly rules: readonly ActionSpaceRule[];
  readonly availabilityBoundPerDecision: true;
  readonly unlistedActionsRejected: true;
  readonly canonicalValidationRequired: true;
}

export interface BusinessConstraintContract {
  readonly dimensions: readonly string[];
  readonly evaluationBoundary: "decision_time";
  readonly invalidActionHandling: "reject";
  readonly infeasibleActionHandling: "reject";
  readonly partialFeasibilityHandling: "require_explicit_modified_action";
  readonly conflictHandling: "reject";
  readonly recordRejectedAndModifiedActions: true;
  readonly silentModificationForbidden: true;
}

export type SimulationWorldComponent =
  | "merchant_characteristics"
  | "products"
  | "customers"
  | "latent_customer_properties"
  | "customer_journeys"
  | "demand"
  | "advertising_economics"
  | "cross_channel_interactions"
  | "inventory"
  | "pricing"
  | "retention"
  | "seasonality"
  | "external_events";

export interface SimulationWorldSpecification {
  readonly worldSetId: string;
  readonly specificationVersion: string;
  readonly requiredComponents: readonly SimulationWorldComponent[];
  readonly worldIdRequired: true;
  readonly worldFingerprintRequired: true;
  readonly materiallyDifferentWorldsForbiddenWithinComparison: true;
}

export type SeedNamespace =
  | "world_generation"
  | "customer_generation"
  | "customer_behavior"
  | "demand"
  | "advertising_response"
  | "journey_transitions"
  | "external_events"
  | "operator_internal";

export interface SeedNamespacePolicy {
  readonly namespace: SeedNamespace;
  readonly sharing:
    | "shared_across_operators"
    | "operator_specific";
}

export interface RandomSeedPolicy {
  readonly commonRandomNumbers: true;
  readonly namespaces: readonly SeedNamespacePolicy[];
  readonly recordAllSeeds: true;
  readonly trajectoriesMayDivergeAfterIntervention: true;
}

export interface EvaluationHorizon {
  readonly warmUpSeconds: number;
  readonly historySeconds: number;
  readonly interventionSeconds: number;
  readonly outcomeMeasurementSeconds: number;
  readonly delayedEffectSeconds: number;
  readonly measurementBegins: "intervention_start";
  readonly delayedEffectsIncluded: true;
}

export type MetricUnit =
  | "money_minor"
  | "count"
  | "units"
  | "ratio"
  | "probability"
  | "days";

export type MetricAggregation =
  | "sum"
  | "mean"
  | "ratio"
  | "last"
  | "cohort_sum";

export type MetricWindow =
  | "intervention"
  | "outcome_measurement"
  | "outcome_plus_delayed_effect";

export interface OutcomeMetricDefinition {
  readonly metricId: string;
  readonly label: string;
  readonly formula: string;
  readonly population: string;
  readonly window: MetricWindow;
  readonly unit: MetricUnit;
  readonly aggregation: MetricAggregation;
  readonly currency:
    | "contract_currency"
    | "not_applicable";
  readonly visibility:
    | "operator_observable_if_separately_permitted"
    | "evaluator_only";
}

export interface EvaluationValidityRequirements {
  readonly identicalObservations: true;
  readonly identicalDecisionOpportunities: true;
  readonly identicalActionSpace: true;
  readonly identicalBusinessConstraints: true;
  readonly identicalWorldSpecification: true;
  readonly identicalSharedSeeds: true;
  readonly identicalEvaluationHorizons: true;
  readonly identicalMetricDefinitions: true;
  readonly operatorEvaluatorKnowledgeSeparated: true;
  readonly hiddenStateAccessForbidden: true;
  readonly futureDataAccessForbidden: true;
  readonly seedSpecificHardcodingForbidden: true;
  readonly benchmarkWorldSpecialCasingForbidden: true;
  readonly evaluatorMetricAccessForbidden: true;
  readonly contractMutationForbidden: true;
  readonly failClosedOnBoundaryFailure: true;
}

export interface EvaluationContractProvenance {
  readonly definitionId: "step3.1-baseline-evaluation-contract";
  readonly actionOntologySchemaVersion: string;
  readonly metricSetVersion: typeof BASELINE_METRIC_SET_VERSION;
  readonly simulatorVersionBinding: "required_per_evaluation_run";
  readonly sourceSpecRef: "Step 3.1";
}

export interface BaselineEvaluationContract {
  readonly kind: "baseline_evaluation_contract";
  readonly schemaVersion: typeof BASELINE_EVALUATION_CONTRACT_SCHEMA_VERSION;
  readonly contractId: string;
  readonly contractVersion: string;
  readonly observation: ObservationContract;
  readonly cadence: DecisionCadence;
  readonly actionSpace: ActionSpaceContract;
  readonly businessConstraints: BusinessConstraintContract;
  readonly world: SimulationWorldSpecification;
  readonly seedPolicy: RandomSeedPolicy;
  readonly horizon: EvaluationHorizon;
  readonly metrics: readonly OutcomeMetricDefinition[];
  readonly validity: EvaluationValidityRequirements;
  readonly provenance: EvaluationContractProvenance;
  readonly contractFingerprint: string;
}

export type BaselineEvaluationContractBody = Omit<
  BaselineEvaluationContract,
  "contractFingerprint"
>;

export interface BaselineEvaluationContractInput {
  readonly contractId: string;
  readonly contractVersion: string;
  readonly observation: ObservationContract;
  readonly cadence: DecisionCadence;
  readonly actionSpace: ActionSpaceContract;
  readonly businessConstraints: BusinessConstraintContract;
  readonly world: SimulationWorldSpecification;
  readonly seedPolicy: RandomSeedPolicy;
  readonly horizon: EvaluationHorizon;
  readonly metrics: readonly OutcomeMetricDefinition[];
  readonly validity: EvaluationValidityRequirements;
  readonly provenance: EvaluationContractProvenance;
}

const REQUIRED_METRICS = [
  "revenue",
  "gross_profit",
  "contribution_profit",
  "orders",
  "units_sold",
  "aov",
  "cac",
  "roas",
  "advertising_spend",
  "new_customers",
  "repeat_customers",
  "retention",
  "clv",
  "inventory_remaining",
  "stockouts",
  "lost_demand",
  "returns",
  "discount_cost",
  "shipping_cost",
  "action_cost",
] as const;

const REQUIRED_WORLD_COMPONENTS: readonly SimulationWorldComponent[] = [
  "merchant_characteristics",
  "products",
  "customers",
  "latent_customer_properties",
  "customer_journeys",
  "demand",
  "advertising_economics",
  "cross_channel_interactions",
  "inventory",
  "pricing",
  "retention",
  "seasonality",
  "external_events",
];

const REQUIRED_SHARED_SEED_NAMESPACES: readonly SeedNamespace[] = [
  "world_generation",
  "customer_generation",
  "customer_behavior",
  "demand",
  "advertising_response",
  "journey_transitions",
  "external_events",
];

export const CANONICAL_OUTCOME_METRICS_V1: readonly OutcomeMetricDefinition[] =
  deepFreezeEvaluation([
    {
      metricId: "revenue",
      label: "Net revenue",
      formula: "sum(realized_order.net_revenue_minor)",
      population: "all realized merchant orders",
      window: "outcome_measurement",
      unit: "money_minor",
      aggregation: "sum",
      currency: "contract_currency",
      visibility: "operator_observable_if_separately_permitted",
    },
    {
      metricId: "gross_profit",
      label: "Gross profit",
      formula: "sum(net_revenue_minor - estimated_cogs_minor)",
      population: "all realized merchant orders",
      window: "outcome_measurement",
      unit: "money_minor",
      aggregation: "sum",
      currency: "contract_currency",
      visibility: "operator_observable_if_separately_permitted",
    },
    {
      metricId: "contribution_profit",
      label: "Contribution profit",
      formula:
        "sum(net_revenue_minor - estimated_cogs_minor - fulfillment_minor - payment_fee_minor - shipping_subsidy_minor - allocated_marketing_spend_minor)",
      population: "all realized merchant orders",
      window: "outcome_measurement",
      unit: "money_minor",
      aggregation: "sum",
      currency: "contract_currency",
      visibility: "operator_observable_if_separately_permitted",
    },
    {
      metricId: "orders",
      label: "Orders",
      formula: "count(realized_order)",
      population: "all realized merchant orders",
      window: "outcome_measurement",
      unit: "count",
      aggregation: "sum",
      currency: "not_applicable",
      visibility: "operator_observable_if_separately_permitted",
    },
    {
      metricId: "units_sold",
      label: "Units sold",
      formula: "sum(realized_order_line.quantity)",
      population: "all realized merchant order lines",
      window: "outcome_measurement",
      unit: "units",
      aggregation: "sum",
      currency: "not_applicable",
      visibility: "operator_observable_if_separately_permitted",
    },
    {
      metricId: "aov",
      label: "Average order value",
      formula: "revenue / orders; null when orders = 0",
      population: "all realized merchant orders",
      window: "outcome_measurement",
      unit: "money_minor",
      aggregation: "ratio",
      currency: "contract_currency",
      visibility: "operator_observable_if_separately_permitted",
    },
    {
      metricId: "cac",
      label: "Customer acquisition cost",
      formula: "acquisition_advertising_spend_minor / new_customers; null when new_customers = 0",
      population: "customers whose first realized purchase occurs in the scoring window",
      window: "outcome_measurement",
      unit: "money_minor",
      aggregation: "ratio",
      currency: "contract_currency",
      visibility: "operator_observable_if_separately_permitted",
    },
    {
      metricId: "roas",
      label: "Revenue return on advertising spend",
      formula: "revenue / advertising_spend; null when advertising_spend = 0",
      population: "merchant outcome window",
      window: "outcome_measurement",
      unit: "ratio",
      aggregation: "ratio",
      currency: "not_applicable",
      visibility: "operator_observable_if_separately_permitted",
    },
    {
      metricId: "advertising_spend",
      label: "Advertising spend",
      formula: "sum(realized_advertising_spend_minor)",
      population: "all paid-media delivery",
      window: "outcome_measurement",
      unit: "money_minor",
      aggregation: "sum",
      currency: "contract_currency",
      visibility: "operator_observable_if_separately_permitted",
    },
    {
      metricId: "new_customers",
      label: "New customers",
      formula: "count_distinct(customer with first realized purchase in window)",
      population: "customers with a realized purchase",
      window: "outcome_measurement",
      unit: "count",
      aggregation: "sum",
      currency: "not_applicable",
      visibility: "operator_observable_if_separately_permitted",
    },
    {
      metricId: "repeat_customers",
      label: "Repeat customers",
      formula: "count_distinct(customer with prior realized purchase before current purchase)",
      population: "customers with a realized purchase",
      window: "outcome_measurement",
      unit: "count",
      aggregation: "sum",
      currency: "not_applicable",
      visibility: "operator_observable_if_separately_permitted",
    },
    {
      metricId: "retention",
      label: "Customer retention",
      formula: "repeat_customers / customers_eligible_to_repeat; null when denominator = 0",
      population: "customers eligible for repeat purchase under the frozen retention definition",
      window: "outcome_plus_delayed_effect",
      unit: "probability",
      aggregation: "ratio",
      currency: "not_applicable",
      visibility: "operator_observable_if_separately_permitted",
    },
    {
      metricId: "clv",
      label: "Realized cohort customer lifetime value",
      formula: "sum(cohort_contribution_profit_minor) / acquired_customers; null when acquired_customers = 0",
      population: "customers first acquired during intervention",
      window: "outcome_plus_delayed_effect",
      unit: "money_minor",
      aggregation: "cohort_sum",
      currency: "contract_currency",
      visibility: "operator_observable_if_separately_permitted",
    },
    {
      metricId: "inventory_remaining",
      label: "Inventory remaining",
      formula: "sum(available_to_sell_units at measurement end)",
      population: "all benchmark SKUs and locations",
      window: "outcome_measurement",
      unit: "units",
      aggregation: "last",
      currency: "not_applicable",
      visibility: "operator_observable_if_separately_permitted",
    },
    {
      metricId: "stockouts",
      label: "Stockout events",
      formula: "count(stockout_transition)",
      population: "all benchmark SKUs and locations",
      window: "outcome_measurement",
      unit: "count",
      aggregation: "sum",
      currency: "not_applicable",
      visibility: "operator_observable_if_separately_permitted",
    },
    {
      metricId: "lost_demand",
      label: "Lost demand",
      formula: "sum(latent_requested_units that become permanent unfulfilled demand)",
      population: "all latent demand attempts",
      window: "outcome_measurement",
      unit: "units",
      aggregation: "sum",
      currency: "not_applicable",
      visibility: "evaluator_only",
    },
    {
      metricId: "returns",
      label: "Returned units",
      formula: "sum(realized_return.quantity)",
      population: "fulfilled merchandise eligible to return",
      window: "outcome_plus_delayed_effect",
      unit: "units",
      aggregation: "sum",
      currency: "not_applicable",
      visibility: "operator_observable_if_separately_permitted",
    },
    {
      metricId: "discount_cost",
      label: "Discount cost",
      formula: "sum(realized_order_line.discount_minor)",
      population: "all realized merchant order lines",
      window: "outcome_measurement",
      unit: "money_minor",
      aggregation: "sum",
      currency: "contract_currency",
      visibility: "operator_observable_if_separately_permitted",
    },
    {
      metricId: "shipping_cost",
      label: "Merchant shipping and fulfillment cost",
      formula: "sum(fulfillment_minor + shipping_subsidy_minor)",
      population: "all realized merchant orders",
      window: "outcome_measurement",
      unit: "money_minor",
      aggregation: "sum",
      currency: "contract_currency",
      visibility: "operator_observable_if_separately_permitted",
    },
    {
      metricId: "action_cost",
      label: "Action and intervention cost",
      formula: "sum(realized direct implementation, operational, promotional and incremental action costs)",
      population: "all executed actions",
      window: "outcome_plus_delayed_effect",
      unit: "money_minor",
      aggregation: "sum",
      currency: "contract_currency",
      visibility: "operator_observable_if_separately_permitted",
    },
    {
      metricId: "true_incremental_profit",
      label: "True incremental contribution profit",
      formula: "factual contribution profit - shared-randomness no-action counterfactual contribution profit",
      population: "evaluator counterfactual comparison",
      window: "outcome_plus_delayed_effect",
      unit: "money_minor",
      aggregation: "sum",
      currency: "contract_currency",
      visibility: "evaluator_only",
    },
    {
      metricId: "causal_lift",
      label: "True causal lift",
      formula: "factual outcome - matched shared-randomness counterfactual outcome",
      population: "evaluator counterfactual comparison",
      window: "outcome_plus_delayed_effect",
      unit: "ratio",
      aggregation: "ratio",
      currency: "not_applicable",
      visibility: "evaluator_only",
    },
    {
      metricId: "counterfactual_regret",
      label: "Counterfactual regret",
      formula: "oracle-feasible outcome - realized operator outcome under identical contract",
      population: "evaluator-only feasible action comparison",
      window: "outcome_plus_delayed_effect",
      unit: "money_minor",
      aggregation: "sum",
      currency: "contract_currency",
      visibility: "evaluator_only",
    },
  ] satisfies readonly OutcomeMetricDefinition[]);

export function createCanonicalActionSpaceContract(): ActionSpaceContract {
  const rules = CORE_ACTION_TYPE_CONTRACTS.map((rule) => ({
    actionType: rule.actionType,
    category: String(rule.category),
    allowedTargetKinds: [...rule.allowedTargetKinds].sort(),
    parameterKind: rule.parameterKind,
  })).sort((left, right) => left.actionType.localeCompare(right.actionType));

  return deepFreezeEvaluation({
    source: "canonical_action_ontology",
    ontologySchemaVersion: ACTION_SCHEMA_VERSION,
    rules,
    availabilityBoundPerDecision: true,
    unlistedActionsRejected: true,
    canonicalValidationRequired: true,
  });
}

export function createCanonicalBusinessConstraintContract(): BusinessConstraintContract {
  const dimensions = [
    ...new Set([
      ...CORE_CONSTRAINT_PROPERTIES,
      "cash.available_minor",
      "inventory.reorder_limit_units",
      "pricing.minimum_minor",
      "pricing.maximum_minor",
      "channel.restriction",
      "campaign.eligibility",
      "sku.availability",
    ]),
  ].sort();

  return deepFreezeEvaluation({
    dimensions,
    evaluationBoundary: "decision_time",
    invalidActionHandling: "reject",
    infeasibleActionHandling: "reject",
    partialFeasibilityHandling: "require_explicit_modified_action",
    conflictHandling: "reject",
    recordRejectedAndModifiedActions: true,
    silentModificationForbidden: true,
  });
}

function validateContractBody(
  contract: BaselineEvaluationContractBody,
): void {
  requireCondition(
    contract.kind === "baseline_evaluation_contract",
    "contract kind must be baseline_evaluation_contract",
  );
  requireCondition(
    contract.schemaVersion === BASELINE_EVALUATION_CONTRACT_SCHEMA_VERSION,
    "unsupported baseline evaluation contract schema",
  );
  requireCondition(contract.contractId.trim().length > 0, "contractId is required");
  requireCondition(
    SEMVER.test(contract.contractVersion),
    "contractVersion must be semantic x.y.z",
  );

  unique(
    contract.observation.permittedClasses,
    "observation permittedClasses",
  );
  unique(
    contract.observation.forbiddenClasses,
    "observation forbiddenClasses",
  );
  requireCondition(
    contract.observation.maxHistorySeconds >= 0 &&
      Number.isFinite(contract.observation.maxHistorySeconds),
    "maxHistorySeconds must be finite and non-negative",
  );
  for (const forbidden of [
    "simulator_latent_state",
    "future_information",
    "evaluator_only_metric",
  ] satisfies readonly ObservationInformationClass[]) {
    requireCondition(
      contract.observation.forbiddenClasses.includes(forbidden),
      "observation contract must forbid " + forbidden,
    );
  }
  for (const informationClass of contract.observation.permittedClasses) {
    requireCondition(
      !contract.observation.forbiddenClasses.includes(informationClass),
      "observation class cannot be both permitted and forbidden: " +
        informationClass,
    );
  }

  if (contract.cadence.kind === "fixed_interval") {
    requireCondition(
      Number.isInteger(contract.cadence.intervalSeconds) &&
        contract.cadence.intervalSeconds > 0,
      "fixed decision interval must be an integer > 0",
    );
  } else if (contract.cadence.kind === "simulation_ticks") {
    requireCondition(
      Number.isInteger(contract.cadence.everyTicks) &&
        contract.cadence.everyTicks > 0,
      "simulation tick cadence must be an integer > 0",
    );
  } else {
    requireCondition(
      contract.cadence.eventTypes.length > 0,
      "event-triggered cadence requires at least one event type",
    );
    unique(contract.cadence.eventTypes, "decision eventTypes");
  }

  requireCondition(
    contract.actionSpace.rules.length > 0,
    "action space must contain at least one rule",
  );
  unique(
    contract.actionSpace.rules.map((rule) => rule.actionType),
    "action-space action types",
  );
  for (const rule of contract.actionSpace.rules) {
    requireCondition(rule.actionType.trim().length > 0, "actionType is required");
    requireCondition(
      rule.allowedTargetKinds.length > 0,
      "action-space rule requires at least one target kind",
    );
    unique(rule.allowedTargetKinds, "allowed target kinds for " + rule.actionType);
  }

  requireCondition(
    contract.businessConstraints.dimensions.length > 0,
    "business constraints must declare dimensions",
  );
  unique(
    contract.businessConstraints.dimensions,
    "business constraint dimensions",
  );

  requireCondition(
    contract.world.worldSetId.trim().length > 0,
    "worldSetId is required",
  );
  requireCondition(
    SEMVER.test(contract.world.specificationVersion),
    "world specificationVersion must be semantic x.y.z",
  );
  unique(contract.world.requiredComponents, "world required components");
  for (const required of REQUIRED_WORLD_COMPONENTS) {
    requireCondition(
      contract.world.requiredComponents.includes(required),
      "world specification must include " + required,
    );
  }

  const namespaces = contract.seedPolicy.namespaces.map(
    (entry) => entry.namespace,
  );
  unique(namespaces, "seed namespaces");
  for (const required of REQUIRED_SHARED_SEED_NAMESPACES) {
    const policy = contract.seedPolicy.namespaces.find(
      (entry) => entry.namespace === required,
    );
    requireCondition(
      policy?.sharing === "shared_across_operators",
      required + " seed must be shared across operators",
    );
  }
  const operatorSeed = contract.seedPolicy.namespaces.find(
    (entry) => entry.namespace === "operator_internal",
  );
  requireCondition(
    operatorSeed?.sharing === "operator_specific",
    "operator_internal seed must be operator-specific",
  );

  for (const [label, value] of Object.entries({
    warmUpSeconds: contract.horizon.warmUpSeconds,
    historySeconds: contract.horizon.historySeconds,
    interventionSeconds: contract.horizon.interventionSeconds,
    outcomeMeasurementSeconds: contract.horizon.outcomeMeasurementSeconds,
    delayedEffectSeconds: contract.horizon.delayedEffectSeconds,
  })) {
    requireCondition(
      Number.isInteger(value) && value >= 0,
      label + " must be a non-negative integer",
    );
  }
  requireCondition(
    contract.horizon.interventionSeconds > 0,
    "intervention horizon must be > 0",
  );
  requireCondition(
    contract.horizon.outcomeMeasurementSeconds > 0,
    "outcome measurement horizon must be > 0",
  );

  unique(
    contract.metrics.map((metric) => metric.metricId),
    "metric IDs",
  );
  for (const required of REQUIRED_METRICS) {
    requireCondition(
      contract.metrics.some((metric) => metric.metricId === required),
      "canonical metric set is missing " + required,
    );
  }
  for (const metric of contract.metrics) {
    requireCondition(metric.formula.trim().length > 0, "metric formula is required");
    requireCondition(metric.population.trim().length > 0, "metric population is required");
  }

  requireCondition(
    contract.validity.identicalObservations &&
      contract.validity.identicalDecisionOpportunities &&
      contract.validity.identicalActionSpace &&
      contract.validity.identicalBusinessConstraints &&
      contract.validity.identicalWorldSpecification &&
      contract.validity.identicalSharedSeeds &&
      contract.validity.identicalEvaluationHorizons &&
      contract.validity.identicalMetricDefinitions &&
      contract.validity.operatorEvaluatorKnowledgeSeparated &&
      contract.validity.hiddenStateAccessForbidden &&
      contract.validity.futureDataAccessForbidden &&
      contract.validity.seedSpecificHardcodingForbidden &&
      contract.validity.benchmarkWorldSpecialCasingForbidden &&
      contract.validity.evaluatorMetricAccessForbidden &&
      contract.validity.contractMutationForbidden &&
      contract.validity.failClosedOnBoundaryFailure,
    "all comparison validity requirements must fail closed",
  );

  requireCondition(
    contract.provenance.actionOntologySchemaVersion ===
      contract.actionSpace.ontologySchemaVersion,
    "provenance Action ontology version must match action-space contract",
  );
  requireCondition(
    contract.provenance.metricSetVersion === BASELINE_METRIC_SET_VERSION,
    "metric set version must match the frozen Step 3.1 metric set",
  );
}

export function createBaselineEvaluationContract(
  input: BaselineEvaluationContractInput,
): BaselineEvaluationContract {
  const body: BaselineEvaluationContractBody = {
    kind: "baseline_evaluation_contract",
    schemaVersion: BASELINE_EVALUATION_CONTRACT_SCHEMA_VERSION,
    contractId: input.contractId,
    contractVersion: input.contractVersion,
    observation: input.observation,
    cadence: input.cadence,
    actionSpace: input.actionSpace,
    businessConstraints: input.businessConstraints,
    world: input.world,
    seedPolicy: input.seedPolicy,
    horizon: input.horizon,
    metrics: input.metrics,
    validity: input.validity,
    provenance: input.provenance,
  };
  validateContractBody(body);

  const frozen = deepFreezeEvaluation({
    ...cloneJson(body),
    contractFingerprint: evaluationFingerprint(body),
  });

  return frozen;
}

export function assertValidBaselineEvaluationContract(
  input: unknown,
): BaselineEvaluationContract {
  requireCondition(isRecord(input), "evaluation contract must be an object");

  const allowedKeys = new Set([
    "kind",
    "schemaVersion",
    "contractId",
    "contractVersion",
    "observation",
    "cadence",
    "actionSpace",
    "businessConstraints",
    "world",
    "seedPolicy",
    "horizon",
    "metrics",
    "validity",
    "provenance",
    "contractFingerprint",
  ]);
  for (const key of Object.keys(input)) {
    requireCondition(
      allowedKeys.has(key),
      "unknown evaluation contract field: " + key,
    );
  }

  const candidate = input as unknown as BaselineEvaluationContract;
  const {
    contractFingerprint,
    ...body
  } = candidate;
  validateContractBody(body);
  requireCondition(
    contractFingerprint === evaluationFingerprint(body),
    "evaluation contract fingerprint mismatch",
  );

  return deepFreezeEvaluation(candidate);
}

export const CANONICAL_BASELINE_EVALUATION_CONTRACT_V1 =
  createBaselineEvaluationContract({
    contractId: "kivviq.baseline-evaluation",
    contractVersion: "1.0.0",
    observation: {
      permittedClasses: [
        "observable_merchant_data",
        "derived_observable_metric",
        "historical_information",
        "current_state_information",
      ],
      forbiddenClasses: [
        "simulator_latent_state",
        "future_information",
        "evaluator_only_metric",
      ],
      maxHistorySeconds: 90 * ONE_DAY_SECONDS,
      requireAvailableAtOrBeforeDecision: true,
      failClosedOnUnknownClass: true,
      unrestrictedMetadataForbidden: true,
    },
    cadence: {
      kind: "fixed_interval",
      anchor: "intervention_start",
      intervalSeconds: ONE_DAY_SECONDS,
    },
    actionSpace: createCanonicalActionSpaceContract(),
    businessConstraints: createCanonicalBusinessConstraintContract(),
    world: {
      worldSetId: "growth-operator-baseline-world-suite-v1",
      specificationVersion: "1.0.0",
      requiredComponents: REQUIRED_WORLD_COMPONENTS,
      worldIdRequired: true,
      worldFingerprintRequired: true,
      materiallyDifferentWorldsForbiddenWithinComparison: true,
    },
    seedPolicy: {
      commonRandomNumbers: true,
      namespaces: [
        { namespace: "world_generation", sharing: "shared_across_operators" },
        { namespace: "customer_generation", sharing: "shared_across_operators" },
        { namespace: "customer_behavior", sharing: "shared_across_operators" },
        { namespace: "demand", sharing: "shared_across_operators" },
        { namespace: "advertising_response", sharing: "shared_across_operators" },
        { namespace: "journey_transitions", sharing: "shared_across_operators" },
        { namespace: "external_events", sharing: "shared_across_operators" },
        { namespace: "operator_internal", sharing: "operator_specific" },
      ],
      recordAllSeeds: true,
      trajectoriesMayDivergeAfterIntervention: true,
    },
    horizon: {
      warmUpSeconds: 30 * ONE_DAY_SECONDS,
      historySeconds: 90 * ONE_DAY_SECONDS,
      interventionSeconds: 90 * ONE_DAY_SECONDS,
      outcomeMeasurementSeconds: 90 * ONE_DAY_SECONDS,
      delayedEffectSeconds: 30 * ONE_DAY_SECONDS,
      measurementBegins: "intervention_start",
      delayedEffectsIncluded: true,
    },
    metrics: CANONICAL_OUTCOME_METRICS_V1,
    validity: {
      identicalObservations: true,
      identicalDecisionOpportunities: true,
      identicalActionSpace: true,
      identicalBusinessConstraints: true,
      identicalWorldSpecification: true,
      identicalSharedSeeds: true,
      identicalEvaluationHorizons: true,
      identicalMetricDefinitions: true,
      operatorEvaluatorKnowledgeSeparated: true,
      hiddenStateAccessForbidden: true,
      futureDataAccessForbidden: true,
      seedSpecificHardcodingForbidden: true,
      benchmarkWorldSpecialCasingForbidden: true,
      evaluatorMetricAccessForbidden: true,
      contractMutationForbidden: true,
      failClosedOnBoundaryFailure: true,
    },
    provenance: {
      definitionId: "step3.1-baseline-evaluation-contract",
      actionOntologySchemaVersion: ACTION_SCHEMA_VERSION,
      metricSetVersion: BASELINE_METRIC_SET_VERSION,
      simulatorVersionBinding: "required_per_evaluation_run",
      sourceSpecRef: "Step 3.1",
    },
  });

export type DecisionOpportunityTrigger =
  | {
      readonly kind: "fixed_interval";
      readonly intervalIndex: number;
    }
  | {
      readonly kind: "simulation_tick";
      readonly tick: number;
    }
  | {
      readonly kind: "event";
      readonly eventType: string;
      readonly eventId: string;
    };

export interface DecisionOpportunity {
  readonly opportunityId: string;
  readonly sequence: number;
  readonly at: string;
  readonly trigger: DecisionOpportunityTrigger;
}

export function createFixedIntervalDecisionOpportunity(
  contract: BaselineEvaluationContract,
  interventionStart: string,
  sequence: number,
): DecisionOpportunity {
  requireCondition(
    contract.cadence.kind === "fixed_interval",
    "contract does not use fixed-interval cadence",
  );
  requireCondition(
    Number.isInteger(sequence) && sequence >= 0,
    "decision sequence must be a non-negative integer",
  );

  const start = parseTime(interventionStart, "interventionStart");
  const at = new Date(
    start + sequence * contract.cadence.intervalSeconds * 1000,
  ).toISOString();

  return deepFreezeEvaluation({
    opportunityId:
      "decision_" +
      evaluationFingerprint({
        contract: contract.contractFingerprint,
        sequence,
        at,
      }).replace("fnv1a64:", ""),
    sequence,
    at,
    trigger: {
      kind: "fixed_interval",
      intervalIndex: sequence,
    },
  });
}

export function assertDecisionOpportunityAllowed(
  contract: BaselineEvaluationContract,
  opportunity: DecisionOpportunity,
): void {
  parseTime(opportunity.at, "decision opportunity timestamp");
  requireCondition(
    Number.isInteger(opportunity.sequence) && opportunity.sequence >= 0,
    "decision opportunity sequence must be non-negative integer",
  );

  if (contract.cadence.kind === "fixed_interval") {
    requireCondition(
      opportunity.trigger.kind === "fixed_interval",
      "fixed-interval contract requires fixed-interval decision trigger",
    );
    requireCondition(
      opportunity.trigger.intervalIndex === opportunity.sequence,
      "fixed-interval trigger index must equal decision sequence",
    );
    return;
  }

  if (contract.cadence.kind === "simulation_ticks") {
    requireCondition(
      opportunity.trigger.kind === "simulation_tick",
      "simulation-tick contract requires tick trigger",
    );
    requireCondition(
      opportunity.trigger.tick % contract.cadence.everyTicks === 0,
      "decision tick is not permitted by cadence",
    );
    return;
  }

  requireCondition(
    opportunity.trigger.kind === "event",
    "event-triggered contract requires event trigger",
  );
  requireCondition(
    contract.cadence.eventTypes.includes(opportunity.trigger.eventType),
    "event type is not permitted by cadence",
  );
}

export interface EvaluationObservationDatum {
  readonly observationKey: string;
  readonly informationClass: ObservationInformationClass;
  readonly availableAt: string;
  readonly sourceRef: string;
  readonly value: unknown;
}

export interface OperatorObservationSnapshot {
  readonly opportunityId: string;
  readonly decisionTime: string;
  readonly records: readonly EvaluationObservationDatum[];
  readonly observationFingerprint: string;
}

export function buildOperatorObservationSnapshot(
  contract: BaselineEvaluationContract,
  opportunity: DecisionOpportunity,
  records: readonly EvaluationObservationDatum[],
): OperatorObservationSnapshot {
  assertDecisionOpportunityAllowed(contract, opportunity);
  const decisionMs = parseTime(opportunity.at, "decision time");

  const checked = records.map((record) => {
    requireCondition(
      record.observationKey.trim().length > 0,
      "observationKey is required",
    );
    requireCondition(record.sourceRef.trim().length > 0, "sourceRef is required");
    requireCondition(
      contract.observation.permittedClasses.includes(record.informationClass),
      "observation information class is not permitted: " +
        String(record.informationClass),
    );
    requireCondition(
      !contract.observation.forbiddenClasses.includes(record.informationClass),
      "observation information class is forbidden: " +
        String(record.informationClass),
    );

    const availableMs = parseTime(record.availableAt, "observation availableAt");
    requireCondition(
      availableMs <= decisionMs,
      "future information cannot enter operator observations",
    );
    requireCondition(
      availableMs >=
        decisionMs - contract.observation.maxHistorySeconds * 1000,
      "observation exceeds the permitted history window",
    );

    assertNoLatentLeakage(record.value);
    assertNoLatentLeakage(record);

    return cloneJson(record);
  });

  const sorted = checked.sort((left, right) =>
    stableEvaluationJson(left).localeCompare(stableEvaluationJson(right)),
  );
  unique(
    sorted.map(
      (record) =>
        record.observationKey +
        "|" +
        record.sourceRef +
        "|" +
        record.availableAt,
    ),
    "operator observation records",
  );

  const body = {
    opportunityId: opportunity.opportunityId,
    decisionTime: opportunity.at,
    records: sorted,
  };
  return deepFreezeEvaluation({
    ...body,
    observationFingerprint: evaluationFingerprint(body),
  });
}

export interface NumericParameterBound {
  readonly path: string;
  readonly minInclusive?: number;
  readonly maxInclusive?: number;
}

export interface ActionAvailabilityRule {
  readonly actionType: string;
  readonly eligibleTargets: readonly ActionTarget[];
  readonly parameterBounds: readonly NumericParameterBound[];
  readonly requiredPreconditionIds: readonly string[];
}

export interface MutualExclusionGroup {
  readonly groupId: string;
  readonly actionTypes: readonly string[];
}

export interface ActionAvailabilitySnapshot {
  readonly opportunityId: string;
  readonly rules: readonly ActionAvailabilityRule[];
  readonly mutualExclusionGroups: readonly MutualExclusionGroup[];
  readonly availabilityFingerprint: string;
}

function targetKey(target: ActionTarget): string {
  return stableEvaluationJson(target);
}

function readNumericPath(
  input: unknown,
  path: string,
): number | undefined {
  let current: unknown = input;
  for (const segment of path.split(".")) {
    if (!isRecord(current) || !(segment in current)) return undefined;
    current = current[segment];
  }
  return typeof current === "number" && Number.isFinite(current)
    ? current
    : undefined;
}

export function buildActionAvailabilitySnapshot(
  contract: BaselineEvaluationContract,
  opportunity: DecisionOpportunity,
  rules: readonly ActionAvailabilityRule[],
  mutualExclusionGroups: readonly MutualExclusionGroup[] = [],
): ActionAvailabilitySnapshot {
  assertDecisionOpportunityAllowed(contract, opportunity);
  unique(rules.map((rule) => rule.actionType), "availability action types");

  const checkedRules = rules.map((rule) => {
    const contractRule = contract.actionSpace.rules.find(
      (candidate) => candidate.actionType === rule.actionType,
    );
    requireCondition(
      contractRule !== undefined,
      "availability contains unlisted action type " + rule.actionType,
    );
    requireCondition(
      rule.eligibleTargets.length > 0,
      "availability rule requires at least one eligible target",
    );
    for (const target of rule.eligibleTargets) {
      requireCondition(
        contractRule.allowedTargetKinds.includes(target.kind),
        "target kind " +
          target.kind +
          " is not permitted for " +
          rule.actionType,
      );
    }
    unique(
      rule.eligibleTargets.map(targetKey),
      "eligible targets for " + rule.actionType,
    );
    unique(
      rule.requiredPreconditionIds,
      "required preconditions for " + rule.actionType,
    );
    for (const bound of rule.parameterBounds) {
      requireCondition(bound.path.trim().length > 0, "parameter bound path is required");
      if (bound.minInclusive !== undefined) {
        requireCondition(Number.isFinite(bound.minInclusive), "parameter minimum must be finite");
      }
      if (bound.maxInclusive !== undefined) {
        requireCondition(Number.isFinite(bound.maxInclusive), "parameter maximum must be finite");
      }
      if (
        bound.minInclusive !== undefined &&
        bound.maxInclusive !== undefined
      ) {
        requireCondition(
          bound.minInclusive <= bound.maxInclusive,
          "parameter minimum cannot exceed maximum",
        );
      }
    }
    return cloneJson(rule);
  });

  const checkedGroups = mutualExclusionGroups.map((group) => {
    requireCondition(group.groupId.trim().length > 0, "mutual exclusion groupId is required");
    requireCondition(group.actionTypes.length > 1, "mutual exclusion group requires at least two action types");
    unique(group.actionTypes, "mutually exclusive action types");
    for (const actionType of group.actionTypes) {
      requireCondition(
        checkedRules.some((rule) => rule.actionType === actionType),
        "mutually exclusive action type must be available: " + actionType,
      );
    }
    return cloneJson(group);
  });
  unique(checkedGroups.map((group) => group.groupId), "mutual exclusion group IDs");

  const body = {
    opportunityId: opportunity.opportunityId,
    rules: checkedRules.sort((left, right) =>
      left.actionType.localeCompare(right.actionType),
    ),
    mutualExclusionGroups: checkedGroups.sort((left, right) =>
      left.groupId.localeCompare(right.groupId),
    ),
  };

  return deepFreezeEvaluation({
    ...body,
    availabilityFingerprint: evaluationFingerprint(body),
  });
}

export type ActionSpaceValidationCode =
  | "INVALID_CANONICAL_ACTION"
  | "DECISION_TIME_MISMATCH"
  | "ACTION_TYPE_NOT_IN_CONTRACT"
  | "ACTION_TYPE_NOT_AVAILABLE"
  | "TARGET_KIND_NOT_PERMITTED"
  | "TARGET_NOT_ELIGIBLE"
  | "PARAMETER_KIND_MISMATCH"
  | "PARAMETER_OUT_OF_RANGE"
  | "REQUIRED_PRECONDITION_MISSING"
  | "AVAILABILITY_OPPORTUNITY_MISMATCH";

export type ActionSpaceValidationResult =
  | {
      readonly valid: true;
      readonly action: Action;
      readonly fingerprint: string;
    }
  | {
      readonly valid: false;
      readonly code: ActionSpaceValidationCode;
      readonly reason: string;
    };

function invalidAction(
  code: ActionSpaceValidationCode,
  reason: string,
): ActionSpaceValidationResult {
  return { valid: false, code, reason };
}

export function validateActionAtDecision(
  contract: BaselineEvaluationContract,
  opportunity: DecisionOpportunity,
  availability: ActionAvailabilitySnapshot,
  input: unknown,
): ActionSpaceValidationResult {
  if (availability.opportunityId !== opportunity.opportunityId) {
    return invalidAction(
      "AVAILABILITY_OPPORTUNITY_MISMATCH",
      "availability snapshot belongs to a different decision opportunity",
    );
  }

  let action: Action;
  try {
    action = assertValidAction(input);
  } catch (error) {
    return invalidAction(
      "INVALID_CANONICAL_ACTION",
      error instanceof Error ? error.message : String(error),
    );
  }

  if (String(action.timing.decisionTime) !== opportunity.at) {
    return invalidAction(
      "DECISION_TIME_MISMATCH",
      "Action decisionTime must exactly match the decision opportunity",
    );
  }

  const contractRule = contract.actionSpace.rules.find(
    (rule) => rule.actionType === String(action.actionType),
  );
  if (contractRule === undefined) {
    return invalidAction(
      "ACTION_TYPE_NOT_IN_CONTRACT",
      "Action type is not part of the frozen evaluation contract",
    );
  }

  if (!contractRule.allowedTargetKinds.includes(action.target.kind)) {
    return invalidAction(
      "TARGET_KIND_NOT_PERMITTED",
      "Action target kind is not permitted by the frozen contract",
    );
  }
  if (contractRule.parameterKind !== action.parameters.kind) {
    return invalidAction(
      "PARAMETER_KIND_MISMATCH",
      "Action parameter kind does not match the frozen action-space rule",
    );
  }

  const rule = availability.rules.find(
    (candidate) => candidate.actionType === String(action.actionType),
  );
  if (rule === undefined) {
    return invalidAction(
      "ACTION_TYPE_NOT_AVAILABLE",
      "Action type is not legally available at this decision point",
    );
  }
  if (!rule.eligibleTargets.some((target) => targetKey(target) === targetKey(action.target))) {
    return invalidAction(
      "TARGET_NOT_ELIGIBLE",
      "Action target is not eligible at this decision point",
    );
  }

  for (const requiredPreconditionId of rule.requiredPreconditionIds) {
    if (
      !action.preconditions.some(
        (precondition) =>
          precondition.preconditionId === requiredPreconditionId,
      )
    ) {
      return invalidAction(
        "REQUIRED_PRECONDITION_MISSING",
        "required precondition is absent: " + requiredPreconditionId,
      );
    }
  }

  for (const bound of rule.parameterBounds) {
    const value = readNumericPath(action, bound.path);
    if (value === undefined) {
      return invalidAction(
        "PARAMETER_OUT_OF_RANGE",
        "bounded numeric parameter is missing or non-numeric: " + bound.path,
      );
    }
    if (
      (bound.minInclusive !== undefined && value < bound.minInclusive) ||
      (bound.maxInclusive !== undefined && value > bound.maxInclusive)
    ) {
      return invalidAction(
        "PARAMETER_OUT_OF_RANGE",
        "numeric parameter violates frozen bounds: " + bound.path,
      );
    }
  }

  return {
    valid: true,
    action,
    fingerprint: actionFingerprint(action),
  };
}

export function validateActionBatchAtDecision(
  contract: BaselineEvaluationContract,
  opportunity: DecisionOpportunity,
  availability: ActionAvailabilitySnapshot,
  inputs: readonly unknown[],
): readonly ActionSpaceValidationResult[] {
  const results = inputs.map((input) =>
    validateActionAtDecision(contract, opportunity, availability, input),
  );
  const valid = results.filter(
    (
      result,
    ): result is Extract<ActionSpaceValidationResult, { readonly valid: true }> =>
      result.valid,
  );

  for (const group of availability.mutualExclusionGroups) {
    const matchingIndexes = valid
      .map((result, index) => ({ result, index }))
      .filter(({ result }) =>
        group.actionTypes.includes(String(result.action.actionType)),
      )
      .map(({ index }) => index);

    if (matchingIndexes.length > 1) {
      const invalidFingerprints = new Set(
        matchingIndexes.map((index) => valid[index]!.fingerprint),
      );
      return results.map((result) =>
        result.valid && invalidFingerprints.has(result.fingerprint)
          ? invalidAction(
              "ACTION_TYPE_NOT_AVAILABLE",
              "Action conflicts with mutual exclusion group " + group.groupId,
            )
          : result,
      );
    }
  }

  return results;
}

export type ConstraintIssueKind =
  | "INVALID_ACTION"
  | "INFEASIBLE"
  | "PARTIALLY_FEASIBLE"
  | "CONFLICT";

export interface ConstraintIssue {
  readonly kind: ConstraintIssueKind;
  readonly constraintRef: string;
  readonly reason: string;
}

export type ActionExecutionDisposition =
  | {
      readonly status: "ACCEPTED";
      readonly proposedActionFingerprint: string;
      readonly executedActionFingerprint: string;
      readonly issues: readonly [];
    }
  | {
      readonly status: "REJECTED";
      readonly proposedActionFingerprint: string;
      readonly issues: readonly ConstraintIssue[];
    }
  | {
      readonly status: "MODIFIED";
      readonly proposedActionFingerprint: string;
      readonly executedActionFingerprint: string;
      readonly issues: readonly ConstraintIssue[];
    };

export function resolveActionConstraintAssessment(
  contract: BaselineEvaluationContract,
  proposedAction: Action,
  issues: readonly ConstraintIssue[],
  explicitModifiedAction?: Action,
): ActionExecutionDisposition {
  const proposedFingerprint = actionFingerprint(assertValidAction(proposedAction));

  for (const issue of issues) {
    requireCondition(
      issue.constraintRef.trim().length > 0,
      "constraintRef is required",
    );
    requireCondition(issue.reason.trim().length > 0, "constraint issue reason is required");
  }

  if (issues.length === 0) {
    return deepFreezeEvaluation({
      status: "ACCEPTED",
      proposedActionFingerprint: proposedFingerprint,
      executedActionFingerprint: proposedFingerprint,
      issues: [],
    });
  }

  if (
    issues.some(
      (issue) =>
        issue.kind === "INVALID_ACTION" ||
        issue.kind === "INFEASIBLE" ||
        issue.kind === "CONFLICT",
    )
  ) {
    return deepFreezeEvaluation({
      status: "REJECTED",
      proposedActionFingerprint: proposedFingerprint,
      issues: cloneJson(issues),
    });
  }

  requireCondition(
    issues.every((issue) => issue.kind === "PARTIALLY_FEASIBLE"),
    "unknown constraint issue kind",
  );

  if (explicitModifiedAction === undefined) {
    return deepFreezeEvaluation({
      status: "REJECTED",
      proposedActionFingerprint: proposedFingerprint,
      issues: cloneJson(issues),
    });
  }

  requireCondition(
    contract.businessConstraints.partialFeasibilityHandling ===
      "require_explicit_modified_action",
    "partial feasibility modification is not permitted by contract",
  );
  const modified = assertValidAction(explicitModifiedAction);
  return deepFreezeEvaluation({
    status: "MODIFIED",
    proposedActionFingerprint: proposedFingerprint,
    executedActionFingerprint: actionFingerprint(modified),
    issues: cloneJson(issues),
  });
}

export interface EvaluationSeedValue {
  readonly namespace: SeedNamespace;
  readonly value: number;
  readonly operatorId?: string;
}

export function validateEvaluationSeeds(
  contract: BaselineEvaluationContract,
  seeds: readonly EvaluationSeedValue[],
): readonly EvaluationSeedValue[] {
  unique(
    seeds.map(
      (seed) =>
        seed.namespace +
        "|" +
        (seed.operatorId === undefined ? "shared" : seed.operatorId),
    ),
    "evaluation seed bindings",
  );

  for (const policy of contract.seedPolicy.namespaces) {
    const matches = seeds.filter((seed) => seed.namespace === policy.namespace);
    requireCondition(matches.length > 0, "missing seed namespace " + policy.namespace);
    for (const seed of matches) {
      requireCondition(
        Number.isSafeInteger(seed.value),
        "seed values must be safe integers",
      );
      if (policy.sharing === "shared_across_operators") {
        requireCondition(
          seed.operatorId === undefined,
          policy.namespace + " seed must not be operator-specific",
        );
      } else {
        requireCondition(
          seed.operatorId !== undefined && seed.operatorId.trim().length > 0,
          "operator_internal seeds require operatorId",
        );
      }
    }
  }

  return deepFreezeEvaluation(cloneJson(seeds));
}

export interface EvaluationComparisonBinding {
  readonly contractFingerprint: string;
  readonly worldId: string;
  readonly worldFingerprint: string;
  readonly horizonFingerprint: string;
  readonly metricSetFingerprint: string;
  readonly sharedSeeds: readonly EvaluationSeedValue[];
}

export function createEvaluationComparisonBinding(
  contract: BaselineEvaluationContract,
  worldId: string,
  worldFingerprint: string,
  seeds: readonly EvaluationSeedValue[],
): EvaluationComparisonBinding {
  requireCondition(worldId.trim().length > 0, "worldId is required");
  requireCondition(worldFingerprint.trim().length > 0, "worldFingerprint is required");
  const validatedSeeds = validateEvaluationSeeds(contract, seeds);
  const sharedSeeds = validatedSeeds.filter((seed) => seed.operatorId === undefined);

  return deepFreezeEvaluation({
    contractFingerprint: contract.contractFingerprint,
    worldId,
    worldFingerprint,
    horizonFingerprint: evaluationFingerprint(contract.horizon),
    metricSetFingerprint: evaluationFingerprint(contract.metrics),
    sharedSeeds,
  });
}

export function assertEquivalentComparisonBindings(
  left: EvaluationComparisonBinding,
  right: EvaluationComparisonBinding,
): void {
  requireCondition(
    stableEvaluationJson(left) === stableEvaluationJson(right),
    "operators do not share identical comparison-critical bindings",
  );
}

export interface OperatorIdentity {
  readonly operatorId: string;
  readonly operatorVersion: string;
  readonly operatorFingerprint: string;
}

export interface EvaluationDecisionRecord {
  readonly opportunity: DecisionOpportunity;
  readonly observationFingerprint: string;
  readonly availabilityFingerprint: string;
  readonly proposedActionFingerprints: readonly string[];
  readonly dispositions: readonly ActionExecutionDisposition[];
}

export interface MetricResult {
  readonly metricId: string;
  readonly value: number | null;
}

export interface EvaluationRunArtifact {
  readonly kind: "baseline_evaluation_run";
  readonly schemaVersion: typeof EVALUATION_ARTIFACT_SCHEMA_VERSION;
  readonly evaluationRunId: string;
  readonly contractId: string;
  readonly contractVersion: string;
  readonly contractFingerprint: string;
  readonly operator: OperatorIdentity;
  readonly simulatorVersion: string;
  readonly worldId: string;
  readonly worldFingerprint: string;
  readonly seeds: readonly EvaluationSeedValue[];
  readonly startTime: string;
  readonly endTime: string;
  readonly decisionRecords: readonly EvaluationDecisionRecord[];
  readonly outcomeSummary: Readonly<Record<string, number | string | boolean | null>>;
  readonly metricSetVersion: typeof BASELINE_METRIC_SET_VERSION;
  readonly metricDefinitionFingerprint: string;
  readonly metricResults: readonly MetricResult[];
  readonly artifactFingerprint: string;
}

export interface EvaluationRunArtifactInput {
  readonly operator: OperatorIdentity;
  readonly simulatorVersion: string;
  readonly worldId: string;
  readonly worldFingerprint: string;
  readonly seeds: readonly EvaluationSeedValue[];
  readonly startTime: string;
  readonly endTime: string;
  readonly decisionRecords: readonly EvaluationDecisionRecord[];
  readonly outcomeSummary: Readonly<Record<string, number | string | boolean | null>>;
  readonly metricResults: readonly MetricResult[];
}

export function createEvaluationRunArtifact(
  contract: BaselineEvaluationContract,
  input: EvaluationRunArtifactInput,
): EvaluationRunArtifact {
  assertValidBaselineEvaluationContract(contract);
  requireCondition(input.operator.operatorId.trim().length > 0, "operatorId is required");
  requireCondition(input.operator.operatorVersion.trim().length > 0, "operatorVersion is required");
  requireCondition(input.operator.operatorFingerprint.trim().length > 0, "operatorFingerprint is required");
  requireCondition(input.simulatorVersion.trim().length > 0, "simulatorVersion is required");
  requireCondition(input.worldId.trim().length > 0, "worldId is required");
  requireCondition(input.worldFingerprint.trim().length > 0, "worldFingerprint is required");

  const startMs = parseTime(input.startTime, "evaluation startTime");
  const endMs = parseTime(input.endTime, "evaluation endTime");
  requireCondition(endMs > startMs, "evaluation endTime must be after startTime");

  const seeds = validateEvaluationSeeds(contract, input.seeds);
  unique(
    input.metricResults.map((result) => result.metricId),
    "metric result IDs",
  );
  for (const result of input.metricResults) {
    requireCondition(
      contract.metrics.some((metric) => metric.metricId === result.metricId),
      "metric result is not defined by contract: " + result.metricId,
    );
    requireCondition(
      result.value === null || Number.isFinite(result.value),
      "metric result must be finite or null",
    );
  }

  for (const record of input.decisionRecords) {
    assertDecisionOpportunityAllowed(contract, record.opportunity);
    requireCondition(record.observationFingerprint.trim().length > 0, "decision record observation fingerprint is required");
    requireCondition(record.availabilityFingerprint.trim().length > 0, "decision record availability fingerprint is required");
  }

  const runIdentity = {
    contractFingerprint: contract.contractFingerprint,
    operator: input.operator,
    simulatorVersion: input.simulatorVersion,
    worldId: input.worldId,
    worldFingerprint: input.worldFingerprint,
    seeds,
    startTime: input.startTime,
    endTime: input.endTime,
  };
  const evaluationRunId =
    "eval_" + evaluationFingerprint(runIdentity).replace("fnv1a64:", "");

  const body = {
    kind: "baseline_evaluation_run" as const,
    schemaVersion: EVALUATION_ARTIFACT_SCHEMA_VERSION,
    evaluationRunId,
    contractId: contract.contractId,
    contractVersion: contract.contractVersion,
    contractFingerprint: contract.contractFingerprint,
    operator: cloneJson(input.operator),
    simulatorVersion: input.simulatorVersion,
    worldId: input.worldId,
    worldFingerprint: input.worldFingerprint,
    seeds,
    startTime: input.startTime,
    endTime: input.endTime,
    decisionRecords: cloneJson(input.decisionRecords),
    outcomeSummary: cloneJson(input.outcomeSummary),
    metricSetVersion: BASELINE_METRIC_SET_VERSION,
    metricDefinitionFingerprint: evaluationFingerprint(contract.metrics),
    metricResults: cloneJson(input.metricResults),
  };

  return deepFreezeEvaluation({
    ...body,
    artifactFingerprint: evaluationFingerprint(body),
  });
}
