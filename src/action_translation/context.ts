import type {
  Action,
  ActionTarget,
  ReferenceValue,
  ScalarValue,
} from "../action_ontology/types.js";
import type {
  SimulatorScalarValue,
  SimulatorTarget,
} from "../simulator_intervention/types.js";
import {
  SUPPORTED_TRANSLATION_CONTEXT_SCHEMA_VERSIONS,
  TRANSLATION_CONTEXT_SCHEMA_VERSION,
  type PricingMembershipBinding,
  type PromotionMembershipBinding,
  type TranslationContext,
  type TranslationFailure,
} from "./types.js";

const FORBIDDEN_CONTEXT_KEYS = new Set([
  "futureDemand",
  "futureConversions",
  "futureRevenue",
  "futureStockout",
  "counterfactualRevenue",
  "counterfactualProfit",
  "trueIncrementalROAS",
  "trueResponseCurve",
  "oracleState",
  "oracleBestAction",
  "groundTruth",
  "groundTruthId",
  "evaluatorResult",
  "recommendationScore",
  "optimizerOutput",
  "expectedDemandLift",
  "predictedRedemptions",
  "predictedAOV",
  "futureInventory",
  "futureConversion",
  "predictedPurchaseProbability",
  "predictedCrossSellRate",
  "predictedUpsellRate",
  "expectedCTR",
  "forecastDemand",
  "predictedStockoutDate",
  "predictedSellThrough",
  "predictedSupplierDelay",
  "futureSales",
  "futureReturns",
  "futureRealizedSupplierDelay",
  "counterfactualInventory",
  "expectedConversionRate",
  "expectedConversionLift",
  "expectedRevenue",
  "expectedAOV",
  "expectedBounceReduction",
  "expectedCheckoutCompletion",
  "expectedCTR",
  "predictedLift",
  "predictedRevenue",
  "counterfactualConversion",
  "trafficAllocation",
  "randomizationUnit",
  "significanceThreshold",
  "experimentResult",
  "variantPayload",
  "futureSessions",
  "futureOrders",
]);

function record(value: unknown): value is any {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}

function stableKey(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function scanForbidden(
  input: unknown,
  path: string,
  hits: string[],
): void {
  if (Array.isArray(input)) {
    input.forEach((entry, index) =>
      scanForbidden(entry, path + "[" + index + "]", hits),
    );
    return;
  }
  if (!record(input)) return;

  for (const [key, value] of Object.entries(input)) {
    const next = path === "$" ? key : path + "." + key;
    if (FORBIDDEN_CONTEXT_KEYS.has(key)) hits.push(next);
    scanForbidden(value, next, hits);
  }
}


function validatePricingMembershipBindings(
  input: unknown,
):
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string } {
  if (input === undefined) return { ok: true };
  if (!Array.isArray(input)) {
    return {
      ok: false,
      message: "pricingMembershipBindings must be an array",
    };
  }

  const bindingIds = new Set<string>();
  for (const binding of input) {
    if (
      !record(binding) ||
      !record(binding.actionTarget) ||
      !["product", "category", "collection"].includes(
        String(binding.actionTarget.kind),
      ) ||
      !["decision_time", "translation_time", "effective_time"].includes(
        String(binding.evaluateAt),
      ) ||
      !nonEmpty(binding.bindingRef) ||
      !nonEmpty(binding.sourceRef) ||
      typeof binding.snapshotTime !== "string" ||
      !binding.snapshotTime.endsWith("Z") ||
      !Number.isFinite(Date.parse(binding.snapshotTime)) ||
      !Array.isArray(binding.members) ||
      binding.members.length === 0
    ) {
      return {
        ok: false,
        message: "pricing membership binding is malformed",
      };
    }

    if (bindingIds.has(binding.bindingRef)) {
      return {
        ok: false,
        message: "pricing membership bindingRef values must be unique",
      };
    }
    bindingIds.add(binding.bindingRef);

    const members = new Set<string>();
    for (const member of binding.members) {
      if (
        !record(member) ||
        !record(member.skuTarget) ||
        member.skuTarget.kind !== "sku" ||
        !nonEmpty(member.skuTarget.skuId) ||
        !record(member.simulatorTarget) ||
        member.simulatorTarget.kind !== "sku" ||
        !nonEmpty(member.simulatorTarget.simulatorSkuId) ||
        !record(member.priceAtBoundary) ||
        member.priceAtBoundary.kind !== "money" ||
        !Number.isInteger(member.priceAtBoundary.amountMinor) ||
        Number(member.priceAtBoundary.amountMinor) < 0 ||
        typeof member.priceAtBoundary.currency !== "string" ||
        !/^[A-Z]{3}$/.test(member.priceAtBoundary.currency) ||
        !nonEmpty(member.priceSourceRef)
      ) {
        return {
          ok: false,
          message: "pricing membership member is malformed",
        };
      }

      if (members.has(member.skuTarget.skuId)) {
        return {
          ok: false,
          message: "pricing membership contains duplicate SKU members",
        };
      }
      members.add(member.skuTarget.skuId);
    }
  }

  return { ok: true };
}


