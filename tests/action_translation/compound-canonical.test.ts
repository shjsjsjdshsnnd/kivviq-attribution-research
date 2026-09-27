import { describe, expect, it } from "vitest";
import { translateCanonicalCompoundAction } from "../../src/action_translation/compound.js";
import { fridaySevenDayBudgetTiming, immediatePersistentBudgetTiming } from "../../src/action_timing/fixtures.js";
import { createCompoundFixtures } from "../../src/compound_action/fixtures.js";
import {
  investigationExamples,
  noOpExamples,
} from "../../src/decision_forms/fixtures.js";
import { canonicalActionSchema } from "../../src/canonical_action/schema.js";
import { fingerprintCanonicalAction } from "../../src/canonical_action/serialization.js";
import { fingerprintCompoundAction } from "../../src/compound_action/schema.js";
import { evaluatePopulation, fingerprintPopulationDefinition } from "../../src/population/index.js";

const timing = { approvedClock: "2026-09-27T00:00:00Z" };
function fixture() {
  const action = structuredClone(createCompoundFixtures()[7]!.action);
  action.components = [
    noOpExamples.global,
    investigationExamples.missingCogs,
  ].map((what, i) => ({
    componentId: `component_${i}`,
    role: `ROLE_${i}`,
    action: canonicalActionSchema.parse({
      schemaVersion: "2.0.0",
      actionId: `action_${i}`,
      what,
      timing: {
        ...immediatePersistentBudgetTiming,
        ...(i === 1
          ? {
              duration: {
                state: "SPECIFIED",
                value: investigationExamples.missingCogs.expectedDuration,
              },
              end: {
                state: "SPECIFIED",
                value: { kind: "DERIVE_FROM_DURATION" },
              },
            }
          : {}),
      },
      provenance: ["evidence_fixture"],
    }),
  }));
  return action;
}
function context(action = fixture()) {
  return {
    timing,
    components: { component_0: {}, component_1: {} },
    readiness: {
      eligibilityResults: Object.fromEntries(action.components.map((component) => [component.componentId, {
        actionId: component.action.actionId,
        actionFingerprint: fingerprintCanonicalAction(component.action),
        evaluatedAt: "2026-09-27T00:00:00Z",
        evaluationBoundary: "TRANSLATION_TIME",
        status: "ELIGIBLE",
        checks: [],
      }])),
      components: {
        component_0: { status: "READY", evidenceRefs: ["evidence_ready"] },
        component_1: { status: "READY", evidenceRefs: ["evidence_ready"] },
      },
    },
  };
}
describe("canonical compound translation", () => {
  it("preserves an experiment component and a compound arm as an exact engine task", () => {
    const action = fixture();
    const armCompound = createCompoundFixtures()[0]!.action;
    const control = action.components[0]!.action;
    const definition = {
      schemaVersion: 1 as const,
      populationId: "population_compound_experiment",
      version: 1,
      universe: "ALL_CUSTOMERS" as const,
      inclusion: { kind: "COMPLETED_ORDER_COUNT" as const, operator: "GTE" as const, value: 0 },
      exclusions: [],
      membershipMode: "DYNAMIC_MEMBERSHIP" as const,
      binding: "DECISION_TIME" as const,
      provenance: ["evidence_population"],
    };
    const population = { populationId: definition.populationId, version: 1, definitionFingerprint: fingerprintPopulationDefinition(definition), binding: definition.binding, membershipMode: definition.membershipMode };
    const experiment = canonicalActionSchema.parse({
      schemaVersion: "2.0.0",
      actionId: "action_compound_experiment_component",
      population,
      timing: fridaySevenDayBudgetTiming,
      provenance: ["evidence_experiment"],
      what: {
        actionType: "experiment.run",
        hypothesisRef: "hypothesis.compound",
        primaryMetricRef: "metric.conversion",
        randomizationUnit: "CUSTOMER",
        assignmentBoundary: { kind: "USE_ENVELOPE_POPULATION_BINDING" },
        arms: [
          { armId: "arm_control", role: "CONTROL", actionId: control.actionId, actionFingerprint: fingerprintCanonicalAction(control), allocationBasisPoints: 5000 },
          { entityKind: "COMPOUND", armId: "arm_compound", role: "TREATMENT", compoundActionId: armCompound.compoundActionId, actionFingerprint: fingerprintCompoundAction(armCompound), allocationBasisPoints: 5000 },
        ],
        stopping: { kind: "FIXED", sampleTarget: 10, timingHorizon: "ENVELOPE_TIMING" },
        measurementWindow: { start: "2026-09-25T04:00:00Z", end: "2026-10-02T04:00:00Z" },
      },
    });
    action.components[1]!.action = experiment;
    const ctx = context(action);
    ctx.components.component_1 = {
      populations: [definition],
      evaluations: [evaluatePopulation(definition, { evaluatedAt: "2026-09-27T00:00:00Z", customers: [{ customerId: "customer_one", completedOrderCount: 1 }] })],
      bindingTimes: { DECISION_TIME: "2026-09-27T00:00:00Z" },
      eligibilityMaximumAgeSeconds: 60,
      experimentArmRegistry: [{ entityKind: "ACTION", action: control }, { entityKind: "COMPOUND", action: armCompound }],
    };
    const result = translateCanonicalCompoundAction(action, ctx);
    expect(result.status).toBe("TRANSLATED");
    if (result.status !== "TRANSLATED") throw new Error(JSON.stringify(result));
    expect(result.experimentTasks).toMatchObject([{ actionId: experiment.actionId, actionFingerprint: fingerprintCanonicalAction(experiment), compoundActionId: action.compoundActionId, componentId: "component_1" }]);
    expect(result.compound?.components).toHaveLength(2);
  });

  it("retains every zero-intervention component and information task identity", () => {
    const action = fixture(),
      result = translateCanonicalCompoundAction(action, context(action));
    expect(result.status).toBe("TRANSLATED");
    expect(result.compound?.components).toHaveLength(2);
    expect(result.compound?.partial).toBe(false);
    if (result.status !== "TRANSLATED") throw new Error(result.status);
    expect(result.interventions).toEqual([]);
    expect(result.informationTasks).toMatchObject([
      {
        actionId: "action_1",
        compoundActionId: action.compoundActionId,
        componentId: "component_1",
      },
    ]);
  });
  it("blocks all-or-nothing rather than emitting a partial information task", () => {
    const action = fixture();
    action.atomicity = "ALL_OR_NOTHING";
    const ctx = context(action);
    ctx.readiness.components.component_0.status =
      "UNSUPPORTED_SIMULATOR_CAPABILITY";
    const result = translateCanonicalCompoundAction(action, ctx);
    expect(result.status).toBe("UNSUPPORTED_SIMULATOR_CAPABILITY");
    expect(result).not.toHaveProperty("informationTasks");
    expect(result.compound?.components).toHaveLength(2);
    expect(result.compound?.emittedComponentIds).toEqual([]);
  });
  it.each(["BEST_EFFORT", "DEPENDENCY_GATED"] as const)(
    "%s reports unsupported components and gates dependents",
    (atomicity) => {
      const action = fixture();
      action.atomicity = atomicity;
      action.dependencies = [
        {
          kind: "START_AFTER",
          componentId: "component_1",
          dependsOn: "component_0",
        },
      ];
      const ctx = context();
      ctx.components.component_0 = { unexpected: true } as {};
      const result = translateCanonicalCompoundAction(action, ctx);
      expect(result.status).not.toBe("TRANSLATED");
      expect(result.compound?.emittedComponentIds).toEqual([]);
    },
  );
  it("best effort emits ready information task while retaining unsupported readiness", () => {
    const ctx = context();
    ctx.readiness.components.component_0.status =
      "UNSUPPORTED_SIMULATOR_CAPABILITY";
    const result = translateCanonicalCompoundAction(fixture(), ctx);
    expect(result.status).toBe("TRANSLATED");
    expect(result.compound?.partial).toBe(true);
    expect(result.compound?.emittedComponentIds).toEqual(["component_1"]);
    expect(result.compound?.readiness.components[0]?.status).toBe(
      "UNSUPPORTED_SIMULATOR_CAPABILITY",
    );
  });
  it.each([
    null,
    {},
    {
      timing,
      components: {},
      readiness: { components: { component_0: null } },
    },
    { ...context(), extra: true },
  ])("returns a typed failure for invalid context %j", (ctx) => {
    const result = translateCanonicalCompoundAction(fixture(), ctx);
    expect(result.status).toBe("MISSING_CONTEXT");
  });
});

