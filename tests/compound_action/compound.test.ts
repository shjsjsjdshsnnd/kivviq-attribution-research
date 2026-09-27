import { describe, expect, it } from "vitest";
import { adaptLegacyAction } from "../../src/canonical_action/legacy.js";
import { canonicalActionSchema } from "../../src/canonical_action/schema.js";
import { fingerprintCanonicalAction } from "../../src/canonical_action/serialization.js";
import { increaseGoogleShoppingBudget20 } from "../../src/action_ontology/fixtures.js";
import { createCanonicalFixtures } from "../../src/canonical_action/fixtures.js";
import { utcTimestamp, currencyCode } from "../../src/core/units.js";
import type { ActionEligibility } from "../../src/action_eligibility/index.js";
import {
  compoundActionSchema,
  assessCompoundActionReadiness as assessCompoundActionReadinessRaw,
  resolveCompoundTiming,
  fingerprintCompoundAction,
  serializeCompoundAction,
  assessCompoundRollback,
  type CompoundAction,
} from "../../src/compound_action/index.js";
const atomic = adaptLegacyAction(increaseGoogleShoppingBudget20);
const base = (): CompoundAction => ({
  schemaVersion: 1,
  kind: "compound_action",
  compoundActionId: "compound_test",
  components: [
    { componentId: "a", role: "BUDGET_SOURCE", action: atomic },
    {
      componentId: "b",
      role: "BUDGET_DESTINATION",
      action: { ...atomic, actionId: "action_second" },
    },
  ],
  ordering: "UNORDERED",
  concurrency: "INDEPENDENT_TIMING",
  dependencies: [],
  atomicity: "ALL_OR_NOTHING",
  failurePolicy: "STOP_REMAINING",
  rollbackPolicy: "ROLLBACK_ALL_REVERSIBLE_COMPONENTS",
  constraints: [],
  populationRelationships: [],
  measurementHorizon: { amount: 14, unit: "DAY" },
  provenance: ["evidence_test"],
});
const timing = { approvedClock: utcTimestamp("2026-01-01T00:00:00Z") };
const ready = {
  a: { status: "READY" as const, evidenceRefs: ["evidence_a"] },
  b: { status: "READY" as const, evidenceRefs: ["evidence_b"] },
};
function eligibility(action: CompoundAction, statuses: Partial<Record<string, "ELIGIBLE" | "INELIGIBLE" | "UNKNOWN">> = {}, evaluatedAt = "2026-01-01T00:00:00Z") {
  return Object.fromEntries(action.components.map((component) => {
    const status = statuses[component.componentId] ?? "ELIGIBLE";
    const constraintChecks = component.action.constraints
      .filter((constraint) => constraint.evaluationBoundary === "DECISION_TIME")
      .map((constraint) => ({
        kind: "HARD_CONSTRAINT" as const,
        checkId: constraint.constraintId,
        status: "SATISFIED" as const,
        reasonCodes: ["CONSTRAINT_SATISFIED"],
        evidenceRefs: ["constraint.evidence"],
        missingInformation: [],
      }));
    return [component.componentId, {
      actionId: component.action.actionId,
      actionFingerprint: fingerprintCanonicalAction(component.action),
      evaluatedAt,
      evaluationBoundary: "DECISION_TIME",
      status,
      checks: status === "ELIGIBLE" ? constraintChecks : [...constraintChecks, {
        kind: "DOMAIN_RULE",
        checkId: `eligibility.${component.componentId}`,
        status: status === "INELIGIBLE" ? "VIOLATED" : "UNKNOWN",
        reasonCodes: [status === "INELIGIBLE" ? "POLICY_DENIED" : "MISSING_EVIDENCE"],
        evidenceRefs: status === "INELIGIBLE" ? ["policy.evidence"] : [],
        missingInformation: status === "UNKNOWN" ? ["policy.evidence"] : [],
      }],
    } satisfies ActionEligibility];
  }));
}
function assessCompoundActionReadiness(
  action: CompoundAction,
  context: Parameters<typeof assessCompoundActionReadinessRaw>[1],
) {
  return assessCompoundActionReadinessRaw(action, {
    ...context,
    eligibilityResults: context.eligibilityResults ?? eligibility(action, {}, context.timing.approvedClock),
    eligibilityMaximumAgeSeconds: context.eligibilityMaximumAgeSeconds ?? 3600,
  });
}
describe("compound definition and runtime boundaries", () => {
  it("maps exact unified eligibility into component readiness and retains every check", () => {
    const action = base();
    action.dependencies = [{ componentId: "b", dependsOn: "a", kind: "START_AFTER" }];
    const eligibilityResults = eligibility(action, { a: "INELIGIBLE" });
    const result = assessCompoundActionReadiness(action, { timing, components: ready, eligibilityResults });
    expect(result.components[0]).toMatchObject({ status: "INELIGIBLE", codes: ["COMPONENT_INELIGIBLE"], eligibility: eligibilityResults["a"] });
    expect(result.components[1]).toMatchObject({ status: "INELIGIBLE", codes: ["DEPENDENCY_NOT_READY"], eligibility: eligibilityResults["b"] });
    expect(result.status).toBe("BLOCKED");
  });

  it("fails closed for missing, mismatched, or unknown unified eligibility without replacing capability checks", () => {
    const action = base();
    const exact = eligibility(action);
    const missing = assessCompoundActionReadiness(action, { timing, components: ready, eligibilityResults: { a: exact["a"] } });
    expect(missing.components[1]).toMatchObject({ status: "MISSING_CONTEXT", codes: ["COMPONENT_ELIGIBILITY_REQUIRED"] });
    const mismatched = assessCompoundActionReadiness(action, { timing, components: ready, eligibilityResults: { ...exact, b: { ...exact["b"]!, actionId: "action_wrong" } } });
    expect(mismatched.components[1]).toMatchObject({ status: "MISSING_CONTEXT", codes: ["COMPONENT_ELIGIBILITY_MISMATCH"] });
    expect(mismatched.components[1]).not.toHaveProperty("eligibility");
    const unknown = assessCompoundActionReadiness(action, { timing, components: { ...ready, b: { status: "UNSUPPORTED_SIMULATOR_CAPABILITY", evidenceRefs: ["capability"] } }, eligibilityResults: eligibility(action, { b: "UNKNOWN" }) });
    expect(unknown.components[1]).toMatchObject({ status: "UNKNOWN", readinessEvidenceStatus: "UNSUPPORTED_SIMULATOR_CAPABILITY", codes: ["COMPONENT_ELIGIBILITY_UNKNOWN"] });
    const denied = assessCompoundActionReadiness(action, { timing, components: { ...ready, b: { status: "UNSUPPORTED_SIMULATOR_CAPABILITY", evidenceRefs: ["capability"] } }, eligibilityResults: eligibility(action, { b: "INELIGIBLE" }) });
    expect(denied.components[1]).toMatchObject({ status: "INELIGIBLE", readinessEvidenceStatus: "UNSUPPORTED_SIMULATOR_CAPABILITY", codes: ["COMPONENT_INELIGIBLE"] });
  });

  it("fails closed when unified eligibility is omitted", () => {
    const action = base();
    const result = assessCompoundActionReadinessRaw(action, { timing, components: ready });
    expect(result.status).toBe("UNKNOWN");
    expect(result.components.every((component) => component.codes.includes("COMPONENT_ELIGIBILITY_REQUIRED"))).toBe(true);
  });

  it("rejects an eligible result that omits an applicable component constraint", () => {
    const action = base();
    action.components[0]!.action = canonicalActionSchema.parse({
      ...action.components[0]!.action,
      constraints: [{ constraintId: "component.policy", kind: "CUSTOM", target: { kind: "GLOBAL" }, evaluationBoundary: "DECISION_TIME", whenUnknown: "UNKNOWN", registryRef: "component.policy", code: "ALLOWED" }],
    });
    const generated = eligibility(action);
    const incomplete = { ...generated, a: { ...generated["a"]!, checks: [] } };
    expect(assessCompoundActionReadiness(action, { timing, components: ready, eligibilityResults: incomplete }).components[0]).toMatchObject({ status: "MISSING_CONTEXT", codes: ["COMPONENT_ELIGIBILITY_MISMATCH"] });
    const complete = { ...incomplete, a: { ...incomplete["a"]!, checks: [{ kind: "HARD_CONSTRAINT", checkId: "component.policy", status: "SATISFIED", reasonCodes: ["CUSTOM_SATISFIED"], evidenceRefs: ["policy.evidence"], missingInformation: [] }] } };
    expect(assessCompoundActionReadiness(action, { timing, components: ready, eligibilityResults: complete }).components[0]).toMatchObject({ status: "READY" });
  });

  it.each(["INELIGIBLE", "UNKNOWN"] as const)("requires complete constraint checks for %s eligibility", (status) => {
    const action = base();
    action.components[0]!.action = canonicalActionSchema.parse({ ...action.components[0]!.action, constraints: [{ constraintId: "component.policy", kind: "CUSTOM", target: { kind: "GLOBAL" }, evaluationBoundary: "DECISION_TIME", whenUnknown: "UNKNOWN", registryRef: "component.policy", code: "ALLOWED" }] });
    const results = eligibility(action, { a: status });
    results["a"] = { ...results["a"]!, checks: results["a"]!.checks.filter((check) => check.kind !== "HARD_CONSTRAINT") };
    const component = assessCompoundActionReadiness(action, { timing, components: ready, eligibilityResults: results }).components[0]!;
    expect(component).toMatchObject({ status: "MISSING_CONTEXT", codes: ["COMPONENT_ELIGIBILITY_MISMATCH"] });
    expect(component).not.toHaveProperty("eligibility");
  });

  it("rejects future, stale, and freshness-unbounded eligibility without retaining it", () => {
    const action = base();
    const exact = eligibility(action);
    const evaluate = (evaluatedAt: string, maximumAge?: number) => assessCompoundActionReadinessRaw(action, {
      timing,
      components: ready,
      eligibilityResults: Object.fromEntries(Object.entries(exact).map(([id, result]) => [id, { ...result, evaluatedAt }])),
      ...(maximumAge === undefined ? {} : { eligibilityMaximumAgeSeconds: maximumAge }),
    }).components[0]!;
    expect(evaluate("2026-01-01T00:00:01Z", 3600)).toMatchObject({ status: "MISSING_CONTEXT", codes: ["COMPONENT_ELIGIBILITY_FUTURE"] });
    expect(evaluate("2025-12-31T22:59:59Z", 3600)).toMatchObject({ status: "MISSING_CONTEXT", codes: ["COMPONENT_ELIGIBILITY_STALE"] });
    expect(evaluate("2026-01-01T00:00:00Z")).toMatchObject({ status: "MISSING_CONTEXT", codes: ["COMPONENT_ELIGIBILITY_FRESHNESS_REQUIRED"] });
    expect(evaluate("2026-01-01T00:00:01Z", 3600)).not.toHaveProperty("eligibility");
  });
  it("retains identities and rejects outcome leakage", () => {
    const action = base();
    expect(compoundActionSchema.parse(action).components).toHaveLength(2);
    expect(
      compoundActionSchema.safeParse({ ...action, expectedSynergy: 2 }).success,
    ).toBe(false);
    expect(fingerprintCompoundAction(action)).toBe(
      fingerprintCompoundAction(JSON.parse(serializeCompoundAction(action))),
    );
    expect(
      fingerprintCompoundAction({
        ...action,
        components: action.components.map((c) => ({
          ...c,
          action: { ...c.action, actionId: c.action.actionId + "x" },
        })),
      }),
    ).not.toBe(fingerprintCompoundAction(action));
  });
  it("rejects dependency cycles, including embedded timing refs", () => {
    const action = base();
    action.dependencies = [
      {
        componentId: "a",
        dependsOn: "b",
        kind: "REQUIRES",
        requiredState: "COMPLETED",
      },
    ];
    action.components[1]!.action.timing = {
      ...atomic.timing,
      dependencies: [{ kind: "START_AFTER", actionId: atomic.actionId }],
    };
    expect(compoundActionSchema.safeParse(action).success).toBe(false);
  });
  it("does not mistake translation readiness for completion", () => {
    const action = base();
    action.dependencies = [
      {
        componentId: "b",
        dependsOn: "a",
        kind: "REQUIRES",
        requiredState: "COMPLETED",
      },
    ];
    expect(
      assessCompoundActionReadiness(action, { timing, components: ready })
        .status,
    ).not.toBe("READY");
  });
  it("fails closed on missing readiness and constraint evidence", () => {
    expect(
      assessCompoundActionReadiness(base(), { timing, components: {} }).status,
    ).toBe("UNKNOWN");
    const action = base();
    action.constraints = [
      {
        constraintId: "budget",
        kind: "BUDGET_NEUTRAL",
        componentIds: ["a", "b"],
        currency: "CAD",
      },
    ];
    expect(
      assessCompoundActionReadiness(action, { timing, components: ready })
        .status,
    ).not.toBe("READY");
  });
  it("retains unsupported components and enforces all-or-nothing", () => {
    const result = assessCompoundActionReadiness(base(), {
      timing,
      components: {
        ...ready,
        b: {
          status: "UNSUPPORTED_SIMULATOR_CAPABILITY",
          evidenceRefs: ["capability_missing"],
        },
      },
    });
    expect(result.status).toBe("BLOCKED");
    expect(result.components).toHaveLength(2);
  });
  it("checks actual concurrency instants", () => {
    const action = base();
    action.concurrency = "START_TOGETHER";
    action.components[1]!.action.timing = {
      ...atomic.timing,
      requestedStart: {
        state: "SPECIFIED",
        value: {
          kind: "ABSOLUTE",
          time: {
            kind: "UTC",
            at: utcTimestamp("2030-01-01T00:00:00Z"),
            timeZone: "UTC",
          },
        },
      },
      effectiveStart: {
        state: "SPECIFIED",
        value: { kind: "DERIVE_FROM_REQUESTED_START" },
      },
    };
    expect(
      resolveCompoundTiming(action, timing).issues.some(
        (i) => i.code === "CONCURRENCY_CONFLICT",
      ),
    ).toBe(true);
  });
  it("cannot claim sent lifecycle actions are reversible", () => {
    const send = createCanonicalFixtures().find(
      (f) => f.action?.what.actionType === "lifecycle.send",
    )!.action!;
    const action = base();
    action.components[1]!.action = send;
    const result = assessCompoundRollback(action, {
      components: {
        b: {
          actionId: send.actionId,
          executionState: "COMPLETED",
          delivery: "SENT",
        },
      },
    });
    expect(result.components.find((c) => c.componentId === "b")?.status).toBe(
      "IRREVERSIBLE",
    );
    expect(result.canRestoreCompleteState).toBe(false);
  });
});

