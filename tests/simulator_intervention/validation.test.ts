import { describe, expect, it } from "vitest";
import {
  fullTranslationContext,
  increaseGoogleShoppingBudget20,
} from "../../src/action_translation/fixtures.js";
import { translateBusinessAction } from "../../src/action_translation/translate.js";
import {
  interventionFingerprint,
} from "../../src/simulator_intervention/semantics.js";
import {
  validateSimulatorIntervention,
} from "../../src/simulator_intervention/validation.js";

describe("SimulatorIntervention contract", () => {
  it("validates translated interventions and fingerprints them deterministically", () => {
    const result = translateBusinessAction(
      increaseGoogleShoppingBudget20,
      fullTranslationContext,
    );
    expect(result.status).toBe("TRANSLATED");
    if (result.status !== "TRANSLATED") return;

    const intervention = result.interventions[0]!;
    expect(validateSimulatorIntervention(intervention).ok).toBe(true);
    expect(interventionFingerprint(intervention)).toBe(
      interventionFingerprint(intervention),
    );
    expect(intervention.interventionId).toMatch(/^intervention_[a-f0-9]{16}$/);
  });

  it("rejects unsupported intervention schema versions", () => {
    const result = translateBusinessAction(
      increaseGoogleShoppingBudget20,
      fullTranslationContext,
    );
    expect(result.status).toBe("TRANSLATED");
    if (result.status !== "TRANSLATED") return;

    const invalid = {
      ...result.interventions[0]!,
      schemaVersion: "9.0.0",
    };

    const validation = validateSimulatorIntervention(invalid);
    expect(validation.ok).toBe(false);
    if (!validation.ok) {
      expect(
        validation.errors.some(
          (issue) => issue.code === "UNSUPPORTED_INTERVENTION_SCHEMA",
        ),
      ).toBe(true);
    }
  });
});