function validatePromotionMembershipBindings(
  input: unknown,
):
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string } {
  if (input === undefined) return { ok: true };
  if (!Array.isArray(input)) {
    return {
      ok: false,
      message: "promotionMembershipBindings must be an array",
    };
  }

  const bindingIds = new Set<string>();
  for (const binding of input) {
    if (
      !record(binding) ||
      !nonEmpty(binding.promotionId) ||
      !["decision_time", "translation_time", "effective_time"].includes(
        String(binding.evaluateAt),
      ) ||
      !nonEmpty(binding.bindingRef) ||
      !nonEmpty(binding.sourceRef) ||
      typeof binding.snapshotTime !== "string" ||
      !binding.snapshotTime.endsWith("Z") ||
      !Number.isFinite(Date.parse(binding.snapshotTime)) ||
      !Array.isArray(binding.members) ||
      binding.members.length === 0
    ) {
      return {
        ok: false,
        message: "promotion membership binding is malformed",
      };
    }

    if (bindingIds.has(binding.bindingRef)) {
      return {
        ok: false,
        message: "promotion membership bindingRef values must be unique",
      };
    }
    bindingIds.add(binding.bindingRef);

    const members = new Set<string>();
    for (const member of binding.members) {
      if (
        !record(member) ||
        !record(member.businessTarget) ||
        !["sku", "product"].includes(String(member.businessTarget.kind)) ||
        !record(member.simulatorTarget) ||
        !["sku", "product"].includes(String(member.simulatorTarget.kind)) ||
        !nonEmpty(member.sourceRef)
      ) {
        return {
          ok: false,
          message: "promotion membership member is malformed",
        };
      }

      const key = stableKey(member.businessTarget);
      if (members.has(key)) {
        return {
          ok: false,
          message: "promotion membership contains duplicate business members",
        };
      }
      members.add(key);
    }
  }

  return { ok: true };
}


function validateMerchandisingRankingSnapshots(
  input: unknown,
):
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string } {
  if (input === undefined) return { ok: true };
  if (!Array.isArray(input)) {
    return {
      ok: false,
      message: "merchandisingRankingSnapshots must be an array",
    };
  }

  const refs = new Set<string>();
  for (const snapshot of input) {
    if (
      !record(snapshot) ||
      !nonEmpty(snapshot.bindingRef) ||
      !["decision_time", "translation_time", "effective_time"].includes(
        String(snapshot.evaluateAt),
      ) ||
      typeof snapshot.snapshotTime !== "string" ||
      !snapshot.snapshotTime.endsWith("Z") ||
      !Number.isFinite(Date.parse(snapshot.snapshotTime)) ||
      !nonEmpty(snapshot.sourceRef) ||
      !record(snapshot.surface) ||
      !Array.isArray(snapshot.orderedEntities) ||
      snapshot.orderedEntities.length === 0 ||
      snapshot.orderedEntities.some(
        (entity: unknown) =>
          !record(entity) ||
          !["sku", "product", "collection"].includes(String(entity.kind)),
      )
    ) {
      return {
        ok: false,
        message: "merchandising ranking snapshot is malformed",
      };
    }

    if (refs.has(snapshot.bindingRef)) {
      return {
        ok: false,
        message: "merchandising ranking bindingRef values must be unique",
      };
    }
    refs.add(snapshot.bindingRef);

    const entities = snapshot.orderedEntities.map(stableKey);
    if (new Set(entities).size !== entities.length) {
      return {
        ok: false,
        message: "merchandising ranking snapshot contains duplicate entities",
      };
    }
  }

  return { ok: true };
}