import { adaptLegacyAction } from "../../src/canonical_action/legacy.js";
import { increaseGoogleShoppingBudget20 } from "../../src/paid_media/fixtures.js";
const simulator = {
  schemaVersion: "1.6.0",
  simulatorClock: "2026-09-27T00:00:00Z",
  capabilities: ["campaign_budget"],
  entityMappings: [
    {
      actionTarget: {
        kind: "campaign",
        channelId: "google_ads",
        campaignId: "google_shopping",
      },
      simulatorTarget: {
        kind: "campaign",
        simulatorChannelId: "sim:google_ads",
        simulatorCampaignId: "sim:google_shopping",
      },
      sourceRef: "mapping:google",
    },
  ],
  referenceBindings: [
    {
      actionId: increaseGoogleShoppingBudget20.actionId,
      reference: {
        kind: "current_at_decision",
        decisionTime: "2026-09-21T13:00:00Z",
      },
      value: {
        kind: "money_rate",
        amountMinor: 1000000,
        currency: "CAD",
        per: "week",
      },
      sourceRef: "observed:budget",
    },
  ],
};
function activeFixture() {
  const action = fixture();
  action.components[0]!.action = adaptLegacyAction(
    increaseGoogleShoppingBudget20,
  );
  return action;
}
describe("compound commercial provenance and discovered failures", () => {
  it("preserves compound and atomic identity on a real budget intervention alongside investigation", () => {
    const action = activeFixture();
    const result = translateCanonicalCompoundAction(action, {
      ...context(action),
      components: { component_0: { simulator }, component_1: {} },
    });
    expect(result.status).toBe("TRANSLATED");
    if (result.status !== "TRANSLATED") throw new Error(JSON.stringify(result));
    expect(result.interventions).toHaveLength(1);
    expect(result.interventions[0]).toMatchObject({
      provenance: {
        originatingBusinessActionId: action.compoundActionId,
        sourceActionId: action.components[0]!.action.actionId,
      },
    });
    expect(result.informationTasks).toHaveLength(1);
    expect(result.compound?.partial).toBe(false);
  });
  it.each(["BEST_EFFORT", "DEPENDENCY_GATED"] as const)(
    "%s propagates actual unsupported capability before emitting dependent tasks",
    (atomicity) => {
      const action = activeFixture();
      action.atomicity = atomicity;
      action.dependencies = [
        {
          kind: "START_AFTER",
          componentId: "component_1",
          dependsOn: "component_0",
        },
      ];
      const result = translateCanonicalCompoundAction(action, {
        ...context(action),
        components: {
          component_0: { simulator: { ...simulator, capabilities: [] } },
          component_1: {},
        },
      });
      expect(result.status).toBe("UNSUPPORTED_SIMULATOR_CAPABILITY");
      expect(result.compound?.components[1]?.readiness.codes).toContain(
        "DEPENDENCY_NOT_READY",
      );
      expect(result.compound?.emittedComponentIds).toEqual([]);
      expect(result).not.toHaveProperty("informationTasks");
    },
  );
});

