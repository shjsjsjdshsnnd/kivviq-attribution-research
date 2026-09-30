import { describe, expect, it } from "vitest";
import { actionFingerprint } from "../../src/action_ontology/semantics.js";
import { serializeAction } from "../../src/action_ontology/serialization.js";
import { assertValidAction, validateAction } from "../../src/action_ontology/validation.js";
import type { CroFutureVariantBinding } from "../../src/cro/types.js";
import { reduceSkuA10Percent } from "../../src/pricing/fixtures.js";
import { startProductA100CadOff } from "../../src/promotion/fixtures.js";
import { freeStandardOver150 } from "../../src/shipping/fixtures.js";
import { setProductCPosition1CollectionX } from "../../src/merchandising/fixtures.js";
import {
  addFreeShippingThresholdMessageCart,
  addReviewsToPdp,
  invalidVagueImprovePdpClarity,
  modifyCartCheckoutCtaPresentation,
  modifyCartPromotionEntryPresentation,
  modifyDesktopCollectionGridDensity,
  modifyMobileCollectionGridDensity,
  modifyPdpDeliveryPresentation,
  modifyPdpPriceDisplayPresentation,
  modifyProductAPdpDeliveryPresentation,
  modifyReviewsOnPdp,
  removeReviewsFromPdp,
} from "../../src/cro/fixtures.js";

const clone=<T>(value:T):any=>JSON.parse(JSON.stringify(value));

