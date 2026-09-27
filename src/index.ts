// Operator-safe public surface.
// GroundTruth is intentionally NOT exported here. God-mode consumers must use
// the explicit "./ground-truth" or "./evaluation" package subpaths.
export * from "./core/units.js";
export * from "./observation/types.js";
export * from "./observation/operator-boundary.js";
export * from "./action_ontology/index.js";
export * from "./simulator_intervention/index.js";
export * from "./action_translation/index.js";
export * from "./canonical_action/index.js";
export * from "./population/index.js";
export {
  resolveActionTiming,
  validateTimingDependencyGraph,
} from "./action_timing/index.js";
export type {
  ActionTiming as UniversalActionTiming,
  TimingResolution,
} from "./action_timing/types.js";
export * from "./decision_forms/index.js";
export * from "./investigation/index.js";
export * from "./action_constraints/index.js";
export {
  compoundActionSchema,
  assertCompoundAction,
  serializeCompoundAction,
  deserializeCompoundAction,
  fingerprintCompoundAction,
  assessCompoundActionReadiness,
  resolveCompoundTiming,
} from "./compound_action/index.js";
export type { CompoundAction as CanonicalCompoundAction } from "./compound_action/index.js";
