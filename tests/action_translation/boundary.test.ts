import { describe, expect, it } from "vitest";
import {
  fullTranslationContext,
  increaseGoogleShoppingBudget20,
} from "../../src/action_translation/fixtures.js";
import {
  translateBusinessAction,
} from "../../src/action_translation/translate.js";
import {
  validateTranslationContext,
} from "../../src/action_translation/context.js";
import {
  validateSimulatorIntervention,
} from "../../src/simulator_intervention/validation.js";

describe("Step 2 information and contract boundaries", () => {
  it("rejects future/oracle/evaluator information in TranslationContext", () => {
    for (const [field, value] of [
      ["futureDemand", 1000],
      ["trueIncrementalROAS", 7.2],
      ["oracleState", { winner: "google" }],
      ["evaluatorResult", { expectedProfit: 100 }],
      ["optimizerOutput", { rank: 1 }],
    ] as const) {
      const unsafe = {
        ...fullTranslationContext,
        [field]: value,
      };

      const result = validateTranslationContext(unsafe);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failure.code).toBe(
          "FORBIDDEN_TRANSLATION_CONTEXT_INFORMATION",
        );
      }
    }
  });

  it("keeps predictions, rankings and lifecycle state out of SimulatorIntervention", () => {
    const translated = translateBusinessAction(
      increaseGoogleShoppingBudget20,
      fullTranslationContext,
    );
    expect(translated.status).toBe("TRANSLATED");
    if (translated.status !== "TRANSLATED") return;

    const base = translated.interventions[0]!;

    for (const [field, value] of [
      ["expectedProfit", 100],
      ["confidence", 0.9],
      ["recommendationScore", 0.9],
      ["lifecycleStatus", "executed"],
      ["merchantRationale", "because it is best"],
      ["futureConversions", 100],
    ] as const) {
      const unsafe = { ...base, [field]: value };
      const result = validateSimulatorIntervention(unsafe);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(
          result.errors.some(
            (issue) =>
              issue.code === "FORBIDDEN_INTERVENTION_INFORMATION",
          ),
        ).toBe(true);
      }
    }
  });

  it("preserves explicit source provenance without prediction metadata", () => {
    const translated = translateBusinessAction(
      increaseGoogleShoppingBudget20,
      fullTranslationContext,
    );
    expect(translated.status).toBe("TRANSLATED");
    if (translated.status !== "TRANSLATED") return;

    const provenance = translated.interventions[0]!.provenance;
    expect(provenance.originatingBusinessActionId).toBe(
      increaseGoogleShoppingBudget20.actionId,
    );
    expect(provenance.sourceActionId).toBe(
      increaseGoogleShoppingBudget20.actionId,
    );
    expect(provenance.translationVersion).toBe("1.0.0");
    expect(provenance.translatorId).toBe("translator.budget.v1");
    expect("confidence" in provenance).toBe(false);
    expect("expectedProfit" in provenance).toBe(false);
  });
});
