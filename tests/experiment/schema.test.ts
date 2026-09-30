import { describe, expect, it } from "vitest";
import {
  canonicalActionSchema,
  fingerprintCanonicalAction,
  readCanonicalAction,
  serializeCanonicalAction,
} from "../../src/canonical_action/index.js";
import {
  fridaySevenDayBudgetTiming,
  immediatePersistentBudgetTiming,
  weeklyEightWeekLifecycleTiming,
} from "../../src/action_timing/fixtures.js";
import { experimentWhatSchema } from "../../src/experiment/index.js";
import { experimentWhatSchema as publicExperimentWhatSchema } from "../../src/index.js";

const population = {
  populationId: "population_experiment",
  version: 1,
  definitionFingerprint: "fnv1a64:0123456789abcdef",
  binding: "DECISION_TIME",
  membershipMode: "FROZEN_MEMBERSHIP",
} as const;

const control = {
  armId: "arm_control",
  role: "CONTROL",
  actionId: "action_noop",
  actionFingerprint: "fnv1a64:1111111111111111",
  allocationBasisPoints: 5000,
} as const;

const treatment = {
  armId: "arm_treatment",
  role: "TREATMENT",
  actionId: "action_price_test",
  actionFingerprint: "fnv1a64:2222222222222222",
  allocationBasisPoints: 5000,
} as const;

const what = () => ({
  actionType: "experiment.run" as const,
  hypothesisRef: "hypothesis_price_elasticity",
  primaryMetricRef: "metric_conversion_rate",
  guardrailMetricRefs: ["metric_margin"],
  randomizationUnit: "CUSTOMER" as const,
  assignmentBoundary: { kind: "USE_ENVELOPE_POPULATION_BINDING" as const },
  arms: [control, treatment],
  stopping: {
    kind: "FIXED" as const,
    sampleTarget: 2000,
    timingHorizon: "ENVELOPE_TIMING" as const,
  },
  measurementWindow: {
    start: "2026-10-01T00:00:00Z",
    end: "2026-10-15T00:00:00Z",
  },
});

const action = () => ({
  schemaVersion: "2.0.0" as const,
  actionId: "action_experiment_price",
  what: what(),
  population,
  timing: fridaySevenDayBudgetTiming,
  provenance: ["evidence_experiment_design"],
});

