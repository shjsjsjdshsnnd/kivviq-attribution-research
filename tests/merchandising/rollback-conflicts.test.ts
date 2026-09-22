import { describe, expect, it } from "vitest";
import { assertValidAction } from "../../src/action_ontology/validation.js";
import { evaluateMerchandisingRollbackReadiness } from "../../src/merchandising/rollback.js";
import { assessMerchandisingConflict } from "../../src/merchandising/conflicts.js";
import {
  exclusiveHomepageCollectionY,
  exclusiveHomepageProductX,
  merchandisingRankingSnapshots,
  rollbackTemporaryProductARank,
} from "../../src/merchandising/fixtures.js";

const clone=<T>(v:T):any=>JSON.parse(JSON.stringify(v));

describe("Step 7 merchandising rollback and concurrency",()=>{
  it("restores pre-action rank only while temporary Action still owns current rank",()=>{
    expect(evaluateMerchandisingRollbackReadiness(
      rollbackTemporaryProductARank,
      {currentPosition:1,rankingSnapshots:merchandisingRankingSnapshots}
    )).toMatchObject({
      status:"READY",
      position:8,
      sourceRef:"storefront:collection-x:pre-temp-a"
    });

    expect(evaluateMerchandisingRollbackReadiness(
      rollbackTemporaryProductARank,
      {currentPosition:3,rankingSnapshots:merchandisingRankingSnapshots}
    )).toMatchObject({
      status:"CONFLICT",
      code:"CURRENT_RANK_CHANGED_AFTER_ORIGINAL_ACTION"
    });
  });

  it("returns missing context instead of guessing current rank",()=>{
    expect(evaluateMerchandisingRollbackReadiness(
      rollbackTemporaryProductARank,
      {rankingSnapshots:merchandisingRankingSnapshots}
    )).toMatchObject({
      status:"MISSING_CONTEXT",
      code:"MISSING_CURRENT_POSITION"
    });
  });

  it("detects two Actions targeting the same exclusive homepage slot",()=>{
    expect(assessMerchandisingConflict(
      exclusiveHomepageProductX,
      exclusiveHomepageCollectionY,
    )).toEqual({
      status:"AMBIGUOUS",
      code:"EXCLUSIVE_MERCHANDISING_PLACEMENT_CONFLICT"
    });
  });

  it("resolves same-slot conflicts only when explicit business precedence is supplied",()=>{
    const left=clone(exclusiveHomepageProductX);
    left.actionId="action_merch_precedence_left";
    left.parameters.conflictResolution={kind:"PRECEDENCE",precedence:20};

    const right=clone(exclusiveHomepageCollectionY);
    right.actionId="action_merch_precedence_right";
    right.parameters.conflictResolution={kind:"PRECEDENCE",precedence:10};

    expect(assessMerchandisingConflict(
      assertValidAction(left),
      assertValidAction(right),
    )).toMatchObject({
      status:"RESOLVABLE",
      strategy:"PRECEDENCE",
      winnerActionId:"action_merch_precedence_left"
    });
  });
});