import {
  temporarySkuA799SevenDays,
  rollbackTemporarySkuAToPreActionPrice,
} from "../../src/pricing/fixtures.js";
it("domain rollback preserves conflicts, irreversibility, and reverse dependency order", () => {
  const action = base();
  action.components[0]!.action = adaptLegacyAction(temporarySkuA799SevenDays);
  action.dependencies = [
    { componentId: "b", dependsOn: "a", kind: "START_AFTER" },
  ];
  const result = assessCompoundRollback(action, {
    components: {
      a: {
        actionId: temporarySkuA799SevenDays.actionId,
        executionState: "COMPLETED",
        domain: {
          kind: "PRICING",
          rollbackAction: rollbackTemporarySkuAToPreActionPrice,
          context: {
            currentPrice: {
              kind: "money",
              currency: currencyCode("CAD"),
              amountMinor: 500,
            },
          },
        },
      },
      b: {
        actionId: action.components[1]!.action.actionId,
        executionState: "NOT_STARTED",
      },
    },
  });
  expect(result.components[0]!.status).toBe("CONFLICT");
  expect(result.canRestoreCompleteState).toBe(false);
  expect(result.rollbackOrder).toEqual(["b"]);
  const good = assessCompoundRollback(action, {
    components: {
      a: {
        actionId: temporarySkuA799SevenDays.actionId,
        executionState: "COMPLETED",
        domain: {
          kind: "PRICING",
          rollbackAction: rollbackTemporarySkuAToPreActionPrice,
          context: {
            currentPrice: {
              kind: "money",
              currency: currencyCode("CAD"),
              amountMinor: 79900,
            },
          },
        },
      },
      b: {
        actionId: action.components[1]!.action.actionId,
        executionState: "NOT_STARTED",
      },
    },
  });
  expect(good.rollbackOrder).toEqual(["b", "a"]);
  expect(good.canRestoreCompleteState).toBe(true);
});
it("rejects rollback evidence rebound to the wrong target", () => {
  const action = base();
  action.components[0]!.action = adaptLegacyAction(temporarySkuA799SevenDays);
  const result = assessCompoundRollback(action, {
    components: {
      a: {
        actionId: temporarySkuA799SevenDays.actionId,
        executionState: "COMPLETED",
        domain: {
          kind: "PRICING",
          rollbackAction: {
            ...rollbackTemporarySkuAToPreActionPrice,
            target: { kind: "sku", productId: "wrong", skuId: "wrong" },
          },
          context: {
            currentPrice: {
              kind: "money",
              currency: currencyCode("CAD"),
              amountMinor: 79900,
            },
          },
        },
      },
    },
  });
  expect(result.components[0]!.status).toBe("CONFLICT");
});