describe("Step 9 canonical CRO semantic identity",()=>{
  it("distinguishes PDP Add-to-Cart CRO from cart checkout CTA CRO",()=>{
    const pdp=clone(modifyPdpDeliveryPresentation);
    pdp.actionId="action_cro_pdp_atc_identity";
    pdp.target.experienceId="croexp_pdp_atc_identity";
    pdp.parameters.component={component:"ADD_TO_CART"};
    const pdpAction=assertValidAction(pdp);

    expect(actionFingerprint(pdpAction)).not.toBe(
      actionFingerprint(modifyCartCheckoutCtaPresentation),
    );
  });

  it("distinguishes mobile and desktop for the same collection-grid semantics",()=>{
    expect(modifyMobileCollectionGridDensity.parameters.kind).toBe("cro_intervention");
    expect(modifyDesktopCollectionGridDensity.parameters.kind).toBe("cro_intervention");
    expect(actionFingerprint(modifyMobileCollectionGridDensity)).not.toBe(
      actionFingerprint(modifyDesktopCollectionGridDensity),
    );
  });

  it("distinguishes ADD, MODIFY and REMOVE for the same reviews component",()=>{
    const fingerprints=new Set([
      actionFingerprint(addReviewsToPdp),
      actionFingerprint(modifyReviewsOnPdp),
      actionFingerprint(removeReviewsFromPdp),
    ]);
    expect(fingerprints.size).toBe(3);
  });

  it("distinguishes all-PDP from Product A PDP scope",()=>{
    expect(actionFingerprint(modifyPdpDeliveryPresentation)).not.toBe(
      actionFingerprint(modifyProductAPdpDeliveryPresentation),
    );
    expect(serializeAction(modifyPdpDeliveryPresentation)).not.toBe(
      serializeAction(modifyProductAPdpDeliveryPresentation),
    );
  });

  it("keeps CRO collection layout separate from Step 7 merchandising rank",()=>{
    expect(modifyMobileCollectionGridDensity.actionCategory).toBe("cro");
    expect(setProductCPosition1CollectionX.actionCategory).toBe("merchandising");
    expect(actionFingerprint(modifyMobileCollectionGridDensity)).not.toBe(
      actionFingerprint(setProductCPosition1CollectionX),
    );
  });

  it("keeps shipping-message presentation separate from shipping policy",()=>{
    expect(addFreeShippingThresholdMessageCart.actionCategory).toBe("cro");
    expect(freeStandardOver150.actionCategory).toBe("shipping");
    expect(actionFingerprint(addFreeShippingThresholdMessageCart)).not.toBe(
      actionFingerprint(freeStandardOver150),
    );
  });

  it("keeps price-display presentation separate from product pricing",()=>{
    expect(modifyPdpPriceDisplayPresentation.actionCategory).toBe("cro");
    expect(reduceSkuA10Percent.actionCategory).toBe("pricing");
    expect(actionFingerprint(modifyPdpPriceDisplayPresentation)).not.toBe(
      actionFingerprint(reduceSkuA10Percent),
    );
  });

  it("keeps promotion-entry presentation separate from promotion economics",()=>{
    expect(modifyCartPromotionEntryPresentation.actionCategory).toBe("cro");
    expect(startProductA100CadOff.actionCategory).toBe("promotion");
    expect(actionFingerprint(modifyCartPromotionEntryPresentation)).not.toBe(
      actionFingerprint(startProductA100CadOff),
    );
  });

  it("rejects vague executable CRO Actions without typed dimensions",()=>{
    const result=validateAction(invalidVagueImprovePdpClarity);
    expect(result.ok).toBe(false);
    if(!result.ok){
      expect(result.errors.some(
        (issue)=>issue.code==="INVALID_CRO_MODIFIABLE_DIMENSIONS",
      )).toBe(true);
    }
  });

  it("uses existing measurement horizon without expected effects",()=>{
    expect(modifyPdpDeliveryPresentation.measurement).toMatchObject({
      earliestMeaningfulEvaluationSeconds:24*60*60,
      primaryEvaluationSeconds:7*24*60*60,
      outcomes:[{
        family:"conversion",
        metricId:"conversion_rate",
        role:"primary",
      }],
    });
    expect(JSON.stringify(modifyPdpDeliveryPresentation.measurement)).not.toMatch(
      /expected|lift/i,
    );
  });

  it("supports multiple future variants without changing Action semantic identity",()=>{
    const variants:readonly CroFutureVariantBinding[]=[
      {
        variantId:"variant:delivery-larger-block",
        actionId:modifyPdpDeliveryPresentation.actionId,
        boundDimensions:["PROMINENCE","CONTENT_STRUCTURE"],
        implementationRef:"future-variant:delivery-larger-block",
      },
      {
        variantId:"variant:delivery-above-description",
        actionId:modifyPdpDeliveryPresentation.actionId,
        boundDimensions:["POSITION","CONTENT_STRUCTURE"],
        implementationRef:"future-variant:delivery-above-description",
      },
    ];
    const fingerprint=actionFingerprint(modifyPdpDeliveryPresentation);
    expect(variants).toHaveLength(2);
    expect(variants.every((variant)=>variant.actionId===modifyPdpDeliveryPresentation.actionId)).toBe(true);
    expect(actionFingerprint(modifyPdpDeliveryPresentation)).toBe(fingerprint);
    expect("variantPayload" in (modifyPdpDeliveryPresentation.parameters as any)).toBe(false);
  });

  it("rejects experiment-design and provider implementation fields",()=>{
    for(const key of [
      "trafficAllocation",
      "randomizationUnit",
      "significanceThreshold",
      "experimentResult",
      "variantPayload",
      "domSelector",
      "checkoutExtensionId",
      "shopifySectionId",
    ]){
      const invalid=clone(modifyPdpDeliveryPresentation);
      invalid[key]=key==="trafficAllocation"?0.5:"forbidden";
      const result=validateAction(invalid);
      expect(result.ok).toBe(false);
      if(!result.ok){
        expect(result.errors.some(
          (issue)=>issue.code==="FORBIDDEN_ACTION_INFORMATION",
        )).toBe(true);
      }
    }
  });

  it("rejects CRO outcome leakage",()=>{
    for(const key of [
      "expectedConversionRate",
      "expectedConversionLift",
      "expectedRevenue",
      "expectedAOV",
      "expectedBounceReduction",
      "expectedCheckoutCompletion",
      "expectedCTR",
      "predictedLift",
      "predictedRevenue",
      "futureConversion",
      "counterfactualConversion",
      "recommendationScore",
      "confidenceScore",
    ]){
      const invalid=clone(modifyPdpDeliveryPresentation);
      invalid[key]=1;
      const result=validateAction(invalid);
      expect(result.ok).toBe(false);
      if(!result.ok){
        expect(result.errors.some(
          (issue)=>issue.code==="FORBIDDEN_ACTION_INFORMATION",
        )).toBe(true);
      }
    }
  });

  it("rejects 1.7 CRO semantics mislabeled as 1.6",()=>{
    const invalid=clone(modifyPdpDeliveryPresentation);
    invalid.schemaVersion="1.6.0";
    const result=validateAction(invalid);
    expect(result.ok).toBe(false);
    if(!result.ok){
      expect(result.errors.some(
        (issue)=>issue.code==="SCHEMA_FEATURE_REQUIRES_1_7",
      )).toBe(true);
    }
  });
});
