export {
  actionCharacteristicsSchema,
  assertReachableCancellationStages,
  cancellationStageSchema,
  costLineItemSchema,
  deriveReachableCancellationStages,
  irreversibleEffectSchema,
  knownRangeUnknownOrNASchema,
  moneyValueSchema,
  operationalBurdenLineItemSchema,
  operationalQuantitySchema,
  operationalQuantityValueSchema,
  operationalResourceSchema,
  operationalUnitSchema,
  reversalReferenceSchema,
  reversibilitySchema,
  stageCancellationCostSchema,
  stageReachabilityInputSchema,
} from "./schema.js";
export type {
  ActionCharacteristics,
  CancellationStage,
  CostLineItem,
  IrreversibleEffect,
  MoneyValue,
  OperationalBurdenLineItem,
  OperationalQuantity,
  ReversalReference,
  Reversibility,
  StageCancellationCost,
  StageReachabilityInput,
} from "./schema.js";
export { validateActionCharacteristics } from "./validation.js";
export type {
  CharacteristicsValidationContext,
  CharacteristicsValidationResult,
  RegisteredReversalContract,
} from "./validation.js";
export {
  aggregateActionCharacteristics,
  aggregateCompoundCharacteristics,
  aggregateExperimentCharacteristics,
} from "./aggregate.js";
export * from "./legacy.js";
export type {
  CharacteristicAggregateNode,
  CharacteristicAggregationContext,
  CharacteristicsAggregateResult,
  ExperimentCharacteristicsRegistry,
  ExperimentCharacteristicsResult,
  SharedExecutionAlias,
} from "./aggregate.js";