function validateMerchandisingSurfaceDefinitions(
  input: unknown,
):
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string } {
  if (input === undefined) return { ok: true };
  if (!Array.isArray(input)) {
    return {
      ok: false,
      message: "merchandisingSurfaceDefinitions must be an array",
    };
  }
  const surfaces = new Set<string>();
  for (const definition of input) {
    if (
      !record(definition) ||
      !record(definition.surface) ||
      !nonEmpty(definition.sourceRef)
    ) {
      return {
        ok: false,
        message: "merchandising surface definition is malformed",
      };
    }
    if (
      definition.capacity !== undefined &&
      (!Number.isInteger(definition.capacity) ||
        Number(definition.capacity) <= 0)
    ) {
      return {
        ok: false,
        message: "merchandising surface capacity must be a positive integer",
      };
    }
    if (
      definition.namedSlotIds !== undefined &&
      (!Array.isArray(definition.namedSlotIds) ||
        definition.namedSlotIds.some((value: unknown) => !nonEmpty(value)) ||
        new Set(definition.namedSlotIds).size !==
          definition.namedSlotIds.length)
    ) {
      return {
        ok: false,
        message: "merchandising named slots must be unique non-empty strings",
      };
    }

    const key = stableKey(definition.surface);
    if (surfaces.has(key)) {
      return {
        ok: false,
        message: "merchandising surface definitions must be unique",
      };
    }
    surfaces.add(key);
  }
  return { ok: true };
}


function validateInventoryStateBindings(
  input: unknown,
):
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string } {
  if (input === undefined) return { ok: true };
  if (!Array.isArray(input)) {
    return {
      ok: false,
      message: "inventoryStateBindings must be an array",
    };
  }

  const identities = new Set<string>();
  for (const binding of input) {
    if (
      !record(binding) ||
      !record(binding.target) ||
      !["sku", "product", "inventory_policy"].includes(
        String(binding.target.kind),
      ) ||
      !nonEmpty(binding.sourceRef)
    ) {
      return {
        ok: false,
        message: "inventory state binding is malformed",
      };
    }

    const integerFields = [
      "onHandUnits",
      "availableToSellUnits",
      "reservedUnits",
      "safetyStockUnits",
      "reorderPointUnits",
      "currentReorderQuantity",
      "openPurchaseOrderUnits",
      "supplierAvailableUnits",
      "warehouseAvailableCapacityUnits",
    ];
    if (
      integerFields.some(
        (field) =>
          binding[field] !== undefined &&
          (!Number.isInteger(binding[field]) ||
            Number(binding[field]) < 0),
      )
    ) {
      return {
        ok: false,
        message: "inventory state unit fields must be non-negative integers",
      };
    }

    if (
      binding.currentPlannedReorderAt !== undefined &&
      (typeof binding.currentPlannedReorderAt !== "string" ||
        !binding.currentPlannedReorderAt.endsWith("Z") ||
        !Number.isFinite(Date.parse(binding.currentPlannedReorderAt)))
    ) {
      return {
        ok: false,
        message: "current planned reorder timestamp is invalid",
      };
    }

    if (
      binding.inventoryLocationId !== undefined &&
      !nonEmpty(binding.inventoryLocationId)
    ) {
      return {
        ok: false,
        message: "inventoryLocationId must be non-empty when supplied",
      };
    }
    if (
      binding.supplierRelationshipId !== undefined &&
      !nonEmpty(binding.supplierRelationshipId)
    ) {
      return {
        ok: false,
        message: "supplierRelationshipId must be non-empty when supplied",
      };
    }

    if (binding.supplierConstraints !== undefined) {
      if (!record(binding.supplierConstraints)) {
        return {
          ok: false,
          message: "supplierConstraints must be an object",
        };
      }
      for (const field of [
        "minimumOrderQuantity",
        "orderMultiple",
        "maximumSupplierQuantity",
      ]) {
        if (
          binding.supplierConstraints[field] !== undefined &&
          (!Number.isInteger(binding.supplierConstraints[field]) ||
            Number(binding.supplierConstraints[field]) <= 0)
        ) {
          return {
            ok: false,
            message: "supplier constraint values must be positive integers",
          };
        }
      }
    }

    if (binding.leadTimeAssumption !== undefined) {
      if (
        !record(binding.leadTimeAssumption) ||
        !Number.isInteger(binding.leadTimeAssumption.durationSeconds) ||
        Number(binding.leadTimeAssumption.durationSeconds) <= 0 ||
        !nonEmpty(binding.leadTimeAssumption.sourceRef)
      ) {
        return {
          ok: false,
          message: "leadTimeAssumption is malformed",
        };
      }
    }

    const key = stableKey({
      target: binding.target,
      inventoryLocationId: binding.inventoryLocationId,
      supplierRelationshipId: binding.supplierRelationshipId,
    });
    if (identities.has(key)) {
      return {
        ok: false,
        message: "inventory state bindings must be unique by target/location/supplier",
      };
    }
    identities.add(key);
  }
  return { ok: true };
}