it("does not trust a caller-modified original output guard", () => {
  const action = base();
  action.components[0]!.action = adaptLegacyAction(temporarySkuA799SevenDays);
  const rollback = structuredClone(rollbackTemporarySkuAToPreActionPrice);
  if (
    rollback.parameters.kind !== "price_rollback" ||
    rollback.parameters.conflictGuard.expected.kind !== "single_price"
  )
    throw Error("fixture");
  const forged = {
    ...rollback,
    parameters: {
      ...rollback.parameters,
      conflictGuard: {
        ...rollback.parameters.conflictGuard,
        expected: {
          kind: "single_price" as const,
          price: {
            kind: "money" as const,
            currency: currencyCode("CAD"),
            amountMinor: 500,
          },
        },
      },
    },
  };
  const result = assessCompoundRollback(action, {
    components: {
      a: {
        actionId: temporarySkuA799SevenDays.actionId,
        executionState: "COMPLETED",
        domain: {
          kind: "PRICING",
          rollbackAction: forged,
          context: {
            currentPrice: {
              kind: "money",
              currency: currencyCode("CAD"),
              amountMinor: 500,
            },
          },
        },
      },
    },
  });
  expect(result.components[0]!.status).toBe("CONFLICT");
});
import { createCompoundFixtures } from "../../src/compound_action/fixtures.js";
it("covers twelve canonical cross-family scenarios with native lifecycle identities", () => {
  const fixtures = createCompoundFixtures();
  expect(fixtures).toHaveLength(12);
  for (const f of fixtures)
    expect(compoundActionSchema.safeParse(f.action).success).toBe(f.valid);
  expect(
    fixtures[1]!.action.components.find(
      (c) => c.action.what.actionType === "lifecycle.send",
    )!.action.schemaVersion,
  ).toBe("2.0.0");
  expect(
    assessCompoundRollback(fixtures[9]!.action, fixtures[9]!.rollbackContext!)
      .status,
  ).toBe("PARTIALLY_REVERSIBLE");
  expect(
    assessCompoundRollback(fixtures[10]!.action, fixtures[10]!.rollbackContext!)
      .components[0]!.status,
  ).toBe("CONFLICT");
});
import { investigationExamples } from "../../src/decision_forms/fixtures.js";
import type { InvestigationResult } from "../../src/investigation/index.js";
it("gates investigations on bound validated results, never status claims", () => {
  const action = base();
  const investigation = { ...atomic, what: investigationExamples.missingCogs };
  action.components[0]!.action = investigation;
  action.dependencies = [
    {
      componentId: "b",
      dependsOn: "a",
      kind: "REQUIRES",
      requiredState: "RESOLVED",
    },
  ];
  const context = {
    timing: { approvedClock: utcTimestamp("2026-09-28T00:00:00Z") },
    components: {
      ...ready,
      a: {
        ...ready.a,
        executionState: "COMPLETED" as const,
        investigationState: "RESOLVED" as const,
      },
    },
  };
  expect(
    assessCompoundActionReadiness(action, context).components[1]!.status,
  ).toBe("MISSING_CONTEXT");
  const result: InvestigationResult = {
    actionId: investigation.actionId,
    actionFingerprint: fingerprintCanonicalAction(investigation),
    status: "RESOLVED",
    evidenceCollected: [
      { evidenceId: "requested-evidence", artifactRef: "cogs_export" },
    ],
    coverage: [{ evidenceId: "requested-evidence", fraction: 1 }],
    findings: [],
    unresolvedEvidenceIds: [],
    completedAt: "2026-09-27T12:00:00Z",
    provenance: {
      sourceRef: "audit_service",
      recordedAt: "2026-09-27T12:00:00Z",
    },
  };
  expect(
    assessCompoundActionReadiness(action, {
      ...context,
      components: { ...ready, a: { ...ready.a, investigationResult: result } },
    }).status,
  ).toBe("READY");
  expect(
    assessCompoundActionReadiness(action, {
      ...context,
      components: {
        ...ready,
        a: {
          ...ready.a,
          investigationResult: { ...result, actionFingerprint: "wrong" },
        },
      },
    }).status,
  ).not.toBe("READY");
});
it("completed-only and dependent rollback select exact subsets", () => {
  const action = base();
  action.rollbackPolicy = "ROLLBACK_COMPLETED_COMPONENTS";
  const context = {
    components: {
      a: { actionId: atomic.actionId, executionState: "NOT_STARTED" as const },
      b: { actionId: "action_second", executionState: "NOT_STARTED" as const },
    },
  };
  expect(assessCompoundRollback(action, context).rollbackOrder).toEqual([]);
  action.rollbackPolicy = "ROLLBACK_DEPENDENT_COMPONENTS";
  expect(
    assessCompoundRollback(action, { ...context, failedComponentId: "a" })
      .rollbackOrder,
  ).toEqual(["a"]);
  action.dependencies = [
    { componentId: "b", dependsOn: "a", kind: "START_AFTER" },
  ];
  expect(
    assessCompoundRollback(action, { ...context, failedComponentId: "a" })
      .rollbackOrder,
  ).toEqual(["b", "a"]);
});
it("validates SAME population by full versioned references", () => {
  const action = createCompoundFixtures()[6]!.action;
  action.populationRelationships = [
    { kind: "SAME", componentIds: ["component_0", "component_1"] },
  ];
  expect(compoundActionSchema.safeParse(action).success).toBe(false);
  const original = action.components[0]!.action.population!;
  action.components[1]!.action.population = {
    ...original,
    version: original.version + 1,
  };
  expect(compoundActionSchema.safeParse(action).success).toBe(false);
});
it("fails closed on malformed runtime statuses and forged budget constraint approval", () => {
  const action = base();
  expect(
    assessCompoundActionReadiness(action, {
      timing,
      components: { a: { status: "BOGUS", evidenceRefs: ["x"] }, b: ready.b },
    } as never).status,
  ).not.toBe("READY");
  const neutral = createCompoundFixtures()[0]!.action;
  const context = {
    timing,
    components: Object.fromEntries(
      neutral.components.map((c) => [
        c.componentId,
        { status: "READY" as const, evidenceRefs: ["checked"] },
      ]),
    ),
  };
  expect(
    assessCompoundActionReadiness(neutral, context).constraintResults[0]!
      .status,
  ).toBe("SATISFIED");
  const destination = neutral.components[1]!.action.what;
  if (
    "kind" in destination &&
    destination.kind === "legacy_business" &&
    destination.parameters.kind === "budget_adjustment" &&
    destination.parameters.operation.kind === "DELTA"
  ) {
    neutral.components[1]!.action.what = {
      ...destination,
      parameters: {
        ...destination.parameters,
        operation: {
          ...destination.parameters.operation,
          amount: {
            ...destination.parameters.operation.amount,
            amountMinor: 100,
          },
        },
      },
    };
  }
  expect(
    assessCompoundActionReadiness(neutral, {
      ...context,
      constraintEvidence: {
        budget_neutral: { status: "SATISFIED", evidenceRefs: ["claimed"] },
      },
    }).constraintResults[0]!.status,
  ).toBe("VIOLATED");
});
it("COMPLETE_AFTER requires actual completion evidence rather than planned end", () => {
  const action = createCompoundFixtures()[9]!.action;
  action.dependencies = [
    {
      componentId: "component_1",
      dependsOn: "component_0",
      kind: "COMPLETE_AFTER",
    },
  ];
  expect(
    resolveCompoundTiming(action, timing).issues.some(
      (i) => i.code === "MISSING_COORDINATION_TIME",
    ),
  ).toBe(true);
});
it("known costs cannot be overridden by bound SATISFIED claims", () => {
  const action = base();
  const first = action.components[0]!.action.what;
  if (!("kind" in first) || first.kind !== "legacy_business")
    throw Error("fixture");
  action.components[0]!.action.what = {
    ...first,
    cost: {
      ...first.cost,
      implementationCost: {
        kind: "known",
        value: {
          kind: "money",
          currency: currencyCode("CAD"),
          amountMinor: 500,
        },
      },
    },
  };
  action.constraints = [
    {
      constraintId: "cost",
      kind: "TOTAL_COST_LIMIT",
      componentIds: ["a", "b"],
      currency: "CAD",
      maximumAmountMinor: 100,
    },
  ];
  expect(
    assessCompoundActionReadiness(action, {
      timing,
      components: ready,
      constraintEvidence: {
        cost: {
          status: "SATISFIED",
          evidenceRefs: ["claim"],
          compoundFingerprint: fingerprintCompoundAction(action),
        },
      },
    }).constraintResults[0]!.status,
  ).toBe("VIOLATED");
});
it("rejects substituted rollback strategies even when the output guard matches", () => {
  const fixture = createCompoundFixtures()[9]!;
  const context = structuredClone(fixture.rollbackContext!);
  const domain = context.components["component_0"]!.domain!;
  if (
    domain.kind !== "PRICING" ||
    domain.rollbackAction.parameters.kind !== "price_rollback"
  )
    throw Error("fixture");
  domain.rollbackAction = {
    ...domain.rollbackAction,
    parameters: {
      ...domain.rollbackAction.parameters,
      strategy: {
        kind: "SET_EXPLICIT_VALUE",
        value: { kind: "money", currency: currencyCode("CAD"), amountMinor: 1 },
      },
    },
  };
  expect(
    assessCompoundRollback(fixture.action, context).components[0]!.status,
  ).toBe("CONFLICT");
});
it("fails closed instead of throwing for malformed rollback context", () => {
  const action = createCompoundFixtures()[9]!.action;
  for (const context of [
    undefined,
    null,
    {},
    {
      components: {
        component_0: {
          actionId: action.components[0]!.action.actionId,
          executionState: "COMPLETED",
          domain: { kind: "PRICING", rollbackAction: null, context: {} },
        },
      },
    },
    {
      components: {
        component_0: {
          actionId: action.components[0]!.action.actionId,
          executionState: "BOGUS",
        },
      },
    },
  ]) {
    expect(() =>
      assessCompoundRollback(action, context as never),
    ).not.toThrow();
    expect(
      assessCompoundRollback(action, context as never).canRestoreCompleteState,
    ).toBe(false);
  }
});
it("includes known investigation costs in total cost constraints", () => {
  const action = base();
  action.components[0]!.action.what = {
    ...investigationExamples.missingCogs,
    costs: {
      analyst: { state: "KNOWN", amountMinor: 500, currency: "CAD" },
      engineering: { state: "UNKNOWN" },
      externalService: { state: "UNKNOWN" },
    },
  };
  action.constraints = [
    {
      constraintId: "cost",
      kind: "TOTAL_COST_LIMIT",
      componentIds: ["a"],
      currency: "CAD",
      maximumAmountMinor: 100,
    },
  ];
  expect(
    assessCompoundActionReadiness(action, {
      timing,
      components: ready,
      constraintEvidence: {
        cost: {
          status: "SATISFIED",
          evidenceRefs: ["claim"],
          compoundFingerprint: fingerprintCompoundAction(action),
        },
      },
    }).constraintResults[0]!.status,
  ).toBe("VIOLATED");
});
it("gates dependents expressed only through canonical ACTION_RELATIVE timing", () => {
  const action = base();
  action.atomicity = "BEST_EFFORT";
  action.components[1]!.action.timing = {
    ...atomic.timing,
    requestedStart: {
      state: "SPECIFIED",
      value: {
        kind: "ACTION_RELATIVE",
        relation: "START_AFTER_ACTION_EFFECTIVE",
        actionId: atomic.actionId,
      },
    },
    effectiveStart: {
      state: "SPECIFIED",
      value: { kind: "DERIVE_FROM_REQUESTED_START" },
    },
  };
  const result = assessCompoundActionReadiness(action, {
    timing,
    components: {
      a: {
        status: "UNSUPPORTED_SIMULATOR_CAPABILITY",
        evidenceRefs: ["unsupported"],
      },
      b: ready.b,
    },
  });
  expect(result.components[1]!.status).toBe("INELIGIBLE");
});
it("keeps a neutral budget group gated when a source cannot run", () => {
  const action = createCompoundFixtures()[0]!.action;
  action.atomicity = "BEST_EFFORT";
  const result = assessCompoundActionReadiness(action, {
    timing,
    components: {
      component_0: { status: "READY", evidenceRefs: ["supported"] },
      component_1: { status: "READY", evidenceRefs: ["eligible"] },
    },
    eligibilityResults: eligibility(action, { component_0: "INELIGIBLE" }),
  });
  expect(result.constraintResults[0]!.status).toBe("SATISFIED");
  expect(result.components[1]!.status).toBe("INELIGIBLE");
});
