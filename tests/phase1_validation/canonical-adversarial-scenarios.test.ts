import { describe, expect, it } from "vitest";
import {
  CANONICAL_ADVERSARIAL_FAMILIES,
  buildCanonicalAdversarialScenarioCases,
} from "../../src/evaluation/canonical-adversarial-scenarios.js";
import {
  assessArtifactBackedAcceptance,
  executeValidationPlan,
  type ValidationPlan,
} from "../../src/evaluation/validation-evidence.js";

describe("canonical adversarial decision worlds", () => {
  it("qualifies twenty distinct mechanism families without seed-count inflation", async () => {
    const cases = [...buildCanonicalAdversarialScenarioCases()];
    expect(cases).toHaveLength(20);
    expect(CANONICAL_ADVERSARIAL_FAMILIES).toHaveLength(20);
    expect(new Set(cases.map((candidate) => candidate.spec.scenarioFamily)).size).toBe(20);

    const plan: ValidationPlan = {
      version: "simulator-validation-plan/1.0.0",
      suiteId: "canonical-adversarial-public-regression",
      cases: cases.map((candidate) => candidate.spec),
    };
    const revision = "a".repeat(40);
    const artifact = await executeValidationPlan({
      codeRevision: revision,
      runId: "canonical-adversarial-public-regression",
      plan,
      executors: cases,
    });

    expect(artifact.payload.results).toHaveLength(20);
    expect(artifact.payload.results.every((row) => row.status === "PASS")).toBe(true);

    for (const row of artifact.payload.results) {
      expect(row.measurements["exactEvaluations"]).toBe(12);
      expect(row.measurements["completeActionSet"]).toBe(true);
      expect(row.measurements["completeOutcomeSupport"]).toBe(true);
      expect(row.measurements["operatorLeakFree"]).toBe(true);
      expect(row.measurements["oracleReplayVerified"]).toBe(true);
      expect(row.measurements["threeLevelBoundaryVerified"]).toBe(true);
      expect(row.measurements["causalCounterfactualVerified"]).toBe(true);
      expect(row.measurements["neutralActionIds"]).toEqual(["a0", "a1", "a2"]);
      const boundary = row.measurements["measurementBoundary"] as {
        replayVerified: boolean;
        serverOrdersPreserved: boolean;
        corruptionApplied: boolean;
      };
      expect(boundary.replayVerified).toBe(true);
      expect(boundary.serverOrdersPreserved).toBe(true);
      expect(boundary.corruptionApplied).toBe(true);
      const trap = row.measurements["trapCheck"] as {
        mechanism: boolean;
        bestActionId: string;
      };
      expect(trap.mechanism).toBe(true);
      expect(trap.bestActionId).not.toBe("a1");
    }

    const acceptance = assessArtifactBackedAcceptance(revision, [{ plan, artifact }]);
    const adversarial = acceptance.requirements.find(
      (row) => row.requirement === "adversarial_scenarios",
    )!;
    expect(adversarial.checkedCases).toBe(20);
    expect(adversarial.passedCases).toBe(20);
    expect(adversarial.distinctCoverage).toBe(20);
    expect(adversarial.requiredCoverage).toBe(20);
    expect(adversarial.status).toBe("PASS");
    expect(acceptance.overall).toBe("INCOMPLETE");
  });
});