const CRO_CONTEXT_SURFACES = new Set([
  "SITE_WIDE","HOMEPAGE","COLLECTION","PDP","CART","CHECKOUT","SITE_SEARCH","LANDING_PAGE",
]);
const CRO_CONTEXT_DEVICES = new Set(["ALL_DEVICES","MOBILE","DESKTOP"]);
const CRO_CONTEXT_COMPONENTS = new Set([
  "PAGE_LAYOUT","HERO","VALUE_PROPOSITION","FEATURED_PRODUCTS","FEATURED_COLLECTIONS",
  "PROMOTIONAL_BANNER","NAVIGATION","SOCIAL_PROOF","CONTENT_SECTION","PRODUCT_GRID",
  "PRODUCT_CARD","FILTERS","SORTING","COLLECTION_HEADER","COLLECTION_DESCRIPTION",
  "MERCHANDISING_BLOCK","PAGINATION","PRODUCT_GALLERY","PRODUCT_TITLE","PRICE_DISPLAY",
  "VARIANT_SELECTOR","ADD_TO_CART","BUY_NOW","PRODUCT_DESCRIPTION","DELIVERY_INFORMATION",
  "RETURNS_INFORMATION","REVIEWS","RECOMMENDATIONS","STOCK_INFORMATION",
  "PAYMENT_INFORMATION","CART_ITEMS","QUANTITY_CONTROL","ORDER_SUMMARY","SHIPPING_MESSAGE",
  "PROMOTION_ENTRY","CROSS_SELL","CHECKOUT_CTA","CONTACT_STEP","SHIPPING_STEP",
  "PAYMENT_STEP","FORM","FIELD","ERROR_HANDLING","PROGRESS_INDICATOR","EXPRESS_PAYMENT",
  "SEARCH_INPUT","AUTOCOMPLETE","SEARCH_RESULTS","NO_RESULTS_STATE","CTA","PRODUCT_SECTION",
]);
const CRO_CONTEXT_CAPABILITIES = new Set([
  "ADD_COMPONENT","REMOVE_COMPONENT","REORDER_COMPONENTS","MODIFY_PRESENTATION",
  "MODIFY_INTERACTION","MODIFY_NAVIGATION","MODIFY_SEARCH_EXPERIENCE",
  "MODIFY_CHECKOUT_EXPERIENCE","MODIFY_PERFORMANCE","AUTOCOMPLETE","FILTERS",
  "SORTING","NO_RESULTS_EXPERIENCE",
]);

function validCroPageScope(scope:unknown):boolean{
  if(!record(scope)||!nonEmpty(scope.kind))return false;
  switch(scope.kind){
    case "ALL_SURFACE":
    case "ALL_PDP":
    case "ALL_COLLECTIONS":
      return true;
    case "PRODUCT_PDP": return nonEmpty(scope.productId);
    case "CATEGORY_PDP_SET": return nonEmpty(scope.categoryId);
    case "PAGE_TEMPLATE": return nonEmpty(scope.templateId);
    case "SPECIFIC_PAGE": return nonEmpty(scope.pageId);
    case "LANDING_PAGE": return nonEmpty(scope.landingPageId);
    default:return false;
  }
}

function validCroComponentTarget(component:unknown):boolean{
  return record(component)&&
    CRO_CONTEXT_COMPONENTS.has(String(component.component))&&
    (component.instanceId===undefined||nonEmpty(component.instanceId));
}

function validateCroStructureSnapshots(
  input:unknown,
): {readonly ok:true}|{readonly ok:false;readonly message:string}{
  if(input===undefined)return{ok:true};
  if(!Array.isArray(input))return{ok:false,message:"croStructureSnapshots must be an array"};
  const refs=new Set<string>();
  for(const snapshot of input){
    if(!record(snapshot)||
       !nonEmpty(snapshot.bindingRef)||
       !["decision_time","translation_time","effective_time"].includes(String(snapshot.evaluateAt))||
       typeof snapshot.snapshotTime!=="string"||
       !snapshot.snapshotTime.endsWith("Z")||
       !Number.isFinite(Date.parse(snapshot.snapshotTime))||
       !nonEmpty(snapshot.sourceRef)||
       !CRO_CONTEXT_SURFACES.has(String(snapshot.surface))||
       !validCroPageScope(snapshot.pageScope)||
       !CRO_CONTEXT_DEVICES.has(String(snapshot.device))||
       !Array.isArray(snapshot.orderedComponents)||
       snapshot.orderedComponents.length===0||
       snapshot.orderedComponents.some((component:unknown)=>!validCroComponentTarget(component))){
      return{ok:false,message:"CRO structure snapshot is malformed"};
    }
    if(refs.has(snapshot.bindingRef))return{ok:false,message:"CRO structure bindingRef values must be unique"};
    refs.add(snapshot.bindingRef);
    const keys=snapshot.orderedComponents.map(stableKey);
    if(new Set(keys).size!==keys.length)return{ok:false,message:"CRO structure snapshot contains duplicate component identities"};
  }
  return{ok:true};
}