it("accepts constraint evidence bound to the exact compound and rejects stale evidence", () => {
  const action = fixture();
  action.constraints = [
    {
      constraintId: "constraint_evidence",
      kind: "EVIDENCE_REQUIRED",
      componentIds: ["component_0", "component_1"],
      evidenceRef: "evidence_required",
    },
  ];
  const ctx = {
    ...context(action),
    readiness: {
      ...context(action).readiness,
      constraintEvidence: {
        constraint_evidence: {
          status: "SATISFIED",
          evidenceRefs: ["evidence_checked"],
          compoundFingerprint: fingerprintCompoundAction(action),
        },
      },
    },
  };
  expect(translateCanonicalCompoundAction(action, ctx).status).toBe(
    "TRANSLATED",
  );
  ctx.readiness.constraintEvidence.constraint_evidence.compoundFingerprint =
    "stale";
  const stale = translateCanonicalCompoundAction(action, ctx);
  expect(stale.status).toBe("MISSING_CONTEXT");
  if (stale.status === "MISSING_CONTEXT")
    expect(stale.actionId).toBe(action.compoundActionId);
});

it.each(["requestedStart", "effectiveStart"] as const)(
  "gates a dependent with an embedded %s action reference when its source translation fails",
  (field) => {
    const action = activeFixture();
    action.components[0]!.action = {
      ...action.components[0]!.action,
      timing: {
        ...immediatePersistentBudgetTiming,
        decisionTime: action.components[0]!.action.timing.decisionTime,
      },
    };
    const dependent = action.components[1]!.action;
    action.components[1]!.action = {
      ...dependent,
      timing: {
        ...dependent.timing,
        [field]: {
          state: "SPECIFIED",
          value: {
            kind: "ACTION_RELATIVE",
            relation: "START_AFTER_ACTION_EFFECTIVE",
            actionId: action.components[0]!.action.actionId,
          },
        },
      },
    };
    expect(action.dependencies).toEqual([]);
    const result = translateCanonicalCompoundAction(action, {
      ...context(action),
      components: {
        component_0: { simulator: { ...simulator, capabilities: [] } },
        component_1: {},
      },
    });
    expect(result.status).toBe("UNSUPPORTED_SIMULATOR_CAPABILITY");
    expect(result.compound?.components[1]?.readiness.codes).toContain(
      "DEPENDENCY_NOT_READY",
    );
    expect(result.compound?.emittedComponentIds).toEqual([]);
    expect(result).not.toHaveProperty("informationTasks");
  },
);

