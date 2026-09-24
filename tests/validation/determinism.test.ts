import { describe, expect, it } from "vitest";
import { increaseGoogleShoppingBudget20 } from "../../src/action_ontology/fixtures.js";
import { evaluationFingerprint } from "../../src/evaluation/baseline-contract.js";
import {
  detectUncontrolledRandomness,
  validateCompleteRunReproducibility,
  validateDeterministicDecisions,
  validateSeedReproducibility,
} from "../../src/validation/index.js";

const fp = (value: unknown) => evaluationFingerprint(value);
const action = increaseGoogleShoppingBudget20;

function decision(sampleId: string, note = "stable") {
  return {
    sampleId,
    canonicalInputFingerprint: fp({ input: 1 }),
    operatorFingerprint: fp({ operator: 1 }),
    configurationFingerprint: fp({ config: 1 }),
    seedBindingFingerprint: fp({ seed: 1 }),
    actions: [action],
    decisionEnvelope: { note, actions: [action] },
  };
}

describe("determinism validation", () => {
  it("compares canonical decisions while ignoring explicitly identified provenance IDs", () => {
    const result = validateDeterministicDecisions([
      decision("b"),
      decision("a"),
    ]);
    expect(result).toMatchObject({ checkId: "determinism", status: "PASS", issues: [] });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.evidenceFingerprints)).toBe(true);
    expect(result.evidenceFingerprints).toEqual([...result.evidenceFingerprints].sort());

    expect(validateDeterministicDecisions([decision("a"), decision("b", "changed")])).toMatchObject({
      status: "FAIL",
      issues: [{ code: "NONDETERMINISTIC_DECISION" }],
    });
  });

  it("uses the authoritative action projection and rejects caller exclusions", () => {
    const randomizeProvenanceIds = (sampleId: string) => ({
      ...decision(sampleId),
      actions: [{
        ...action,
        actionId: `action_random_${sampleId}`,
        provenance: { ...action.provenance, sourceId: `source:${sampleId}`, evidenceRefs: [`evidence:${sampleId}`] },
      }],
    });
    expect(validateDeterministicDecisions([randomizeProvenanceIds("a"), randomizeProvenanceIds("b")] as never).status).toBe("PASS");

    const changedAction = { ...action, parameters: { ...action.parameters, operation: { ...(action.parameters as { operation: object }).operation, factor: 1.3 } } };
    const changedParameters = {
      ...decision("b"),
      actions: [changedAction],
      decisionEnvelope: { ...decision("b").decisionEnvelope, actions: [changedAction] },
    };
    expect(validateDeterministicDecisions([decision("a"), changedParameters] as never).issues.map((x) => x.code)).toContain("NONDETERMINISTIC_DECISION");
    for (const attemptedPath of [
      "decisionEnvelope.note",
      "actions[*].parameters",
      "actions[*].actionType",
      "actions[*].target",
      "actions..actionId",
      "actions[0].actionId",
    ]) {
      expect(validateDeterministicDecisions([
        { ...decision("a"), provenanceOnlyPaths: [attemptedPath] },
        { ...decision("b"), provenanceOnlyPaths: [attemptedPath] },
      ] as never).status, attemptedPath).toBe("FAIL");
    }
  });

  it("fails closed for insufficient, duplicate, unknown, or malformed evidence", () => {
    expect(validateDeterministicDecisions([decision("only")]).status).toBe("FAIL");
    expect(validateDeterministicDecisions([decision("same"), decision("same")]).status).toBe("FAIL");
    expect(validateDeterministicDecisions([{ ...decision("a"), ambient: true }, decision("b")] as never).status).toBe("FAIL");
    expect(validateDeterministicDecisions([decision("a"), { ...decision("b"), decisionEnvelope: { bad: undefined } }] as never).status).toBe("FAIL");
    for (const decisionEnvelope of [null, [], { actions: null }, { actions: [null] }, { actions: [] }]) {
      expect(validateDeterministicDecisions([decision("a"), { ...decision("b"), decisionEnvelope }] as never).issues.map((x) => x.code)).toContain("INVALID_DECISION_EVIDENCE");
    }
  });

  it("projects every complete-run section", () => {
    const run = (sampleId: string) => ({
      sampleId,
      canonicalInputFingerprint: fp({ input: 1 }),
      operatorFingerprint: fp({ operator: 1 }),
      configurationFingerprint: fp({ config: 1 }),
      seedSetFingerprint: fp({ seeds: [1] }),
      decisionOpportunities: [{ id: "d1" }], observations: [{ value: 1 }],
      outputs: [{ actions: [action] }], dispositions: [{ state: "executed" }],
      executedActions: [action],
      simulatorOutcomeFingerprint: fp({ outcome: 1 }), metrics: [{ metricId: "profit", value: 1 }],
      provenanceFingerprint: fp({ provenance: 1 }),
    });
    expect(validateCompleteRunReproducibility([run("a"), run("b")]).status).toBe("PASS");
    for (const field of ["decisionOpportunities", "observations", "outputs", "dispositions", "executedActions", "simulatorOutcomeFingerprint", "metrics", "provenanceFingerprint"] as const) {
      const changed = { ...run("b"), [field]: field.endsWith("Fingerprint") ? fp({ changed: field }) : [{ changed: field }] };
      expect(validateCompleteRunReproducibility([run("a"), changed]).status, field).toBe("FAIL");
    }

    const invalidSections: unknown[] = [
      { ...run("b"), decisionOpportunities: null },
      { ...run("b"), decisionOpportunities: [] },
      { ...run("b"), observations: null },
      { ...run("b"), outputs: {} },
      { ...run("b"), dispositions: null },
      { ...run("b"), metrics: null },
      { ...run("b"), simulatorOutcomeFingerprint: null },
      { ...run("b"), provenanceFingerprint: "not-a-fingerprint" },
    ];
    for (const invalid of invalidSections) {
      expect(validateCompleteRunReproducibility([run("a"), invalid] as never).issues.map((x) => x.code)).toContain("INVALID_COMPLETE_RUN_EVIDENCE");
    }
  });

  it("requires exact seed-set binding and matching run fingerprints", () => {
    const seedRun = (sampleId: string, seed = 1, run = 1) => ({
      sampleId, seedSetFingerprint: fp({ seed }), canonicalInputFingerprint: fp({ input: 1 }),
      operatorFingerprint: fp({ operator: 1 }), configurationFingerprint: fp({ config: 1 }),
      runFingerprint: fp({ run }),
    });
    expect(validateSeedReproducibility([seedRun("a"), seedRun("b")]).status).toBe("PASS");
    expect(validateSeedReproducibility([seedRun("a"), seedRun("b", 2)]).status).toBe("FAIL");
    expect(validateSeedReproducibility([seedRun("a"), seedRun("b", 1, 2)]).status).toBe("FAIL");
  });

  it("detects policy divergence across at least three probes but ignores provenance-only IDs", () => {
    const probe = (sampleId: string) => ({
      ...decision(sampleId),
      actions: [{
        ...action,
        actionId: `action_probe_${sampleId}`,
        provenance: { ...action.provenance, sourceId: `probe:${sampleId}`, evidenceRefs: [`probe-evidence:${sampleId}`] },
      }],
    });
    expect(detectUncontrolledRandomness([probe("a"), probe("b"), probe("c")] as never)).toMatchObject({ checkId: "uncontrolled_randomness_detection", status: "PASS" });
    expect(detectUncontrolledRandomness([decision("a"), decision("b"), decision("c", "changed")])).toMatchObject({ status: "FAIL", issues: [{ code: "UNCONTROLLED_RANDOMNESS_DETECTED" }] });
    expect(detectUncontrolledRandomness([decision("a"), decision("b")]).status).toBe("FAIL");
  });
});