function validateCroExperienceBindings(
  input:unknown,
): {readonly ok:true}|{readonly ok:false;readonly message:string}{
  if(input===undefined)return{ok:true};
  if(!Array.isArray(input))return{ok:false,message:"croExperienceBindings must be an array"};
  const identities=new Set<string>();
  for(const binding of input){
    if(!record(binding)||
       !CRO_CONTEXT_SURFACES.has(String(binding.surface))||
       !validCroPageScope(binding.pageScope)||
       !CRO_CONTEXT_DEVICES.has(String(binding.device))||
       !nonEmpty(binding.sourceRef)||
       !Array.isArray(binding.presentComponents)||
       binding.presentComponents.some((component:unknown)=>!validCroComponentTarget(component))||
       !Array.isArray(binding.capabilities)||
       binding.capabilities.some((capability:unknown)=>!CRO_CONTEXT_CAPABILITIES.has(String(capability)))||
       new Set(binding.capabilities).size!==binding.capabilities.length){
      return{ok:false,message:"CRO experience binding is malformed"};
    }
    const componentKeys=binding.presentComponents.map(stableKey);
    if(new Set(componentKeys).size!==componentKeys.length){
      return{ok:false,message:"CRO experience present components must be unique"};
    }
    if(binding.componentStates!==undefined){
      if(!Array.isArray(binding.componentStates)||
         binding.componentStates.some((state:unknown)=>!record(state)||!validCroComponentTarget(state.component)||!nonEmpty(state.stateRef))){
        return{ok:false,message:"CRO component state bindings are malformed"};
      }
    }
    if(binding.performanceConfigurationRef!==undefined&&!nonEmpty(binding.performanceConfigurationRef)){
      return{ok:false,message:"CRO performanceConfigurationRef must be non-empty"};
    }
    const key=stableKey({surface:binding.surface,pageScope:binding.pageScope,device:binding.device});
    if(identities.has(key))return{ok:false,message:"CRO experience bindings must be unique by surface/pageScope/device"};
    identities.add(key);
  }
  return{ok:true};
}

export type TranslationContextValidationResult =
  | {
      readonly ok: true;
      readonly context: TranslationContext;
    }
  | {
      readonly ok: false;
      readonly failure: TranslationFailure;
    };

