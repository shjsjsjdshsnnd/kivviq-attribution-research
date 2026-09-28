import { describe, expect, it } from "vitest";
import { increaseGoogleShoppingBudget20, pauseUnderperformingMetaCampaign } from "../../src/action_ontology/fixtures.js";
import { evaluationFingerprint } from "../../src/evaluation/baseline-contract.js";
import { canonicalPolicyDecisionFingerprint, validateFutureInformationIsolation, validateLookbackWindow, validateTemporalObservationBoundary } from "../../src/validation/index.js";

const fp = (value: unknown) => evaluationFingerprint(value);
const side = (witnessValue: number, actions = [increaseGoogleShoppingBudget20]) => { const witness = { futureDemandUnits: witnessValue }; return { visibleInputFingerprint: fp({ visible: 1 }), witness, witnessFingerprint: fp(witness), decisionFingerprint: canonicalPolicyDecisionFingerprint(actions), actions }; };

describe("future information and temporal boundaries", () => {
  it("detects future-information leakage", () => {
    const valid = [{ pairId: "future-1", baseline: side(1), variant: side(2) }];
    expect(validateFutureInformationIsolation(valid)).toMatchObject({ checkId: "future_information_isolation", status: "PASS" });
    expect(validateFutureInformationIsolation([{ ...valid[0]!, variant: side(2, [pauseUnderperformingMetaCampaign]) }])).toMatchObject({ status: "FAIL", issues: [{ code: "FUTURE_INFORMATION_LEAKAGE" }] });
  });

  it("accepts all known event kinds at or before the decision and rejects future observations", () => {
    const kinds = ["order", "conversion", "revenue", "customer_event", "inventory_event", "advertising_outcome", "return", "promotion_outcome"] as const;
    const observationFingerprint = fp({ observations: 1 });
    const observations = kinds.map((kind, index) => ({ eventId: `e-${index}`, kind, occurredAt: index === 0 ? "2026-01-01T00:00:00.000Z" : "2026-01-31T23:59:59.999Z", payload: { index } }));
    expect(validateTemporalObservationBoundary({ decisionTimestamp: "2026-02-01T00:00:00.000Z", observationFingerprint, observations }, observationFingerprint)).toMatchObject({ checkId: "temporal_boundary_conformance", status: "PASS" });
    expect(validateTemporalObservationBoundary({ decisionTimestamp: "2026-02-01T00:00:00Z", observationFingerprint, observations: [{ eventId: "seconds", kind: "order", occurredAt: "2026-02-01T00:00:00Z", payload: {} }] }, observationFingerprint).status).toBe("PASS");
    for (const [index, kind] of kinds.entries()) {
      expect(
        validateTemporalObservationBoundary({
          decisionTimestamp: "2026-02-01T00:00:00.000Z",
          observationFingerprint, observations: [{ eventId: `future-${index}`, kind, occurredAt: "2026-02-01T00:00:00.001Z", payload: {} }],
        }),
        kind,
      ).toMatchObject({ status: "FAIL", issues: [{ code: "FUTURE_OBSERVATION" }] });
    }
  });

  it("preserves source indexes in temporal diagnostics", () => {
    const result = validateTemporalObservationBoundary({
      decisionTimestamp: "2026-02-01T00:00:00Z",
      observationFingerprint: fp({ observations: 1 }), observations: [
        { eventId: "bad", kind: "order", occurredAt: "not-time", payload: {} },
        { eventId: "future", kind: "conversion", occurredAt: "2026-02-01T00:00:00.001Z", payload: {} },
      ],
    });
    expect(result.issues.map((issue) => issue.path)).toEqual([
      "observations[1].occurredAt",
      "observations[0].occurredAt",
    ]);
  });

  it("orders equal instants by event ID across canonical timestamp formats", () => {
    expect(validateTemporalObservationBoundary({
      decisionTimestamp: "2026-02-01T00:00:00Z",
      observationFingerprint: fp({ observations: 1 }), observations: [
        { eventId: "a", kind: "order", occurredAt: "2026-02-01T00:00:00Z", payload: {} },
        { eventId: "b", kind: "conversion", occurredAt: "2026-02-01T00:00:00.000Z", payload: {} },
      ],
    })).toMatchObject({ status: "PASS", issues: [] });
  });

  it("fails closed for invalid instants, unknown kinds, duplicate IDs, unstable order, malformed payloads, and unknown keys", () => {
    const good = { eventId: "a", kind: "order", occurredAt: "2026-01-01T00:00:00.000Z", payload: { ok: true } };
    const badInputs: unknown[] = [
      { decisionTimestamp: "2026-01-01", observations: [good] },
      { decisionTimestamp: "2026-02-01T00:00:00+00:00", observations: [good] },
      { decisionTimestamp: "2026-02-01T00:00:00.0Z", observations: [good] },
      { decisionTimestamp: "2026-02-30T00:00:00Z", observations: [good] },
      { decisionTimestamp: "2026-02-01T00:00:00.000Z", observations: [{ ...good, occurredAt: "not-time" }] },
      { decisionTimestamp: "2026-02-01T00:00:00.000Z", observations: [{ ...good, kind: "unknown" }] },
      { decisionTimestamp: "2026-02-01T00:00:00.000Z", observations: [good, good] },
      { decisionTimestamp: "2026-02-01T00:00:00.000Z", observations: [{ ...good, eventId: "b" }, good] },
      { decisionTimestamp: "2026-02-01T00:00:00.000Z", observations: [{ ...good, payload: { bad: undefined } }] },
      { decisionTimestamp: "2026-02-01T00:00:00.000Z", observations: [good], ambient: true },
    ];
    for (const input of badInputs) expect(validateTemporalObservationBoundary(input as never).status).toBe("FAIL");
  });

  it("defines inclusive lookback boundaries and excludes one millisecond outside them", () => {
    const observation = (eventId: string, occurredAt: string) => ({ eventId, kind: "order" as const, occurredAt, payload: {} });
    const base = { startInclusive: "2026-01-02T00:00:00.000Z", endInclusive: "2026-02-01T00:00:00.000Z", decisionTimestamp: "2026-02-01T00:00:00.000Z", observationFingerprint: fp({ observations: 1 }) };
    expect(validateLookbackWindow({ ...base, observations: [observation("a", base.startInclusive), observation("b", base.endInclusive)] })).toMatchObject({ checkId: "lookback_window_conformance", status: "PASS" });
    expect(validateLookbackWindow({ ...base, observations: [observation("a", "2026-01-01T23:59:59.999Z")] }).status).toBe("FAIL");
    expect(validateLookbackWindow({ ...base, observations: [observation("a", "2026-02-01T00:00:00.001Z")] }).status).toBe("FAIL");
    expect(validateLookbackWindow({ ...base, endInclusive: "2026-01-31T23:59:59.999Z", observations: [] }).status).toBe("FAIL");
  });
});