describe("canonical experiment intent", () => {
  it("exposes the strict experiment schema through its module and root API", () => {
    expect(experimentWhatSchema.parse(what())).toEqual(what());
    expect(publicExperimentWhatSchema.parse(what())).toEqual(what());
    expect(canonicalActionSchema.parse(action()).what.actionType).toBe(
      "experiment.run",
    );
    const parsed = canonicalActionSchema.parse(action());
    expect(readCanonicalAction(serializeCanonicalAction(parsed))).toEqual(parsed);
  });

  it("accepts either a NO_OP identity or an active action identity as control", () => {
    expect(experimentWhatSchema.safeParse(what()).success).toBe(true);
    expect(
      experimentWhatSchema.safeParse({
        ...what(),
        arms: [
          { ...control, actionId: "action_current_price" },
          treatment,
          {
            ...treatment,
            armId: "arm_treatment_b",
            actionId: "action_free_shipping",
            actionFingerprint: "fnv1a64:3333333333333333",
            allocationBasisPoints: 1000,
          },
        ].map((arm, index) => ({
          ...arm,
          allocationBasisPoints: [4000, 5000, 1000][index],
        })),
      }).success,
    ).toBe(true);
  });

  it.each([
    ["allocation total", { ...what(), arms: [{ ...control, allocationBasisPoints: 4999 }, treatment] }],
    ["duplicate arm", { ...what(), arms: [control, { ...treatment, armId: control.armId }] }],
    ["duplicate action identity", { ...what(), arms: [control, { ...treatment, actionId: control.actionId, actionFingerprint: control.actionFingerprint }] }],
    ["duplicate action ID with conflicting fingerprints", { ...what(), arms: [control, { ...treatment, actionId: control.actionId }] }],
    ["duplicate action semantics under different IDs", { ...what(), arms: [control, { ...treatment, actionFingerprint: control.actionFingerprint }] }],
    ["missing control", { ...what(), arms: [{ ...control, role: "TREATMENT" }, treatment] }],
    ["multiple controls", { ...what(), arms: [control, { ...treatment, role: "CONTROL" }] }],
    ["zero allocation", { ...what(), arms: [control, { ...treatment, allocationBasisPoints: 0 }] }],
  ])("rejects invalid %s", (_label, candidate) => {
    expect(experimentWhatSchema.safeParse(candidate).success).toBe(false);
  });

  it("requires an envelope population and a fixed stopping basis", () => {
    const { population: _population, ...withoutPopulation } = action();
    expect(canonicalActionSchema.safeParse(withoutPopulation).success).toBe(false);
    expect(
      experimentWhatSchema.safeParse({
        ...what(),
        stopping: { kind: "FIXED" },
      }).success,
    ).toBe(false);
  });

  it("requires a finite envelope horizon when stopping uses envelope timing", () => {
    expect(
      canonicalActionSchema.safeParse({
        ...action(),
        what: {
          ...what(),
          stopping: { kind: "FIXED", timingHorizon: "ENVELOPE_TIMING" },
        },
        timing: immediatePersistentBudgetTiming,
      }).success,
    ).toBe(false);
    expect(
      canonicalActionSchema.safeParse({
        ...action(),
        what: {
          ...what(),
          stopping: { kind: "FIXED", sampleTarget: 100 },
        },
        timing: immediatePersistentBudgetTiming,
      }).success,
    ).toBe(true);
    const openRecurrenceTiming = {
      ...weeklyEightWeekLifecycleTiming,
      recurrence: {
        state: "SPECIFIED" as const,
        value: {
          frequency: {
            kind: "WEEKLY" as const,
            interval: 1,
            daysOfWeek: [2],
            localTime: "10:00",
          },
          boundary: { kind: "OPEN_ENDED" as const, explicitlyOpenEnded: true },
        },
      },
    };
    expect(
      canonicalActionSchema.safeParse({
        ...action(),
        what: {
          ...what(),
          stopping: { kind: "FIXED", timingHorizon: "ENVELOPE_TIMING" },
        },
        timing: openRecurrenceTiming,
      }).success,
    ).toBe(false);
    expect(
      canonicalActionSchema.safeParse({
        ...action(),
        what: {
          ...what(),
          stopping: { kind: "FIXED", sampleTarget: 100 },
        },
        timing: openRecurrenceTiming,
      }).success,
    ).toBe(true);
  });

  it("validates measurement windows, custom randomization, and unique metrics", () => {
    expect(
      experimentWhatSchema.safeParse({
        ...what(),
        randomizationUnit: {
          kind: "CUSTOM",
          registryRef: "registry_randomization_units",
          code: "HOUSEHOLD",
        },
      }).success,
    ).toBe(true);
    expect(
      experimentWhatSchema.safeParse({
        ...what(),
        measurementWindow: {
          start: "2026-10-15T00:00:00Z",
          end: "2026-10-01T00:00:00Z",
        },
      }).success,
    ).toBe(false);
    expect(
      experimentWhatSchema.safeParse({
        ...what(),
        measurementWindow: {
          start: "2026-10-01T02:00:00+02:00",
          end: "2026-10-15T02:00:00+02:00",
        },
      }).success,
    ).toBe(false);
    expect(
      experimentWhatSchema.safeParse({
        ...what(),
        guardrailMetricRefs: ["metric_margin", "metric_margin"],
      }).success,
    ).toBe(false);
    expect(
      experimentWhatSchema.safeParse({
        ...what(),
        guardrailMetricRefs: [what().primaryMetricRef],
      }).success,
    ).toBe(false);
  });

  it.each(["winner", "lift", "significance", "posterior", "expectedRevenue", "expectedProfit", "expectedROAS", "value", "recommendation", "best", "adaptive", "sequential", "results"])(
    "rejects leaked %s fields recursively",
    (field) => {
      expect(
        canonicalActionSchema.safeParse({
          ...action(),
          what: { ...what(), metadata: { [field]: 1 } },
        }).success,
      ).toBe(false);
    },
  );

  it("treats arm order as non-semantic without stripping arm identities", () => {
    const first = canonicalActionSchema.parse(action());
    const reordered = canonicalActionSchema.parse({
      ...action(),
      what: { ...what(), arms: [treatment, control] },
    });
    expect(first.what).not.toEqual(reordered.what);
    expect(fingerprintCanonicalAction(first)).toBe(
      fingerprintCanonicalAction(reordered),
    );
    const changedAllocation = canonicalActionSchema.parse({
      ...action(),
      what: {
        ...what(),
        arms: [
          { ...control, allocationBasisPoints: 6000 },
          { ...treatment, allocationBasisPoints: 4000 },
        ],
      },
    });
    expect(fingerprintCanonicalAction(first)).not.toBe(
      fingerprintCanonicalAction(changedAllocation),
    );
    for (const changed of [
      { ...what(), hypothesisRef: "hypothesis_other" },
      { ...what(), primaryMetricRef: "metric_revenue" },
      { ...what(), randomizationUnit: "ORDER" as const },
      {
        ...what(),
        measurementWindow: {
          ...what().measurementWindow,
          end: "2026-10-16T00:00:00Z",
        },
      },
      {
        ...what(),
        arms: [
          control,
          {
            ...treatment,
            actionFingerprint: "fnv1a64:4444444444444444",
          },
        ],
      },
    ]) {
      const candidate = canonicalActionSchema.parse({ ...action(), what: changed });
      expect(fingerprintCanonicalAction(candidate)).not.toBe(
        fingerprintCanonicalAction(first),
      );
    }
  });
});