export function validateTranslationContext(
  input: unknown,
): TranslationContextValidationResult {
  if (!record(input)) {
    return {
      ok: false,
      failure: {
        status: "MISSING_CONTEXT",
        code: "INVALID_TRANSLATION_CONTEXT",
        message: "TranslationContext must be an object.",
      },
    };
  }

  const forbidden: string[] = [];
  scanForbidden(input, "$", forbidden);
  if (forbidden.length > 0) {
    return {
      ok: false,
      failure: {
        status: "INVALID_ACTION",
        code: "FORBIDDEN_TRANSLATION_CONTEXT_INFORMATION",
        message:
          "TranslationContext contains forbidden future/oracle/evaluator information: " +
          forbidden.join(", "),
      },
    };
  }

  if (
    !SUPPORTED_TRANSLATION_CONTEXT_SCHEMA_VERSIONS.includes(
      input.schemaVersion as never,
    )
  ) {
    return {
      ok: false,
      failure: {
        status: "MISSING_CONTEXT",
        code: "UNSUPPORTED_TRANSLATION_CONTEXT_VERSION",
        message: "Unsupported TranslationContext schema version.",
      },
    };
  }


  if (
    input.schemaVersion === "1.0.0" &&
    input.pricingMembershipBindings !== undefined
  ) {
    return {
      ok: false,
      failure: {
        status: "MISSING_CONTEXT",
        code: "TRANSLATION_CONTEXT_FEATURE_REQUIRES_1_1",
        message: "pricingMembershipBindings require TranslationContext schema 1.1.0 or newer.",
      },
    };
  }

  if (
    (input.schemaVersion === "1.0.0" ||
      input.schemaVersion === "1.1.0") &&
    input.promotionMembershipBindings !== undefined
  ) {
    return {
      ok: false,
      failure: {
        status: "MISSING_CONTEXT",
        code: "TRANSLATION_CONTEXT_FEATURE_REQUIRES_1_2",
        message: "promotionMembershipBindings require TranslationContext schema 1.2.0.",
      },
    };
  }


  if (
    (input.schemaVersion === "1.0.0" ||
      input.schemaVersion === "1.1.0" ||
      input.schemaVersion === "1.2.0") &&
    (input.merchandisingRankingSnapshots !== undefined ||
      input.merchandisingSurfaceDefinitions !== undefined)
  ) {
    return {
      ok: false,
      failure: {
        status: "MISSING_CONTEXT",
        code: "TRANSLATION_CONTEXT_FEATURE_REQUIRES_1_3",
        message:
          "merchandising ranking/surface context requires TranslationContext schema 1.3.0.",
      },
    };
  }


  if (
    (input.schemaVersion === "1.0.0" ||
      input.schemaVersion === "1.1.0" ||
      input.schemaVersion === "1.2.0" ||
      input.schemaVersion === "1.3.0") &&
    input.inventoryStateBindings !== undefined
  ) {
    return {
      ok: false,
      failure: {
        status: "MISSING_CONTEXT",
        code: "TRANSLATION_CONTEXT_FEATURE_REQUIRES_1_4",
        message:
          "inventoryStateBindings require TranslationContext schema 1.4.0.",
      },
    };
  }


  if (
    (input.schemaVersion === "1.0.0" ||
      input.schemaVersion === "1.1.0" ||
      input.schemaVersion === "1.2.0" ||
      input.schemaVersion === "1.3.0" ||
      input.schemaVersion === "1.4.0") &&
    (input.croStructureSnapshots !== undefined ||
      input.croExperienceBindings !== undefined)
  ) {
    return {
      ok: false,
      failure: {
        status: "MISSING_CONTEXT",
        code: "TRANSLATION_CONTEXT_FEATURE_REQUIRES_1_5",
        message:
          "CRO structure/experience context requires TranslationContext schema 1.5.0.",
      },
    };
  }

  if (
    typeof input.simulatorClock !== "string" ||
    !input.simulatorClock.endsWith("Z") ||
    !Number.isFinite(Date.parse(input.simulatorClock))
  ) {
    return {
      ok: false,
      failure: {
        status: "MISSING_CONTEXT",
        code: "INVALID_SIMULATOR_CLOCK",
        message: "TranslationContext requires a valid UTC simulator clock.",
      },
    };
  }

  if (
    !Array.isArray(input.capabilities) ||
    !Array.isArray(input.entityMappings) ||
    !Array.isArray(input.referenceBindings)
  ) {
    return {
      ok: false,
      failure: {
        status: "MISSING_CONTEXT",
        code: "MALFORMED_TRANSLATION_CONTEXT",
        message:
          "TranslationContext capabilities, entityMappings and referenceBindings must be arrays.",
      },
    };
  }

  const pricingMembershipValidation = validatePricingMembershipBindings(
    input.pricingMembershipBindings,
  );
  if (!pricingMembershipValidation.ok) {
    return {
      ok: false,
      failure: {
        status: "MISSING_CONTEXT",
        code: "MALFORMED_PRICING_MEMBERSHIP_CONTEXT",
        message: pricingMembershipValidation.message,
      },
    };
  }

  const promotionMembershipValidation = validatePromotionMembershipBindings(
    input.promotionMembershipBindings,
  );
  if (!promotionMembershipValidation.ok) {
    return {
      ok: false,
      failure: {
        status: "MISSING_CONTEXT",
        code: "MALFORMED_PROMOTION_MEMBERSHIP_CONTEXT",
        message: promotionMembershipValidation.message,
      },
    };
  }

  const merchandisingRankingValidation =
    validateMerchandisingRankingSnapshots(
      input.merchandisingRankingSnapshots,
    );
  if (!merchandisingRankingValidation.ok) {
    return {
      ok: false,
      failure: {
        status: "MISSING_CONTEXT",
        code: "MALFORMED_MERCHANDISING_RANKING_CONTEXT",
        message: merchandisingRankingValidation.message,
      },
    };
  }

  const merchandisingSurfaceValidation =
    validateMerchandisingSurfaceDefinitions(
      input.merchandisingSurfaceDefinitions,
    );
  if (!merchandisingSurfaceValidation.ok) {
    return {
      ok: false,
      failure: {
        status: "MISSING_CONTEXT",
        code: "MALFORMED_MERCHANDISING_SURFACE_CONTEXT",
        message: merchandisingSurfaceValidation.message,
      },
    };
  }

  const inventoryStateValidation = validateInventoryStateBindings(
    input.inventoryStateBindings,
  );
  if (!inventoryStateValidation.ok) {
    return {
      ok: false,
      failure: {
        status: "MISSING_CONTEXT",
        code: "MALFORMED_INVENTORY_STATE_CONTEXT",
        message: inventoryStateValidation.message,
      },
    };
  }

  const croStructureValidation = validateCroStructureSnapshots(
    input.croStructureSnapshots,
  );
  if (!croStructureValidation.ok) {
    return {
      ok: false,
      failure: {
        status: "MISSING_CONTEXT",
        code: "MALFORMED_CRO_STRUCTURE_CONTEXT",
        message: croStructureValidation.message,
      },
    };
  }

  const croExperienceValidation = validateCroExperienceBindings(
    input.croExperienceBindings,
  );
  if (!croExperienceValidation.ok) {
    return {
      ok: false,
      failure: {
        status: "MISSING_CONTEXT",
        code: "MALFORMED_CRO_EXPERIENCE_CONTEXT",
        message: croExperienceValidation.message,
      },
    };
  }

  return { ok: true, context: input as TranslationContext };
}

