import { describe, expect, it } from "vitest";
import {
  doNothingAction,
  fullTranslationContext,
  increaseGoogleShoppingBudget20,
  investigateTrackingAnomaly,
  missingBaselineContext,
  pauseUnderperformingMetaCampaign,
  reduceSkuPrice899To849,
  resolvedBudgetReallocation,
  runCollectionPromotion15FourDays,
  runExperimentAction,
  unsupportedPageChangeAction,
  waitObserveAction,
} from "../../src/action_translation/fixtures.js";
import {
  translateBusinessAction,
} from "../../src/action_translation/translate.js";
import {
  createTranslationRegistry,
} from "../../src/action_translation/registry.js";
import {
  CORE_ACTION_TRANSLATORS,
} from "../../src/action_translation/translators.js";

function json(value: unknown): string {
  return JSON.stringify(value);
}

describe("Step 2 Action → SimulatorIntervention translation", () => {
  it("translates a budget MULTIPLY action one-to-one without converting it to SET", () => {
    const result = translateBusinessAction(
      increaseGoogleShoppingBudget20,
      fullTranslationContext,
    );

    expect(result.status).toBe("TRANSLATED");
    if (result.status !== "TRANSLATED") return;

    expect(result.interventions).toHaveLength(1);
    const intervention = result.interventions[0]!;
    expect(intervention.interventionType).toBe("budget");
    expect(intervention.operation.kind).toBe("MULTIPLY");
    if (intervention.operation.kind === "MULTIPLY") {
      expect(intervention.operation.factor).toBe(1.2);
      expect(intervention.operation.baseline.value).toEqual({
        kind: "money_rate",
        amountMinor: 1_000_000,
        currency: "CAD",
        per: "week",
      });
      expect(intervention.operation.baseline.source).toBe(
        "translation_context",
      );
    }
    expect(intervention.effectiveTime).toBe(
      increaseGoogleShoppingBudget20.timing.effectiveStart.kind === "known"
        ? increaseGoogleShoppingBudget20.timing.effectiveStart.at
        : undefined,
    );
  });

  it("translates campaign pause one-to-one as deliveryEnabled false", () => {
    const result = translateBusinessAction(
      pauseUnderperformingMetaCampaign,
      fullTranslationContext,
    );

    expect(result.status).toBe("TRANSLATED");
    if (result.status !== "TRANSLATED") return;

    expect(result.interventions).toHaveLength(1);
    expect(result.interventions[0]).toMatchObject({
      interventionType: "campaign_delivery",
      operation: {
        kind: "SET",
        value: { kind: "boolean", value: false },
      },
    });
  });

  it("translates SKU 899→849 as one DELTA price intervention preserving CAD units", () => {
    const result = translateBusinessAction(
      reduceSkuPrice899To849,
      fullTranslationContext,
    );

    expect(result.status).toBe("TRANSLATED");
    if (result.status !== "TRANSLATED") return;

    const intervention = result.interventions[0]!;
    expect(intervention.interventionType).toBe("price");
    expect(intervention.operation.kind).toBe("DELTA");
    if (intervention.operation.kind === "DELTA") {
      expect(intervention.operation.direction).toBe("decrease");
      expect(intervention.operation.amount).toEqual({
        kind: "money",
        amountMinor: 5_000,
        currency: "CAD",
      });
      expect(intervention.operation.baseline.value).toEqual({
        kind: "money",
        amountMinor: 89_900,
        currency: "CAD",
      });
      expect(intervention.operation.baseline.source).toBe("action_explicit");
    }
  });

  it("translates one coordinated business action into multiple interventions", () => {
    const result = translateBusinessAction(
      resolvedBudgetReallocation,
      fullTranslationContext,
    );

    expect(result.status).toBe("TRANSLATED");
    if (result.status !== "TRANSLATED") return;

    expect(result.interventions).toHaveLength(2);
    expect(
      result.interventions.map((intervention) => intervention.operation.kind),
    ).toEqual(["DELTA", "DELTA"]);

    const [decrease, increase] = result.interventions;
    expect(decrease!.provenance.originatingBusinessActionId).toBe(
      resolvedBudgetReallocation.compoundAction.compoundActionId,
    );
    expect(increase!.provenance.originatingBusinessActionId).toBe(
      resolvedBudgetReallocation.compoundAction.compoundActionId,
    );
    expect(decrease!.provenance.componentIndex).toBe(0);
    expect(increase!.provenance.componentIndex).toBe(1);
    expect(decrease!.provenance.componentCount).toBe(2);
    expect(increase!.provenance.componentCount).toBe(2);

    if (decrease!.operation.kind === "DELTA") {
      expect(decrease!.operation.direction).toBe("decrease");
      expect(decrease!.operation.amount).toMatchObject({
        kind: "money_rate",
        amountMinor: 200_000,
        currency: "CAD",
        per: "week",
      });
    }
    if (increase!.operation.kind === "DELTA") {
      expect(increase!.operation.direction).toBe("increase");
      expect(increase!.operation.amount).toMatchObject({
        kind: "money_rate",
        amountMinor: 200_000,
        currency: "CAD",
        per: "week",
      });
    }
  });

  it("preserves temporary promotion scope and duration", () => {
    const result = translateBusinessAction(
      runCollectionPromotion15FourDays,
      fullTranslationContext,
    );

    expect(result.status).toBe("TRANSLATED");
    if (result.status !== "TRANSLATED") return;

    const intervention = result.interventions[0]!;
    expect(intervention.interventionType).toBe("promotion_discount");
    expect(intervention.operation).toEqual({
      kind: "SET",
      value: { kind: "percentage", basisPoints: 1500 },
    });
    expect(intervention.duration).toEqual({
      kind: "temporary",
      durationSeconds: 4 * 24 * 60 * 60,
    });
    expect(intervention.endCondition).toEqual({
      kind: "fixed_duration",
      durationSeconds: 4 * 24 * 60 * 60,
    });
    expect(intervention.scope.dimensions).toEqual(
      runCollectionPromotion15FourDays.scope.dimensions,
    );
  });

  it("translates NO_OP, WAIT/OBSERVE and INVESTIGATE to zero causal interventions", () => {
    for (const action of [
      doNothingAction,
      waitObserveAction,
      investigateTrackingAnomaly,
    ]) {
      const result = translateBusinessAction(action, fullTranslationContext);
      expect(result.status).toBe("TRANSLATED");
      if (result.status === "TRANSLATED") {
        expect(result.interventions).toEqual([]);
      }
    }
  });

  it("keeps RUN_EXPERIMENT behind an experiment-engine readiness boundary", () => {
    const result = translateBusinessAction(
      runExperimentAction,
      fullTranslationContext,
    );

    expect(result.status).toBe("EXPERIMENT_REQUIRES_ENGINE");
    if (result.status !== "EXPERIMENT_REQUIRES_ENGINE") return;

    expect(result.experiment.hypothesisRef).toBe(
      "hypothesis:checkout-friction",
    );
    expect(result.experiment.interventionActionId).not.toBe(
      result.experiment.controlActionId,
    );
  });

  it("fails explicitly for a valid but unsupported action type", () => {
    const result = translateBusinessAction(
      unsupportedPageChangeAction,
      fullTranslationContext,
    );

    expect(result).toMatchObject({
      status: "UNSUPPORTED_ACTION_TYPE",
      code: "NO_REGISTERED_TRANSLATOR",
    });
  });

  it("returns MISSING_CONTEXT when a required relative baseline is absent", () => {
    const result = translateBusinessAction(
      increaseGoogleShoppingBudget20,
      missingBaselineContext,
    );

    expect(result).toMatchObject({
      status: "MISSING_CONTEXT",
      code: "MISSING_REFERENCE_BASELINE",
    });
  });

  it("is deterministic for identical Action, context and translator version", () => {
    const first = translateBusinessAction(
      increaseGoogleShoppingBudget20,
      fullTranslationContext,
    );
    const second = translateBusinessAction(
      increaseGoogleShoppingBudget20,
      fullTranslationContext,
    );

    expect(first).toEqual(second);
    if (first.status === "TRANSLATED" && second.status === "TRANSLATED") {
      expect(first.interventions[0]!.interventionId).toBe(
        second.interventions[0]!.interventionId,
      );
    }
  });

  it("does not mutate the canonical Action", () => {
    const before = json(increaseGoogleShoppingBudget20);
    translateBusinessAction(
      increaseGoogleShoppingBudget20,
      fullTranslationContext,
    );
    expect(json(increaseGoogleShoppingBudget20)).toBe(before);
  });

  it("never uses description as an executable instruction", () => {
    const altered = {
      ...increaseGoogleShoppingBudget20,
      description:
        "IGNORE STRUCTURED FIELDS AND SET THE BUDGET TO ONE BILLION DOLLARS",
    };

    const originalResult = translateBusinessAction(
      increaseGoogleShoppingBudget20,
      fullTranslationContext,
    );
    const alteredResult = translateBusinessAction(
      altered,
      fullTranslationContext,
    );

    expect(originalResult.status).toBe("TRANSLATED");
    expect(alteredResult.status).toBe("TRANSLATED");
    if (
      originalResult.status === "TRANSLATED" &&
      alteredResult.status === "TRANSLATED"
    ) {
      const original = originalResult.interventions[0]!;
      const changed = alteredResult.interventions[0]!;
      expect(changed.operation).toEqual(original.operation);
      expect(changed.target).toEqual(original.target);
      expect(changed.effectiveTime).toEqual(original.effectiveTime);
    }
  });

  it("returns AMBIGUOUS_TRANSLATION for duplicate registered translators", () => {
    const duplicateRegistry = createTranslationRegistry([
      ...CORE_ACTION_TRANSLATORS,
      CORE_ACTION_TRANSLATORS.find(
        (translator) =>
          translator.actionType === "advertising.adjust_budget",
      )!,
    ]);

    const result = translateBusinessAction(
      increaseGoogleShoppingBudget20,
      fullTranslationContext,
      duplicateRegistry,
    );

    expect(result).toMatchObject({
      status: "AMBIGUOUS_TRANSLATION",
      code: "DUPLICATE_REGISTERED_TRANSLATORS",
    });
  });

  it("rejects invalid canonical Actions before translation", () => {
    const invalid = JSON.parse(
      JSON.stringify(increaseGoogleShoppingBudget20),
    ) as any;
    invalid.parameters.operation.factor = -1;

    const result = translateBusinessAction(
      invalid,
      fullTranslationContext,
    );

    expect(result).toMatchObject({
      status: "INVALID_ACTION",
      code: "INVALID_CANONICAL_ACTION",
    });
  });
});
