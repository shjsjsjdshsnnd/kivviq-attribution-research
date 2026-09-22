import type {
  Action,
  MerchandisingPlacement,
  MerchandisingSurface,
} from "../action_ontology/types.js";
import {
  merchandisingEntityKey,
  merchandisingSurfaceKey,
  resolveMerchandisingRank,
} from "./ranking.js";
import type {
  MerchandisingEligibilityContext,
  MerchandisingEligibilityDecision,
  MerchandisingSurfaceDefinition,
} from "./types.js";

function surfaceDefinition(
  surface: MerchandisingSurface,
  context: MerchandisingEligibilityContext,
): MerchandisingSurfaceDefinition | undefined {
  const key = merchandisingSurfaceKey(surface);
  return context.surfaceDefinitions?.find(
    (definition) => merchandisingSurfaceKey(definition.surface) === key,
  );
}

function placementEligibility(
  placement: MerchandisingPlacement | undefined,
  surface: MerchandisingSurface,
  context: MerchandisingEligibilityContext,
): MerchandisingEligibilityDecision | undefined {
  if (!placement) return undefined;
  const definition = surfaceDefinition(surface, context);
  if (!definition) {
    return {
      status: "unknown",
      reasonCodes: ["MERCHANDISING_SURFACE_DEFINITION_UNKNOWN"],
      missingInformation: [merchandisingSurfaceKey(surface)],
    };
  }

  if (placement.kind === "POSITION") {
    if (definition.capacity === undefined) {
      return {
        status: "unknown",
        reasonCodes: ["MERCHANDISING_SURFACE_CAPACITY_UNKNOWN"],
        missingInformation: [definition.sourceRef],
      };
    }
    if (placement.position > definition.capacity) {
      return {
        status: "ineligible",
        reasonCodes: ["MERCHANDISING_POSITION_EXCEEDS_CAPACITY"],
        missingInformation: [],
      };
    }
  } else {
    if (definition.namedSlotIds === undefined) {
      return {
        status: "unknown",
        reasonCodes: ["MERCHANDISING_NAMED_SLOTS_UNKNOWN"],
        missingInformation: [definition.sourceRef],
      };
    }
    if (!definition.namedSlotIds.includes(placement.slotId)) {
      return {
        status: "ineligible",
        reasonCodes: ["MERCHANDISING_SLOT_NOT_AVAILABLE"],
        missingInformation: [],
      };
    }
  }
}

export function evaluateMerchandisingEligibility(
  action: Action,
  context: MerchandisingEligibilityContext,
): MerchandisingEligibilityDecision {
  if (action.parameters.kind === "merchandising_visibility") {
    const placement = placementEligibility(
      action.parameters.placement,
      action.parameters.surface,
      context,
    );
    if (placement) return placement;
  }

  if (action.parameters.kind === "merchandising_rank") {
    const resolution = resolveMerchandisingRank(
      action,
      context.rankingSnapshots ?? [],
    );
    if (resolution.status === "MISSING_CONTEXT") {
      return {
        status: "unknown",
        reasonCodes: [resolution.code],
        missingInformation: [resolution.missingRef],
      };
    }
    if (resolution.status === "INVALID") {
      return {
        status: "ineligible",
        reasonCodes: [resolution.code],
        missingInformation: [],
      };
    }
    const definition = surfaceDefinition(action.parameters.surface, context);
    if (!definition || definition.capacity === undefined) {
      return {
        status: "unknown",
        reasonCodes: ["MERCHANDISING_SURFACE_CAPACITY_UNKNOWN"],
        missingInformation: [
          definition?.sourceRef ??
            merchandisingSurfaceKey(action.parameters.surface),
        ],
      };
    }
    if (resolution.targetPosition > definition.capacity) {
      return {
        status: "ineligible",
        reasonCodes: ["MERCHANDISING_POSITION_EXCEEDS_CAPACITY"],
        missingInformation: [],
      };
    }
  }

  if (action.parameters.kind === "merchandising_relationship") {
    const trigger = action.parameters.trigger;
    if (trigger.kind !== "ALWAYS") {
      const key = merchandisingEntityKey(action.parameters.source);
      const units = context.inventoryUnitsByEntity?.[key];
      if (units === undefined) {
        return {
          status: "unknown",
          reasonCodes: ["SOURCE_INVENTORY_UNKNOWN"],
          missingInformation: [key],
        };
      }
      if (
        trigger.kind === "SOURCE_OUT_OF_STOCK" &&
        units !== 0
      ) {
        return {
          status: "ineligible",
          reasonCodes: ["SOURCE_NOT_OUT_OF_STOCK"],
          missingInformation: [],
        };
      }
      if (
        trigger.kind === "SOURCE_INVENTORY_AT_MOST" &&
        units > trigger.units
      ) {
        return {
          status: "ineligible",
          reasonCodes: ["SOURCE_INVENTORY_ABOVE_TRIGGER"],
          missingInformation: [],
        };
      }
    }

    const definition = surfaceDefinition(action.parameters.surface, context);
    if (
      action.parameters.surface.kind === "RECOMMENDATION_SLOT" ||
      action.parameters.surface.kind === "HOMEPAGE" ||
      action.parameters.surface.kind === "PRODUCT_PAGE" ||
      action.parameters.surface.kind === "CART" ||
      action.parameters.surface.kind === "CHECKOUT" ||
      action.parameters.surface.kind === "POST_PURCHASE"
    ) {
      if (!definition || definition.capacity === undefined) {
        return {
          status: "unknown",
          reasonCodes: ["MERCHANDISING_SURFACE_CAPACITY_UNKNOWN"],
          missingInformation: [
            definition?.sourceRef ??
              merchandisingSurfaceKey(action.parameters.surface),
          ],
        };
      }
      const maxPosition = Math.max(
        ...action.parameters.targets.map((target) => target.position),
      );
      if (maxPosition > definition.capacity) {
        return {
          status: "ineligible",
          reasonCodes: ["MERCHANDISING_POSITION_EXCEEDS_CAPACITY"],
          missingInformation: [],
        };
      }
    }
  }

  for (const constraint of action.constraints) {
    if (constraint.constraintClass !== "hard") continue;
    const state = context.hardConstraintResults?.[constraint.constraintId];
    if (state === "violated") {
      return {
        status: "ineligible",
        reasonCodes: ["HARD_CONSTRAINT_VIOLATED:" + constraint.constraintId],
        missingInformation: [],
      };
    }
    if (state === undefined || state === "unknown") {
      return {
        status: "unknown",
        reasonCodes: ["HARD_CONSTRAINT_UNKNOWN:" + constraint.constraintId],
        missingInformation: [constraint.constraintId],
      };
    }
  }

  return { status: "eligible", reasonCodes: [], missingInformation: [] };
}
