import type { ActionId, ActionProvenance } from "./types.js";

/** Readiness is observed at a point in time; it never mutates the Action. */
export interface InvestigationReadiness {
  readonly actionId: ActionId;
  readonly status: "READY" | "BLOCKED" | "UNKNOWN";
  readonly blockers: readonly (
    "TARGET_NOT_FOUND" | "SOURCE_UNAVAILABLE" | "INSUFFICIENT_PERMISSIONS" |
    "INVALID_OBSERVATION_WINDOW" | "METRIC_UNDEFINED"
  )[];
  readonly checkedAt: string;
}

/** Findings are recorded only after information acquisition. */
export interface InvestigationResult {
  readonly investigationActionId: ActionId;
  readonly status: "RESOLVED" | "PARTIALLY_RESOLVED" | "UNRESOLVED" | "FAILED";
  readonly evidenceCollectedRefs: readonly string[];
  readonly evidenceCoverage: {
    readonly requestedRefs: readonly string[];
    readonly unavailableRefs: readonly string[];
  };
  readonly findings: readonly string[];
  readonly unresolvedQuestions: readonly string[];
  readonly completedAt: string;
  readonly provenance: ActionProvenance;
}
