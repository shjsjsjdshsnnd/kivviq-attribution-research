import { describe, expect, it } from "vitest";
import { assertValidAction } from "../../src/action_ontology/validation.js";
import { assessCroConflict } from "../../src/cro/conflicts.js";
import { evaluateCroRollbackReadiness } from "../../src/cro/rollback.js";
import {
  croStateSnapshots,
  placeDeliveryAfterAtc,
  placeReviewsAfterAtc,
  rollbackTemporaryPdpDeliveryReorder,
} from "../../src/cro/fixtures.js";

const clone=<T>(value:T):any=>JSON.parse(JSON.stringify(value));

describe("Step 9 CRO rollback and page-structure conflicts",()=>{
  it("restores pre-action state only while temporary CRO Action still owns current state",()=>{
    expect(evaluateCroRollbackReadiness(
      rollbackTemporaryPdpDeliveryReorder,
      {
        currentStateRef:"cro-state:pdp-delivery-position-7",
        stateSnapshots:croStateSnapshots,
      },
    )).toMatchObject({
      status:"READY",
      stateRef:"cro-state:pdp-delivery-position-8",
      sourceRef:"storefront:pdp-delivery:pre-temp",
    });

    expect(evaluateCroRollbackReadiness(
      rollbackTemporaryPdpDeliveryReorder,
      {
        currentStateRef:"cro-state:pdp-delivery-position-3",
        stateSnapshots:croStateSnapshots,
      },
    )).toMatchObject({
      status:"CONFLICT",
      code:"CURRENT_EXPERIENCE_CHANGED_AFTER_ORIGINAL_ACTION",
    });
  });

  it("returns missing context rather than guessing current CRO state",()=>{
    expect(evaluateCroRollbackReadiness(
      rollbackTemporaryPdpDeliveryReorder,
      { stateSnapshots:croStateSnapshots },
    )).toMatchObject({
      status:"MISSING_CONTEXT",
      code:"MISSING_CURRENT_EXPERIENCE_STATE",
    });
  });

  it("supports SET_EXPLICIT_VALUE as a distinct rollback strategy",()=>{
    const explicit=clone(rollbackTemporaryPdpDeliveryReorder);
    explicit.actionId="action_cro_rollback_pdp_delivery_explicit";
    explicit.parameters.strategy={
      kind:"SET_EXPLICIT_VALUE",
      stateRef:"cro-state:pdp-delivery-position-8",
    };
    const action=assertValidAction(explicit);
    expect(evaluateCroRollbackReadiness(action,{
      currentStateRef:"cro-state:pdp-delivery-position-7",
    })).toMatchObject({
      status:"READY",
      stateRef:"cro-state:pdp-delivery-position-8",
      sourceRef:"action:explicit-cro-rollback-state",
    });
  });

  it("detects incompatible placements directly after the same component",()=>{
    expect(assessCroConflict(
      placeReviewsAfterAtc,
      placeDeliveryAfterAtc,
    )).toEqual({
      status:"AMBIGUOUS",
      code:"CRO_PAGE_STRUCTURE_CONFLICT",
    });
  });

  it("resolves structural conflict only with explicit business precedence",()=>{
    const left=clone(placeReviewsAfterAtc);
    left.actionId="action_cro_conflict_left";
    left.parameters.conflictResolution={kind:"PRECEDENCE",precedence:20};
    const right=clone(placeDeliveryAfterAtc);
    right.actionId="action_cro_conflict_right";
    right.parameters.conflictResolution={kind:"PRECEDENCE",precedence:10};

    expect(assessCroConflict(
      assertValidAction(left),
      assertValidAction(right),
    )).toMatchObject({
      status:"RESOLVABLE",
      strategy:"PRECEDENCE",
      winnerActionId:"action_cro_conflict_left",
    });
  });
});