it("gates a component whose nested termination condition refers to an unsupported source", () => {
  const action = activeFixture();
  const source = action.components[0]!.action;
  action.components[0]!.action = {
    ...source,
    timing: {
      ...immediatePersistentBudgetTiming,
      decisionTime: source.timing.decisionTime,
    },
  };
  const dependent = action.components[1]!.action;
  action.components[1]!.action = canonicalActionSchema.parse({
    ...dependent,
    what: noOpExamples.global,
    timing: {
      ...immediatePersistentBudgetTiming,
      terminationCondition: {
        state: "SPECIFIED",
        value: {
          kind: "COMPOSITE",
          operator: "FIRST_OF",
          conditions: [
            {
              kind: "STATE",
              condition: {
                kind: "ACTION_COMPLETES",
                actionId: source.actionId,
              },
            },
            {
              kind: "STATE",
              condition: { kind: "EVENT_OCCURS", eventId: "event_later" },
            },
          ],
        },
      },
    },
  });
  const result = translateCanonicalCompoundAction(action, {
    ...context(action),
    timing: {
      ...timing,
      eventTimes: { event_later: "2026-09-27T00:00:00Z" },
      actionTimes: {
        [source.actionId]: { completedAt: "2026-09-27T00:00:00Z" },
      },
    },
    components: {
      component_0: { simulator: { ...simulator, capabilities: [] } },
      component_1: {},
    },
  });
  expect(result.status).toBe("UNSUPPORTED_SIMULATOR_CAPABILITY");
  expect(result.compound?.components[1]?.readiness.codes).toContain(
    "DEPENDENCY_NOT_READY",
  );
  expect(result.compound?.emittedComponentIds).toEqual([]);
});

it("does not emit only the budget increase when its neutralizing decrease fails translation", () => {
  const action = structuredClone(createCompoundFixtures()[0]!.action);
  action.atomicity = "BEST_EFFORT";
  const channelSimulator = {
    ...simulator,
    capabilities: ["campaign_budget"],
    entityMappings: [
      {
        actionTarget: { kind: "advertising_channel", channelId: "meta_ads" },
        simulatorTarget: { kind: "channel", simulatorChannelId: "sim:meta" },
        sourceRef: "mapping:meta",
      },
      {
        actionTarget: { kind: "advertising_channel", channelId: "google_ads" },
        simulatorTarget: { kind: "channel", simulatorChannelId: "sim:google" },
        sourceRef: "mapping:google",
      },
    ],
    referenceBindings: [],
  };
  const result = translateCanonicalCompoundAction(action, {
    ...context(action),
    components: {
      component_0: { simulator: { ...channelSimulator, capabilities: [] } },
      component_1: { simulator: channelSimulator },
    },
  });
  expect(result.status).toBe("UNSUPPORTED_SIMULATOR_CAPABILITY");
  expect(result.compound?.components[1]?.result.status).toBe("TRANSLATED");
  expect(result.compound?.components[1]?.readiness.codes).toContain(
    "BUDGET_NEUTRAL_GROUP_NOT_READY",
  );
  expect(result.compound?.emittedComponentIds).toEqual([]);
});
