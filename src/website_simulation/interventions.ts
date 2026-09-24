import type {
  CanonicalWebsiteDevice,
  DeviceExperienceState,
  WebsiteIntervention,
  WebsiteState,
} from "./types.js";
import { validateWebsiteState } from "./model.js";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function patchDeviceLoadTime(
  state: WebsiteState,
  device: CanonicalWebsiteDevice,
  surface: Exclude<keyof DeviceExperienceState, "navigation">,
  targetLoadTimeMs: number,
): WebsiteState {
  const next = clone(state) as WebsiteState;
  const mutable = next as unknown as {
    deviceExperience: {
      mobile: Record<string, DeviceExperienceState[keyof DeviceExperienceState]>;
      desktop: Record<string, DeviceExperienceState[keyof DeviceExperienceState]>;
    };
  };
  mutable.deviceExperience[device][surface] = {
    ...mutable.deviceExperience[device][surface]!,
    loadTimeMs: targetLoadTimeMs,
  };
  return next;
}

/**
 * Step 12 integration hook for already-canonical CRO actions.
 *
 * This deliberately does not define or import Action Ontology entries.
 * A future adapter can translate a frozen canonical Action into one of these
 * website parameter mutations.
 */
export function applyWebsiteIntervention(
  state: WebsiteState,
  intervention: WebsiteIntervention,
): WebsiteState {
  let next = clone(state);

  switch (intervention.kind) {
    case "IMPROVE_PAGE_SPEED": {
      const devices: readonly CanonicalWebsiteDevice[] =
        intervention.device === undefined
          ? ["mobile", "desktop"]
          : [intervention.device];
      for (const device of devices) {
        next = patchDeviceLoadTime(
          next,
          device,
          intervention.surface,
          intervention.targetLoadTimeMs,
        );
      }
      break;
    }
    case "CHANGE_COLLECTION_SORT": {
      const mutable = next as unknown as {
        collections: WebsiteState["collections"];
      };
      mutable.collections = {
        ...next.collections,
        sortQuality: intervention.sortQuality,
        productRankingRelevance:
          intervention.productRankingRelevance,
      };
      break;
    }
    case "FIX_SEARCH": {
      const mutable = next as unknown as {
        search: WebsiteState["search"];
      };
      mutable.search = {
        ...next.search,
        resultRelevance: intervention.resultRelevance,
        zeroResultRate: intervention.zeroResultRate,
        typoTolerance: intervention.typoTolerance,
        synonymHandling: intervention.synonymHandling,
      };
      break;
    }
    case "IMPROVE_PRODUCT_IMAGERY": {
      const mutable = next as unknown as {
        pdp: WebsiteState["pdp"];
      };
      mutable.pdp = {
        ...next.pdp,
        imageQuality: intervention.imageQuality,
        imageQuantity: intervention.imageQuantity,
      };
      break;
    }
    case "REDUCE_CHECKOUT_FRICTION": {
      const mutable = next as unknown as {
        checkout: WebsiteState["checkout"];
      };
      mutable.checkout = {
        ...next.checkout,
        formComplexity: intervention.formComplexity,
        numberOfSteps: intervention.numberOfSteps,
        errorRate: intervention.errorRate,
      };
      break;
    }
    case "FIX_COUPON": {
      const mutable = next as unknown as {
        checkout: WebsiteState["checkout"];
        cart: WebsiteState["cart"];
      };
      mutable.checkout = {
        ...next.checkout,
        couponReliability: intervention.couponReliability,
      };
      mutable.cart = {
        ...next.cart,
        discountCodeUsability:
          intervention.discountCodeUsability,
      };
      break;
    }
    case "SURFACE_SHIPPING_EARLIER": {
      const mutable = next as unknown as {
        checkout: WebsiteState["checkout"];
        cart: WebsiteState["cart"];
      };
      mutable.cart = {
        ...next.cart,
        shippingVisibility:
          intervention.cartShippingVisibility,
      };
      mutable.checkout = {
        ...next.checkout,
        shippingCostSurprise:
          intervention.checkoutShippingCostSurprise,
        shippingSpeedClarity:
          intervention.shippingSpeedClarity,
      };
      break;
    }
  }

  validateWebsiteState(next);
  return next;
}
