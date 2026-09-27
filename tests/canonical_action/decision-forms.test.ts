import { describe, it, expect } from "vitest";
import {
  canonicalActionSchema,
  fingerprintCanonicalAction,
  readCanonicalAction,
  serializeCanonicalAction,
  adaptLegacyAction,
} from "../../src/canonical_action/index.js";
import { immediatePersistentBudgetTiming } from "../../src/action_timing/fixtures.js";
import { translateBusinessAction } from "../../src/action_translation/index.js";
import {
  metaBudgetDown2000,
  fullTranslationContext,
} from "../../src/action_translation/fixtures.js";

const noop = () => ({
  schemaVersion: "2.0.0",
  actionId: "action_noop",
  what: { actionType: "no_op.do_nothing", scope: { kind: "GLOBAL" } },
  timing: immediatePersistentBudgetTiming,
  provenance: ["evidence_fixture"],
});
const context = { timing: { approvedClock: "2026-09-27T12:00:00Z" } };
describe("first-class decision forms", () => {
  it("represents explicit NO_OP and translates to an empty intervention list", () => {
    const action = canonicalActionSchema.parse(noop());
    expect(readCanonicalAction(serializeCanonicalAction(action))).toEqual(
      action,
    );
    expect(translateBusinessAction(action, context)).toMatchObject({
      status: "TRANSLATED",
      decisionType: "NO_OP",
      interventions: [],
    });
    for (const missing of [null, undefined, []])
      expect(translateBusinessAction(missing, context).status).not.toBe(
        "TRANSLATED",
      );
  });
  it("keeps NO_OP scope and WAIT intent distinct and rejects outcomes", () => {
    const base = canonicalActionSchema.parse(noop());
    const scoped = canonicalActionSchema.parse({
      ...noop(),
      what: {
        actionType: "no_op.do_nothing",
        scope: { kind: "SKU", ref: "sku_a", family: "PRICING" },
      },
    });
    expect(fingerprintCanonicalAction(scoped)).not.toBe(
      fingerprintCanonicalAction(base),
    );
    expect(
      canonicalActionSchema.safeParse({
        ...noop(),
        what: { ...noop().what, expectedProfit: 0 },
      }).success,
    ).toBe(false);
  });
  it("does not hide unsupported lifecycle semantics behind NO_OP or investigation", () => {
    const send = {
      ...noop(),
      what: {
        actionType: "lifecycle.send",
        channel: "EMAIL",
        purpose: "GENERAL_CAMPAIGN",
      },
    };
    expect(translateBusinessAction(send, context).status).toBe(
      "INVALID_ACTION",
    );
  });
  it("reuses a supported paid-media translator only after preserving canonical timing", () => {
    const action = adaptLegacyAction(metaBudgetDown2000);
    const translated = translateBusinessAction(action, {
      ...context,
      simulator: fullTranslationContext,
    });
    expect(translated.status).toBe("TRANSLATED");
    if (translated.status === "TRANSLATED") {
      expect(translated.interventions).toHaveLength(1);
      expect(translated.interventions[0]!.provenance.sourceActionId).toBe(
        action.actionId,
      );
    }
  });
});

import { investigationExamples } from "../../src/decision_forms/fixtures.js";
import { createCanonicalFixtures } from "../../src/canonical_action/fixtures.js";

it("requires the envelope population for customer investigations", () => {
  const input = { ...noop(), what: investigationExamples.customerConsent };
  expect(canonicalActionSchema.safeParse(input).success).toBe(false);
});
it("preserves investigation intent separately from commercial interventions", () => {
  const action = canonicalActionSchema.parse({
    ...noop(),
    what: investigationExamples.missingCogs,
    timing: {
      ...immediatePersistentBudgetTiming,
      duration: {
        state: "SPECIFIED",
        value: investigationExamples.missingCogs.expectedDuration,
      },
    },
  });
  const result = translateBusinessAction(action, context);
  expect(result).toMatchObject({
    status: "TRANSLATED",
    decisionType: "INVESTIGATE",
    interventions: [],
    informationTasks: [
      {
        actionId: action.actionId,
        specification: action.what,
        actionFingerprint: fingerprintCanonicalAction(action),
      },
    ],
  });
});
it("preserves WAIT identity and population for reassessment", () => {
  const population = createCanonicalFixtures().find(
    (a) => a.action?.population,
  )!.action!.population!;
  const action = canonicalActionSchema.parse({
    ...noop(),
    population,
    what: {
      actionType: "no_op.wait_observe",
      scope: { kind: "POPULATION" },
      reassessment: {
        kind: "AFTER_OBSERVATION",
        duration: {
          kind: "ELAPSED",
          amount: 24,
          unit: "HOUR",
          anchor: "EFFECTIVE_START",
        },
      },
    },
  });
  expect(action.population).toEqual(population);
  const global = canonicalActionSchema.parse({
    ...action,
    population: undefined,
    what: { ...action.what, scope: { kind: "GLOBAL" } },
  });
  expect(translateBusinessAction(global, context)).toMatchObject({
    status: "TRANSLATED",
    decisionType: "WAIT_OBSERVE",
    observationRequests: [
      {
        actionId: global.actionId,
        actionFingerprint: fingerprintCanonicalAction(global),
      },
    ],
  });
});

it("rejects investigations that cannot finish within their maximum horizon", () => {
  const persistent = canonicalActionSchema.parse({
    ...noop(),
    what: investigationExamples.missingCogs,
  });
  expect(translateBusinessAction(persistent, context)).toMatchObject({
    status: "INVALID_ACTION",
    code: "INVESTIGATION_EXECUTION_MUST_BE_FINITE",
  });
  const tooLong = canonicalActionSchema.parse({
    ...persistent,
    timing: {
      ...persistent.timing,
      duration: {
        state: "SPECIFIED",
        value: {
          kind: "CALENDAR",
          amount: 999,
          unit: "DAY",
          anchor: "REQUESTED_START",
        },
      },
    },
  });
  expect(translateBusinessAction(tooLong, context)).toMatchObject({
    status: "INVALID_ACTION",
    code: "INVESTIGATION_MAXIMUM_HORIZON_EXCEEDED",
  });
});
