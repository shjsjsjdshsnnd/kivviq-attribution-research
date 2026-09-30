import { describe, expect, it } from "vitest";
import { assertValidAction } from "../../src/action_ontology/validation.js";
import { assessLifecycleFlowConflict } from "../../src/lifecycle/conflicts.js";
import { evaluateLifecycleRollbackReadiness } from "../../src/lifecycle/rollback.js";
import {
  lifecyclePolicySnapshots,
  retentionDay90CompetingFlow,
  rollbackTemporaryEmailFrequency,
  temporaryEmailCadenceExpectedValue,
  temporaryEmailCadencePreviousValue,
  winback90DayEmailFlow,
} from "../../src/lifecycle/fixtures.js";

const clone=<T>(value:T):any=>JSON.parse(JSON.stringify(value));

describe("Step 10 lifecycle rollback and flow concurrency",()=>{
  it("restores prior lifecycle policy only while temporary Action still owns current state",()=>{
    expect(evaluateLifecycleRollbackReadiness(
      rollbackTemporaryEmailFrequency,
      {currentValue:temporaryEmailCadenceExpectedValue},
    )).toMatchObject({
      status:"READY",
      value:temporaryEmailCadencePreviousValue,
      sourceRef:"action:explicit-pre-action-lifecycle-policy",
    });

    const laterPolicy=clone(temporaryEmailCadenceExpectedValue);
    laterPolicy.policy.operation.value.count=4;
    expect(evaluateLifecycleRollbackReadiness(
      rollbackTemporaryEmailFrequency,
      {currentValue:laterPolicy},
    )).toMatchObject({
      status:"CONFLICT",
      code:"CURRENT_LIFECYCLE_POLICY_CHANGED_AFTER_ORIGINAL_ACTION",
    });
  });

  it("returns missing context rather than guessing current lifecycle policy",()=>{
    expect(evaluateLifecycleRollbackReadiness(
      rollbackTemporaryEmailFrequency,
      {},
    )).toMatchObject({
      status:"MISSING_CONTEXT",
      code:"MISSING_CURRENT_LIFECYCLE_POLICY",
    });
  });

  it("can restore from a frozen lifecycle policy snapshot",()=>{
    const snapshotRollback=clone(rollbackTemporaryEmailFrequency);
    snapshotRollback.actionId="action_lifecycle_rollback_email_frequency_snapshot";
    snapshotRollback.parameters.strategy={
      kind:"RESTORE_PRE_ACTION_VALUE",
      preActionValue:{
        kind:"lifecycle_policy_snapshot",
        baselineId:"lifecycle-policy:email-cadence:pre-temp",
      },
    };
    const action=assertValidAction(snapshotRollback);
    expect(evaluateLifecycleRollbackReadiness(action,{
      currentValue:temporaryEmailCadenceExpectedValue,
      policySnapshots:lifecyclePolicySnapshots,
    })).toMatchObject({
      status:"READY",
      value:temporaryEmailCadencePreviousValue,
      sourceRef:"lifecycle-policy-snapshot:email-cadence",
    });
  });

  it("detects competing Day-90 contacts and resolves them through contact policy",()=>{
    expect(assessLifecycleFlowConflict(
      winback90DayEmailFlow,
      retentionDay90CompetingFlow,
    )).toEqual({
      status:"RESOLVABLE",
      strategy:"CONTACT_POLICY",
    });
  });

  it("resolves competing flows with explicit business precedence",()=>{
    const left=clone(winback90DayEmailFlow);
    left.actionId="action_lifecycle_winback_precedence";
    left.target.flowId="lifecycleflow_winback_precedence";
    left.parameters.definition.flowId="lifecycleflow_winback_precedence";
    left.parameters.definition.conflictResolution={
      kind:"PRECEDENCE",
      precedence:20,
    };

    const right=clone(retentionDay90CompetingFlow);
    right.actionId="action_lifecycle_retention_precedence";
    right.target.flowId="lifecycleflow_retention_precedence";
    right.parameters.definition.flowId="lifecycleflow_retention_precedence";
    right.parameters.definition.conflictResolution={
      kind:"PRECEDENCE",
      precedence:10,
    };

    expect(assessLifecycleFlowConflict(
      assertValidAction(left),
      assertValidAction(right),
    )).toMatchObject({
      status:"RESOLVABLE",
      strategy:"PRECEDENCE",
      winnerActionId:"action_lifecycle_winback_precedence",
    });
  });
});
