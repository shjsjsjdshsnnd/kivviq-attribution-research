import type {
  Action,
  MerchandisingEntityTarget,
  MerchandisingSurface,
} from "../action_ontology/types.js";
import type {
  MerchandisingRankResolution,
  MerchandisingRankingSnapshot,
} from "./types.js";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (typeof value !== "object" || value === null) return JSON.stringify(value);
  return (
    "{" +
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => JSON.stringify(key) + ":" + canonical(entry))
      .join(",") +
    "}"
  );
}

export function merchandisingSurfaceKey(surface: MerchandisingSurface): string {
  return canonical(surface);
}

export function merchandisingEntityKey(entity: MerchandisingEntityTarget): string {
  return canonical(entity);
}

function findSnapshot(
  snapshots: readonly MerchandisingRankingSnapshot[],
  bindingRef: string,
  surface: MerchandisingSurface,
): MerchandisingRankingSnapshot | undefined {
  return snapshots.find(
    (snapshot) =>
      snapshot.bindingRef === bindingRef &&
      merchandisingSurfaceKey(snapshot.surface) ===
        merchandisingSurfaceKey(surface),
  );
}

export function applyShiftOthers(
  ordered: readonly MerchandisingEntityTarget[],
  entity: MerchandisingEntityTarget,
  targetPosition: number,
): readonly MerchandisingEntityTarget[] | undefined {
  const key = merchandisingEntityKey(entity);
  const currentIndex = ordered.findIndex(
    (candidate) => merchandisingEntityKey(candidate) === key,
  );
  if (currentIndex < 0) return undefined;

  const next = [...ordered];
  const [moved] = next.splice(currentIndex, 1);
  if (!moved) return undefined;

  const insertionIndex = Math.max(0, Math.min(targetPosition - 1, next.length));
  next.splice(insertionIndex, 0, moved);
  return next;
}

export function resolveMerchandisingRank(
  action: Action,
  snapshots: readonly MerchandisingRankingSnapshot[] = [],
): MerchandisingRankResolution {
  if (
    action.actionType !== "merchandising.set_rank" ||
    action.parameters.kind !== "merchandising_rank"
  ) {
    return {
      status: "INVALID",
      code: "TARGET_POSITION_OUT_OF_RANGE",
    };
  }

  const operation = action.parameters.operation;
  if (operation.kind === "SET") {
    if (operation.position < 1) {
      return { status: "INVALID", code: "TARGET_POSITION_OUT_OF_RANGE" };
    }
    return { status: "RESOLVED", targetPosition: operation.position };
  }

  if (operation.kind === "MOVE_TO_TOP" && !operation.snapshot) {
    return { status: "RESOLVED", targetPosition: 1 };
  }

  const snapshotRef =
    operation.kind === "DELTA"
      ? operation.snapshot
      : operation.snapshot!;
  const snapshot = findSnapshot(
    snapshots,
    snapshotRef.bindingRef,
    action.parameters.surface,
  );
  if (!snapshot) {
    return {
      status: "MISSING_CONTEXT",
      code: "MISSING_RANKING_SNAPSHOT",
      missingRef: snapshotRef.bindingRef,
    };
  }

  const entityKey = merchandisingEntityKey(action.parameters.entity);
  const currentIndex = snapshot.orderedEntities.findIndex(
    (entity) => merchandisingEntityKey(entity) === entityKey,
  );
  if (currentIndex < 0) {
    return {
      status: "MISSING_CONTEXT",
      code: "RANKED_ENTITY_NOT_IN_SNAPSHOT",
      missingRef: snapshot.bindingRef,
    };
  }

  const currentPosition = currentIndex + 1;
  let targetPosition = 1;
  if (operation.kind === "DELTA") {
    targetPosition =
      operation.direction === "UP"
        ? Math.max(1, currentPosition - operation.positions)
        : currentPosition + operation.positions;
  }

  const resultingOrder = applyShiftOthers(
    snapshot.orderedEntities,
    action.parameters.entity,
    targetPosition,
  );

  return {
    status: "RESOLVED",
    targetPosition,
    currentPosition,
    ...(resultingOrder ? { resultingOrder } : {}),
    snapshotRef: snapshot.bindingRef,
  };
}
