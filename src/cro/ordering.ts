import type {
  Action,
  CroComponentTarget,
} from "../action_ontology/types.js";
import type {
  CroOrderingResolution,
  CroStructureSnapshot,
} from "./types.js";

export function croStableKey(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(croStableKey).join(",") + "]";
  if (typeof value !== "object" || value === null) return JSON.stringify(value);
  return (
    "{" +
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => JSON.stringify(key) + ":" + croStableKey(entry))
      .join(",") +
    "}"
  );
}

function componentMatches(
  candidate: CroComponentTarget,
  target: CroComponentTarget,
): boolean {
  if (candidate.component !== target.component) return false;
  if (target.instanceId === undefined) return true;
  return candidate.instanceId === target.instanceId;
}

function moveBeforeOrAfter(
  ordered: readonly CroComponentTarget[],
  target: CroComponentTarget,
  reference: CroComponentTarget,
  after: boolean,
): readonly CroComponentTarget[] | undefined {
  const currentIndex = ordered.findIndex((entry) => componentMatches(entry, target));
  const referenceIndexBeforeRemoval = ordered.findIndex((entry) =>
    componentMatches(entry, reference),
  );
  if (currentIndex < 0 || referenceIndexBeforeRemoval < 0) return undefined;

  const next = [...ordered];
  const [moved] = next.splice(currentIndex, 1);
  if (!moved) return undefined;

  const referenceIndex = next.findIndex((entry) => componentMatches(entry, reference));
  if (referenceIndex < 0) return undefined;

  const insertAt = after ? referenceIndex + 1 : referenceIndex;
  next.splice(insertAt, 0, moved);
  return next;
}

export function resolveCroOrdering(
  action: Action,
  snapshots: readonly CroStructureSnapshot[] = [],
): CroOrderingResolution {
  if (
    action.actionType !== "cro.reorder_elements" ||
    action.parameters.kind !== "cro_intervention" ||
    action.parameters.intervention !== "REORDER"
  ) {
    return { status: "INVALID", code: "CRO_POSITION_OUT_OF_RANGE" };
  }

  const parameters = action.parameters;
  const ordering = parameters.ordering;
  if (!ordering) {
    return { status: "INVALID", code: "CRO_POSITION_OUT_OF_RANGE" };
  }
  if (ordering.kind === "SET_POSITION") {
    return ordering.position > 0
      ? { status: "RESOLVED", targetPosition: ordering.position }
      : { status: "INVALID", code: "CRO_POSITION_OUT_OF_RANGE" };
  }

  const matches = snapshots.filter(
    (snapshot) => snapshot.bindingRef === ordering.snapshot.bindingRef,
  );
  if (matches.length !== 1) {
    return {
      status: "MISSING_CONTEXT",
      code: "MISSING_CRO_STRUCTURE_SNAPSHOT",
      missingRef: ordering.snapshot.bindingRef,
    };
  }
  const snapshot = matches[0]!;
  if (
    snapshot.surface !== parameters.surface ||
    croStableKey(snapshot.pageScope) !== croStableKey(parameters.pageScope) ||
    snapshot.device !== parameters.device ||
    snapshot.evaluateAt !== ordering.snapshot.evaluateAt
  ) {
    return {
      status: "MISSING_CONTEXT",
      code: "CRO_STRUCTURE_CONTEXT_MISMATCH",
      missingRef: snapshot.bindingRef,
    };
  }

  const currentIndex = snapshot.orderedComponents.findIndex((entry) =>
    componentMatches(entry, parameters.component),
  );
  if (currentIndex < 0) {
    return {
      status: "MISSING_CONTEXT",
      code: "CRO_COMPONENT_NOT_IN_STRUCTURE",
      missingRef: snapshot.bindingRef,
    };
  }
  const referenceIndex = snapshot.orderedComponents.findIndex((entry) =>
    componentMatches(entry, ordering.referenceComponent),
  );
  if (referenceIndex < 0) {
    return {
      status: "MISSING_CONTEXT",
      code: "CRO_REFERENCE_COMPONENT_NOT_IN_STRUCTURE",
      missingRef: snapshot.bindingRef,
    };
  }

  const resultingOrder = moveBeforeOrAfter(
    snapshot.orderedComponents,
    parameters.component,
    ordering.referenceComponent,
    ordering.kind === "PLACE_AFTER",
  );
  if (!resultingOrder) {
    return {
      status: "MISSING_CONTEXT",
      code: "CRO_COMPONENT_NOT_IN_STRUCTURE",
      missingRef: snapshot.bindingRef,
    };
  }
  const targetPosition =
    resultingOrder.findIndex((entry) =>
      componentMatches(entry, parameters.component),
    ) + 1;

  return {
    status: "RESOLVED",
    currentPosition: currentIndex + 1,
    targetPosition,
    resultingOrder,
    snapshotRef: snapshot.bindingRef,
  };
}
