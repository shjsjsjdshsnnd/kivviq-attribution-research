import { describe, expect, it } from "vitest";
import { currencyCode } from "../../src/core/units.js";
import {
  doNothingAction,
  increaseGoogleShoppingBudget20,
  increaseGoogleShoppingBudgetBy1000,
  investigateTrackingAnomaly,
  runCollectionPromotion15FourDays,
  setGoogleShoppingBudgetAbsolute,
  waitObserveAction,
} from "../../src/action_ontology/fixtures.js";
import {
  translateActionToInterventions,
  type ActionReferenceState,
} from "../../src/action_ontology/intervention.js";

const CAD = currencyCode("CAD");

const referenceState: ActionReferenceState = {
  resolveReference(_action, _reference, expectedKind) {
    if (expectedKind === "money_rate") {
      return {
        kind: "money_rate",
        amountMinor: 1_000_000,
        currency: CAD,
        per: "week",
      };
    }
    if (expectedKind === "money") {
      return {
        kind: "money",
        amountMinor: 50_000,
        currency: CAD,
      };
    }
    throw new Error("Unexpected reference kind in fixture");
  },
};

describe("Action to Intervention boundary", () => {
  it("translates MULTIPLY deterministically using observable reference state", () => {
    const first = translateActionToInterventions(
      increaseGoogleShoppingBudget20,
      referenceState,
    );
    const second = translateActionToInterventions(
      increaseGoogleShoppingBudget20,
      referenceState,
    );

    expect(first).toEqual(second);
    expect(first).toEqual([
      {
        kind: "set_money_rate",
        target: increaseGoogleShoppingBudget20.target,
        field: "budget",
        value: {
          kind: "money_rate",
          amountMinor: 1_200_000,
          currency: CAD,
          per: "week",
        },
        effectiveStart: increaseGoogleShoppingBudget20.timing.effectiveStart,
      },
    ]);
  });

  it("translates SET without natural-language interpretation", () => {
    const result = translateActionToInterventions(
      setGoogleShoppingBudgetAbsolute,
      referenceState,
    );

    expect(result[0]).toMatchObject({
      kind: "set_money_rate",
      field: "budget",
      value: {
        amountMinor: 1_100_000,
        per: "week",
      },
    });
  });

  it("translates DELTA from its explicit baseline", () => {
    const result = translateActionToInterventions(
      increaseGoogleShoppingBudgetBy1000,
      {
        resolveReference() {
          throw new Error("Explicit baseline should not query reference state");
        },
      },
    );

    expect(result[0]).toMatchObject({
      kind: "set_money_rate",
      value: {
        amountMinor: 1_100_000,
        per: "week",
      },
    });
  });

  it("maps NO_OP, WAIT and INVESTIGATE to no causal business intervention", () => {
    expect(
      translateActionToInterventions(doNothingAction, referenceState),
    ).toEqual([]);
    expect(
      translateActionToInterventions(waitObserveAction, referenceState),
    ).toEqual([]);
    expect(
      translateActionToInterventions(investigateTrackingAnomaly, referenceState),
    ).toEqual([]);
  });

  it("fails explicitly when no typed translator exists", () => {
    expect(() =>
      translateActionToInterventions(
        runCollectionPromotion15FourDays,
        referenceState,
      ),
    ).toThrow(/No typed Action-to-Intervention translator/);
  });
});
