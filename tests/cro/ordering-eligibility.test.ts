import { describe, expect, it } from "vitest";
import { assertValidAction } from "../../src/action_ontology/validation.js";
import { evaluateCroEligibility } from "../../src/cro/eligibility.js";
import { resolveCroOrdering } from "../../src/cro/ordering.js";
import {
  addReviewsToPdp,
  addSiteSearchAutocomplete,
  croExperienceStates,
  croStructureSnapshots,
  improveMobilePdpLoadingPerformance,
  modifyLandingPageCtaVipSegment,
  modifyPdpDeliveryPresentation,
  movePdpDeliveryAboveDescription,
  removeReviewsMissingComponent,
  reorderWithUnavailableStructure,
  setPdpReviewsPosition2,
} from "../../src/cro/fixtures.js";

const clone=<T>(value:T):any=>JSON.parse(JSON.stringify(value));

describe("Step 9 CRO ordering and eligibility",()=>{
  it("resolves relational ordering against frozen component structure",()=>{
    const result=resolveCroOrdering(
      movePdpDeliveryAboveDescription,
      croStructureSnapshots,
    );
    expect(result).toMatchObject({
      status:"RESOLVED",
      currentPosition:8,
      targetPosition:7,
      snapshotRef:"cro-structure:pdp-default",
    });
    if(result.status==="RESOLVED"){
      expect(result.resultingOrder?.[6]).toEqual({
        component:"DELIVERY_INFORMATION",
      });
    }
  });

  it("preserves absolute SET position without inventing a structure snapshot",()=>{
    expect(resolveCroOrdering(setPdpReviewsPosition2,[])).toEqual({
      status:"RESOLVED",
      targetPosition:2,
    });
  });

  it("returns explicit missing context for unavailable relative ordering snapshot",()=>{
    expect(resolveCroOrdering(
      reorderWithUnavailableStructure,
      croStructureSnapshots,
    )).toMatchObject({
      status:"MISSING_CONTEXT",
      code:"MISSING_CRO_STRUCTURE_SNAPSHOT",
      missingRef:"cro-structure:missing",
    });
  });

  it("allows ADD when component is absent and capability exists",()=>{
    expect(evaluateCroEligibility(addReviewsToPdp,{
      experiences:croExperienceStates,
      structures:croStructureSnapshots,
    }).status).toBe("eligible");
  });

  it("rejects ADD-as-MODIFY when component already exists",()=>{
    const duplicate=clone(addReviewsToPdp);
    duplicate.actionId="action_cro_pdp_add_reviews_duplicate";
    duplicate.target.experienceId="croexp_pdp_reviews_duplicate";
    duplicate.parameters.pageScope={kind:"ALL_PDP"};
    const action=assertValidAction(duplicate);
    expect(evaluateCroEligibility(action,{
      experiences:croExperienceStates,
      structures:croStructureSnapshots,
    })).toMatchObject({
      status:"ineligible",
      reasonCodes:["CRO_COMPONENT_ALREADY_EXISTS"],
    });
  });

  it("rejects REMOVE when current component does not exist",()=>{
    expect(evaluateCroEligibility(removeReviewsMissingComponent,{
      experiences:croExperienceStates,
    })).toMatchObject({
      status:"ineligible",
      reasonCodes:["CRO_COMPONENT_NOT_PRESENT"],
    });
  });

  it("returns unknown when required page/template context is unavailable",()=>{
    expect(evaluateCroEligibility(modifyPdpDeliveryPresentation,{
      experiences:[],
    })).toMatchObject({
      status:"unknown",
      reasonCodes:["CRO_EXPERIENCE_CONTEXT_UNKNOWN"],
    });
  });

  it("requires declared surface capability",()=>{
    const search=croExperienceStates.find(
      (experience)=>experience.surface==="SITE_SEARCH",
    )!;
    const withoutAutocomplete={
      ...search,
      capabilities:search.capabilities.filter(
        (capability)=>capability!=="AUTOCOMPLETE",
      ),
    };
    expect(evaluateCroEligibility(addSiteSearchAutocomplete,{
      experiences:[withoutAutocomplete],
    })).toMatchObject({
      status:"ineligible",
      reasonCodes:["CRO_SURFACE_CAPABILITY_UNAVAILABLE"],
      missingInformation:["AUTOCOMPLETE"],
    });
  });

  it("preserves audience membership as unknown rather than guessing personalization",()=>{
    expect(evaluateCroEligibility(modifyLandingPageCtaVipSegment,{
      experiences:croExperienceStates,
    })).toMatchObject({
      status:"unknown",
      reasonCodes:["CRO_AUDIENCE_MEMBERSHIP_UNKNOWN"],
    });
    expect(evaluateCroEligibility(modifyLandingPageCtaVipSegment,{
      experiences:croExperienceStates,
      audienceMembershipBindingRefs:["cro-audience:vip-a:decision"],
    }).status).toBe("eligible");
  });

  it("requires current performance configuration for performance intervention",()=>{
    expect(evaluateCroEligibility(improveMobilePdpLoadingPerformance,{
      experiences:croExperienceStates,
    }).status).toBe("eligible");

    const mobilePdp=croExperienceStates.find(
      (experience)=>
        experience.surface==="PDP"&&experience.device==="MOBILE",
    )!;
    const { performanceConfigurationRef: _discard, ...withoutPerformance } =
      mobilePdp;
    expect(evaluateCroEligibility(improveMobilePdpLoadingPerformance,{
      experiences:[withoutPerformance],
    })).toMatchObject({
      status:"unknown",
      reasonCodes:["CRO_PERFORMANCE_CONFIGURATION_UNKNOWN"],
    });
  });
});