export type TargetResolution =
  | { readonly status: "resolved"; readonly target: SimulatorTarget }
  | { readonly status: "missing"; readonly ref: string }
  | { readonly status: "ambiguous"; readonly ref: string };

export function resolveSimulatorTarget(
  context: TranslationContext,
  target: ActionTarget,
): TargetResolution {
  const key = stableKey(target);
  const matches = context.entityMappings.filter(
    (mapping) => stableKey(mapping.actionTarget) === key,
  );

  if (matches.length === 0) {
    return { status: "missing", ref: "target:" + key };
  }
  if (matches.length > 1) {
    return { status: "ambiguous", ref: "target:" + key };
  }

  return { status: "resolved", target: matches[0]!.simulatorTarget };
}

export function scalarToSimulatorValue(
  value: ScalarValue,
): SimulatorScalarValue {
  switch (value.kind) {
    case "money":
      return {
        kind: "money",
        amountMinor: value.amountMinor,
        currency: value.currency,
      };
    case "money_rate":
      return {
        kind: "money_rate",
        amountMinor: value.amountMinor,
        currency: value.currency,
        per: value.per,
      };
    case "percentage":
      return { kind: "percentage", basisPoints: value.basisPoints };
    case "quantity":
      return { kind: "quantity", value: value.value, unit: value.unit };
    case "frequency":
      return { kind: "frequency", count: value.count, per: value.per };
    case "boolean":
      return { kind: "boolean", value: value.value };
    case "string":
      return { kind: "string", value: value.value };
  }
}

export type ReferenceResolution =
  | {
      readonly status: "resolved";
      readonly value: SimulatorScalarValue;
      readonly source: "action_explicit" | "translation_context";
      readonly sourceRef: string;
    }
  | { readonly status: "missing"; readonly ref: string }
  | { readonly status: "ambiguous"; readonly ref: string }
  | { readonly status: "unit_mismatch"; readonly ref: string };

export function resolveReference(
  context: TranslationContext,
  action: Action,
  reference: ReferenceValue,
  expectedKind: ScalarValue["kind"],
): ReferenceResolution {
  if (reference.kind === "explicit_baseline") {
    if (reference.value.kind !== expectedKind) {
      return {
        status: "unit_mismatch",
        ref: "action:" + action.actionId + ":explicit_baseline",
      };
    }
    return {
      status: "resolved",
      value: scalarToSimulatorValue(reference.value),
      source: "action_explicit",
      sourceRef: "action:" + action.actionId + ":explicit_baseline",
    };
  }

  const referenceKey = stableKey(reference);
  const matches = context.referenceBindings.filter(
    (binding) =>
      binding.actionId === action.actionId &&
      stableKey(binding.reference) === referenceKey,
  );

  if (matches.length === 0) {
    return {
      status: "missing",
      ref: "reference:" + action.actionId + ":" + referenceKey,
    };
  }
  if (matches.length > 1) {
    return {
      status: "ambiguous",
      ref: "reference:" + action.actionId + ":" + referenceKey,
    };
  }

  const match = matches[0]!;
  if (match.value.kind !== expectedKind) {
    return {
      status: "unit_mismatch",
      ref: "reference:" + action.actionId + ":" + referenceKey,
    };
  }

  return {
    status: "resolved",
    value: scalarToSimulatorValue(match.value),
    source: "translation_context",
    sourceRef: match.sourceRef,
  };
}

export function contextHasCapability(
  context: TranslationContext,
  capability: string,
): boolean {
  return context.capabilities.includes(capability as never);
}


export type PricingMembershipResolution =
  | {
      readonly status: "resolved";
      readonly binding: PricingMembershipBinding;
    }
  | { readonly status: "missing"; readonly ref: string }
  | { readonly status: "ambiguous"; readonly ref: string };

