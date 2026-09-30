import { describe, expect, it } from "vitest";
import {
  addCheckoutProgressIndicator,
  addFeaturedCollectionHomepage,
  addFreeShippingThresholdMessageCart,
  addSiteSearchAutocomplete,
  modifyCartLayout,
  modifyCheckoutErrorPresentation,
  modifyCheckoutFormStructure,
  modifyCollectionFilters,
  modifyCollectionProductCardPresentation,
  modifyHomepageHeroPresentation,
  modifyLandingPageCta,
  modifyMobileCollectionGridDensity,
  modifyMobileNavigation,
  modifyPdpGalleryInteraction,
  modifySearchNoResults,
  removeLandingPageNavigation,
  removeOptionalCheckoutField,
} from "../../src/cro/fixtures.js";

describe("Step 9 CRO canonical surface coverage",()=>{
  it("covers homepage, collection, PDP, cart, checkout, site search, landing page and site-wide navigation",()=>{
    const actions=[
      modifyHomepageHeroPresentation,
      addFeaturedCollectionHomepage,
      modifyCollectionProductCardPresentation,
      modifyCollectionFilters,
      modifyMobileCollectionGridDensity,
      modifyPdpGalleryInteraction,
      modifyCartLayout,
      addFreeShippingThresholdMessageCart,
      modifyCheckoutFormStructure,
      removeOptionalCheckoutField,
      addCheckoutProgressIndicator,
      modifyCheckoutErrorPresentation,
      addSiteSearchAutocomplete,
      modifySearchNoResults,
      modifyLandingPageCta,
      removeLandingPageNavigation,
      modifyMobileNavigation,
    ];
    const surfaces=new Set(actions.map((action)=>
      action.parameters.kind==="cro_intervention"
        ? action.parameters.surface
        : "rollback",
    ));
    expect(surfaces).toEqual(new Set([
      "SITE_WIDE",
      "HOMEPAGE",
      "COLLECTION",
      "PDP",
      "CART",
      "CHECKOUT",
      "SITE_SEARCH",
      "LANDING_PAGE",
    ]));
  });

  it("keeps device separate from surface",()=>{
    if(modifyMobileCollectionGridDensity.parameters.kind!=="cro_intervention")return;
    expect(modifyMobileCollectionGridDensity.parameters.surface).toBe("COLLECTION");
    expect(modifyMobileCollectionGridDensity.parameters.device).toBe("MOBILE");
    expect(modifyMobileCollectionGridDensity.parameters.surface).not.toBe(
      "MOBILE_COLLECTION",
    );
  });
});
