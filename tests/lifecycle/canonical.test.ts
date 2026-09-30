import { describe, expect, it } from "vitest";
import {
  lifecycleWhatSchema,
  lifecycleFlowConfigurationSchema,
  reduceLifecycleFlow,
  evaluateLifecycleFlow,
  lifecycleReversibility,
  guardLifecycleRollback,
} from "../../src/lifecycle/canonical.js";
import { postPurchaseFourteenDaysTiming as timing } from "../../src/action_timing/fixtures.js";
const population = {
  populationId: "population_a",
  version: 1,
  definitionFingerprint: "fnv1a64:0123456789abcdef",
  binding: "TRIGGER_TIME",
  membershipMode: "DYNAMIC_MEMBERSHIP",
} as const;
const step = (
  stepId: string,
  order: number,
  channel: "EMAIL" | "SMS" = "EMAIL",
) => ({
  stepId,
  order,
  channel,
  timing,
  population,
  eligibility: ["consent"],
  suppression: ["blocked"],
  exitConditions: ["COMPLETED_PURCHASE"],
});
const flow = {
  flowId: "lifecycleflow_123",
  purpose: "WINBACK",
  trigger: { kind: "DAYS_SINCE_LAST_COMPLETED_PURCHASE", days: 90 },
  steps: [step("step_1", 1), step("step_2", 2, "SMS")],
} as const;
describe("canonical lifecycle WHAT", () => {
  it("never treats malformed or absent timing readiness as READY", () => {
    const state = reduceLifecycleFlow(undefined, {
      actionType: "lifecycle.start_flow",
      flow,
    });
    for (const timing of [undefined, "yes", true]) {
      const evidence = {
        completedPurchase: "FALSE",
        steps: {
          step_1: { eligibility: "ELIGIBLE", suppression: "FALSE", timing },
        },
      };
      expect(
        evaluateLifecycleFlow(
          state,
          evidence as unknown as import("../../src/lifecycle/canonical.js").LifecycleFlowEvidence,
        ).kind,
      ).toBe("UNKNOWN");
    }
  });
  it("separates send from population, timing and provider execution", () => {
    const send = {
      actionType: "lifecycle.send",
      channel: "EMAIL",
      purpose: "WINBACK",
    };
    expect(lifecycleWhatSchema.safeParse(send).success).toBe(true);
    for (const key of [
      "population",
      "timing",
      "provider",
      "expectedOpenRate",
      "expectedClickRate",
      "expectedConversion",
      "expectedRevenue",
      "expectedProfit",
      "expectedRetentionLift",
      "expectedLTV",
      "predictedChurn",
      "predictedOptimalSendTime",
      "responseProbability",
      "bestAudience",
      "recommendedTreatment",
      "recommendationScore",
      "confidenceScore",
      "futurePurchase",
      "counterfactualRevenue",
    ])
      expect(lifecycleWhatSchema.safeParse({ ...send, [key]: 1 }).success).toBe(
        false,
      );
  });
  it("keeps cadence distinct from contact policy and requires a period", () => {
    expect(
      lifecycleWhatSchema.safeParse({
        actionType: "lifecycle.adjust_frequency",
        channel: "EMAIL",
        operation: {
          kind: "DELTA",
          count: 1,
          period: { amount: 1, unit: "WEEK" },
        },
      }).success,
    ).toBe(true);
    expect(
      lifecycleWhatSchema.safeParse({
        actionType: "lifecycle.adjust_frequency",
        channel: "EMAIL",
        operation: { kind: "SET", count: 3 },
      }).success,
    ).toBe(false);
    expect(
      lifecycleWhatSchema.safeParse({
        actionType: "lifecycle.adjust_contact_policy",
        policyId: "policy_1",
        policy: {
          kind: "CONTACT_CAP",
          channels: ["EMAIL", "SMS"],
          purpose: "PROMOTIONAL",
          maximum: 4,
          period: { amount: 7, unit: "DAY" },
        },
      }).success,
    ).toBe(true);
  });
  it("enforces stable unique ordered flow steps and nested leakage guards", () => {
    expect(lifecycleFlowConfigurationSchema.safeParse(flow).success).toBe(true);
    expect(
      lifecycleFlowConfigurationSchema.safeParse({
        ...flow,
        steps: [step("x", 2), step("x", 1)],
      }).success,
    ).toBe(false);
    expect(
      lifecycleFlowConfigurationSchema.safeParse({
        ...flow,
        steps: [{ ...step("x", 1), predictedChurn: 1 }],
      }).success,
    ).toBe(false);
  });
  it("stops future sends, preserves sent history, and requires explicit restart", () => {
    const started = reduceLifecycleFlow(undefined, {
      actionType: "lifecycle.start_flow",
      flow,
    });
    const sent = { ...started, sentStepIds: ["step_1"] };
    const stopped = reduceLifecycleFlow(sent, {
      actionType: "lifecycle.stop_flow",
      flowId: flow.flowId,
    });
    expect(stopped.status).toBe("STOPPED");
    expect(stopped.sentStepIds).toEqual(["step_1"]);
    expect(
      evaluateLifecycleFlow(stopped, { completedPurchase: "FALSE", steps: {} }),
    ).toEqual({ kind: "STOPPED" });
  });
  it("exits on purchase, fails closed on unknown, otherwise chooses next eligible step", () => {
    const state = reduceLifecycleFlow(undefined, {
      actionType: "lifecycle.start_flow",
      flow,
    });
    expect(
      evaluateLifecycleFlow(state, { completedPurchase: "TRUE", steps: {} }),
    ).toEqual({ kind: "EXIT" });
    expect(
      evaluateLifecycleFlow(state, { completedPurchase: "UNKNOWN", steps: {} }),
    ).toEqual({ kind: "UNKNOWN" });
    expect(
      evaluateLifecycleFlow(state, {
        completedPurchase: "FALSE",
        steps: {
          step_1: {
            eligibility: "INELIGIBLE",
            suppression: "FALSE",
            timing: "READY",
          },
          step_2: {
            eligibility: "ELIGIBLE",
            suppression: "FALSE",
            timing: "READY",
          },
        },
      }),
    ).toEqual({ kind: "NEXT_STEP", stepId: "step_2" });
    expect(
      evaluateLifecycleFlow(state, {
        completedPurchase: "FALSE",
        steps: {
          step_1: {
            eligibility: "UNKNOWN",
            suppression: "FALSE",
            timing: "READY",
          },
        },
      }),
    ).toEqual({ kind: "UNKNOWN" });
  });
  it("modifies threshold and steps only under a matching current configuration guard", () => {
    const state = reduceLifecycleFlow(undefined, {
      actionType: "lifecycle.start_flow",
      flow,
    });
    const modified = reduceLifecycleFlow(state, {
      actionType: "lifecycle.modify_flow",
      flowId: flow.flowId,
      expectedCurrent: flow,
      changes: [
        { kind: "SET_THRESHOLD", days: 75 },
        { kind: "REMOVE_STEP", stepId: "step_2" },
        { kind: "ADD_STEP", step: step("step_3", 3, "SMS") },
        { kind: "SET_STEP_TIMING", stepId: "step_1", timing },
      ],
    });
    expect(modified.configuration.trigger).toEqual({
      kind: "DAYS_SINCE_LAST_COMPLETED_PURCHASE",
      days: 75,
    });
    expect(modified.configuration.steps.map((s) => s.stepId)).toEqual([
      "step_1",
      "step_3",
    ]);
    expect(() =>
      reduceLifecycleFlow(modified, {
        actionType: "lifecycle.modify_flow",
        flowId: flow.flowId,
        expectedCurrent: flow,
        changes: [{ kind: "SET_THRESHOLD", days: 60 }],
      }),
    ).toThrow("CONFLICT");
  });
  it("derives irreversible sent communication and guards configuration rollback", () => {
    expect(
      lifecycleReversibility(
        { actionType: "lifecycle.send", channel: "SMS", purpose: "RETENTION" },
        "SENT",
      ),
    ).toBe("IRREVERSIBLE");
    const value = { kind: "FLOW_CONFIGURATION", flow };
    const rollback = {
      actionType: "lifecycle.rollback_policy",
      targetId: flow.flowId,
      expectedCurrent: value,
      restore: value,
    };
    expect(lifecycleWhatSchema.safeParse(rollback).success).toBe(true);
    expect(guardLifecycleRollback(rollback, value).ok).toBe(true);
    expect(
      guardLifecycleRollback(rollback, {
        ...value,
        flow: {
          ...flow,
          trigger: { kind: "DAYS_SINCE_LAST_COMPLETED_PURCHASE", days: 75 },
        },
      }).ok,
    ).toBe(false);
  });
});