export function resolvePricingMembership(
  context: TranslationContext,
  action: Action,
): PricingMembershipResolution {
  if (
    action.parameters.kind !== "price_adjustment" ||
    !action.parameters.membership ||
    !["product", "category", "collection"].includes(action.target.kind)
  ) {
    return {
      status: "missing",
      ref: "pricing-membership:not-applicable:" + action.actionId,
    };
  }

  const membership = action.parameters.membership;
  const targetKey = stableKey(action.target);
  const matches = (context.pricingMembershipBindings ?? []).filter(
    (binding) =>
      stableKey(binding.actionTarget) === targetKey &&
      binding.evaluateAt === membership.evaluateAt &&
      (!membership.bindingRef ||
        binding.bindingRef === membership.bindingRef),
  );

  const ref =
    "pricing-membership:" +
    action.actionId +
    ":" +
    membership.evaluateAt +
    ":" +
    (membership.bindingRef ?? targetKey);

  if (matches.length === 0) {
    return { status: "missing", ref };
  }
  if (matches.length > 1) {
    return { status: "ambiguous", ref };
  }

  const binding = matches[0]!;
  if (binding.members.length === 0) {
    return { status: "missing", ref };
  }

  return { status: "resolved", binding };
}


export type PromotionMembershipResolution =
  | {
      readonly status: "resolved";
      readonly binding: PromotionMembershipBinding;
    }
  | { readonly status: "missing"; readonly ref: string }
  | { readonly status: "ambiguous"; readonly ref: string };

export function resolvePromotionMembership(
  context: TranslationContext,
  promotionId: string,
  evaluateAt: "decision_time" | "translation_time" | "effective_time",
  bindingRef?: string,
): PromotionMembershipResolution {
  const matches = (context.promotionMembershipBindings ?? []).filter(
    (binding) =>
      binding.promotionId === promotionId &&
      binding.evaluateAt === evaluateAt &&
      (!bindingRef || binding.bindingRef === bindingRef),
  );

  const ref =
    "promotion-membership:" +
    promotionId +
    ":" +
    evaluateAt +
    ":" +
    (bindingRef ?? "unbound");

  if (matches.length === 0) return { status: "missing", ref };
  if (matches.length > 1) return { status: "ambiguous", ref };

  return { status: "resolved", binding: matches[0]! };
}


export type MerchandisingRankingSnapshotResolution =
  | {
      readonly status: "resolved";
      readonly binding: NonNullable<
        TranslationContext["merchandisingRankingSnapshots"]
      >[number];
    }
  | { readonly status: "missing"; readonly ref: string }
  | { readonly status: "ambiguous"; readonly ref: string };

export function resolveMerchandisingRankingSnapshot(
  context: TranslationContext,
  bindingRef: string,
): MerchandisingRankingSnapshotResolution {
  const matches = (context.merchandisingRankingSnapshots ?? []).filter(
    (snapshot) => snapshot.bindingRef === bindingRef,
  );
  const ref = "merchandising-ranking:" + bindingRef;
  if (matches.length === 0) return { status: "missing", ref };
  if (matches.length > 1) return { status: "ambiguous", ref };
  return { status: "resolved", binding: matches[0]! };
}


export type InventoryStateResolution =
  | {
      readonly status: "resolved";
      readonly binding: NonNullable<
        TranslationContext["inventoryStateBindings"]
      >[number];
    }
  | { readonly status: "missing"; readonly ref: string }
  | { readonly status: "ambiguous"; readonly ref: string };

export function resolveInventoryState(
  context: TranslationContext,
  target: ActionTarget,
  inventoryLocationId?: string,
  supplierRelationshipId?: string,
): InventoryStateResolution {
  const key = stableKey({
    target,
    inventoryLocationId,
    supplierRelationshipId,
  });
  const matches = (context.inventoryStateBindings ?? []).filter(
    (binding) =>
      stableKey({
        target: binding.target,
        inventoryLocationId: binding.inventoryLocationId,
        supplierRelationshipId: binding.supplierRelationshipId,
      }) === key,
  );
  const ref = "inventory-state:" + key;
  if (matches.length === 0) return { status: "missing", ref };
  if (matches.length > 1) return { status: "ambiguous", ref };
  return { status: "resolved", binding: matches[0]! };
}


export type CroStructureResolution =
  | {
      readonly status: "resolved";
      readonly binding: NonNullable<
        TranslationContext["croStructureSnapshots"]
      >[number];
    }
  | { readonly status: "missing"; readonly ref: string }
  | { readonly status: "ambiguous"; readonly ref: string };

export function resolveCroStructureSnapshot(
  context:TranslationContext,
  bindingRef:string,
):CroStructureResolution{
  const matches=(context.croStructureSnapshots??[]).filter(
    (snapshot)=>snapshot.bindingRef===bindingRef,
  );
  const ref="cro-structure:"+bindingRef;
  if(matches.length===0)return{status:"missing",ref};
  if(matches.length>1)return{status:"ambiguous",ref};
  return{status:"resolved",binding:matches[0]!};
}