it("rejects rollback type/identity mismatches at canonical validation", () => {
  const value = { kind: "FLOW_CONFIGURATION", flow };
  expect(
    lifecycleWhatSchema.safeParse({
      actionType: "lifecycle.rollback_policy",
      targetId: "other_flow",
      expectedCurrent: value,
      restore: value,
    }).success,
  ).toBe(false);
  expect(
    lifecycleWhatSchema.safeParse({
      actionType: "lifecycle.rollback_policy",
      targetId: flow.flowId,
      expectedCurrent: value,
      restore: {
        kind: "CADENCE",
        targetId: flow.flowId,
        channel: "EMAIL",
        cadence: { count: 3, period: { amount: 1, unit: "WEEK" } },
      },
    }).success,
  ).toBe(false);
});
it("rejects modifications whose guard identifies another flow", () => {
  expect(
    lifecycleWhatSchema.safeParse({
      actionType: "lifecycle.modify_flow",
      flowId: "other_flow",
      expectedCurrent: flow,
      changes: [{ kind: "SET_THRESHOLD", days: 75 }],
    }).success,
  ).toBe(false);
});
it("cannot bypass a future step or unknown suppression and never repeats recorded sends", () => {
  const state = reduceLifecycleFlow(undefined, {
    actionType: "lifecycle.start_flow",
    flow,
  });
  expect(
    evaluateLifecycleFlow(state, {
      completedPurchase: "FALSE",
      steps: {
        step_1: {
          eligibility: "ELIGIBLE",
          suppression: "FALSE",
          timing: "NOT_READY",
        },
        step_2: {
          eligibility: "ELIGIBLE",
          suppression: "FALSE",
          timing: "READY",
        },
      },
    }),
  ).toEqual({ kind: "WAIT" });
  expect(
    evaluateLifecycleFlow(state, {
      completedPurchase: "FALSE",
      steps: {
        step_1: {
          eligibility: "ELIGIBLE",
          suppression: "UNKNOWN",
          timing: "READY",
        },
      },
    }),
  ).toEqual({ kind: "UNKNOWN" });
  expect(
    evaluateLifecycleFlow(
      { ...state, sentStepIds: ["step_1", "step_2"] },
      { completedPurchase: "FALSE", steps: {} },
    ),
  ).toEqual({ kind: "COMPLETE" });
});
it("guards nested step timing, population references and policy values against leakage", () => {
  for (const key of [
    "expectedRevenue",
    "confidenceScore",
    "futurePurchase",
    "predictedOptimalSendTime",
  ]) {
    expect(
      lifecycleFlowConfigurationSchema.safeParse({
        ...flow,
        steps: [{ ...step("s", 1), timing: { ...timing, [key]: 1 } }],
      }).success,
    ).toBe(false);
    expect(
      lifecycleFlowConfigurationSchema.safeParse({
        ...flow,
        steps: [{ ...step("s", 1), population: { ...population, [key]: 1 } }],
      }).success,
    ).toBe(false);
    expect(
      lifecycleWhatSchema.safeParse({
        actionType: "lifecycle.adjust_contact_policy",
        policyId: "p",
        policy: {
          kind: "MINIMUM_SPACING",
          channels: ["SMS"],
          purpose: "PROMOTIONAL",
          hours: 48,
          [key]: 1,
        },
      }).success,
    ).toBe(false);
  }
});
it("restores a flow without reopening stopped sends or deleting delivery history", () => {
  const state = reduceLifecycleFlow(undefined, {
    actionType: "lifecycle.start_flow",
    flow,
  });
  const modified = reduceLifecycleFlow(state, {
    actionType: "lifecycle.modify_flow",
    flowId: flow.flowId,
    expectedCurrent: flow,
    changes: [{ kind: "SET_THRESHOLD", days: 75 }],
  });
  const stopped = reduceLifecycleFlow(
    { ...modified, sentStepIds: ["step_1"] },
    { actionType: "lifecycle.stop_flow", flowId: flow.flowId },
  );
  const restored = reduceLifecycleFlow(stopped, {
    actionType: "lifecycle.rollback_policy",
    targetId: flow.flowId,
    expectedCurrent: {
      kind: "FLOW_CONFIGURATION",
      flow: modified.configuration,
    },
    restore: { kind: "FLOW_CONFIGURATION", flow },
  });
  expect(restored.configuration).toEqual(flow);
  expect(restored.status).toBe("STOPPED");
  expect(restored.sentStepIds).toEqual(["step_1"]);
});
it("cannot restore a contact policy or cadence using another target current value", () => {
  const policy = {
    kind: "CONTACT_CAP",
    channels: ["EMAIL"],
    purpose: "MARKETING",
    maximum: 3,
    period: { amount: 7, unit: "DAY" },
  };
  for (const value of [
    { kind: "CONTACT_POLICY", targetId: "policy_a", policy },
    {
      kind: "CADENCE",
      targetId: "policy_a",
      channel: "EMAIL",
      cadence: { count: 3, period: { amount: 1, unit: "WEEK" } },
    },
  ]) {
    const matching = {
      actionType: "lifecycle.rollback_policy",
      targetId: "policy_a",
      expectedCurrent: value,
      restore: value,
    };
    expect(lifecycleWhatSchema.safeParse(matching).success).toBe(true);
    expect(guardLifecycleRollback(matching, value).ok).toBe(true);
    expect(
      lifecycleWhatSchema.safeParse({ ...matching, targetId: "policy_b" })
        .success,
    ).toBe(false);
    expect(
      lifecycleWhatSchema.safeParse({
        ...matching,
        restore: { ...value, targetId: "policy_b" },
      }).success,
    ).toBe(false);
    expect(
      guardLifecycleRollback(matching, { ...value, targetId: "policy_b" }).ok,
    ).toBe(false);
  }
});
