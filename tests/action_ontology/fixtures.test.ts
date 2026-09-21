import { describe, expect, it } from "vitest";
import {
  budgetReallocationReadiness,
  doNothingAction,
  increaseGoogleShoppingBudget20,
  increaseGoogleShoppingBudgetBy1000,
  investigateTrackingAnomaly,
  reorderInventoryWith45DayDelay,
  runExperimentAction,
  setGoogleShoppingBudgetAbsolute,
  waitObserveAction,
} from "../../src/action_ontology/fixtures.js";

describe("Action ontology fixtures", () => {
  it("makes SET, DELTA and MULTIPLY explicit", () => {
    expect(setGoogleShoppingBudgetAbsolute.parameters.kind).toBe(
      "budget_adjustment",
    );
    if (setGoogleShoppingBudgetAbsolute.parameters.kind === "budget_adjustment") {
      expect(setGoogleShoppingBudgetAbsolute.parameters.operation.kind).toBe("SET");
    }

    if (increaseGoogleShoppingBudgetBy1000.parameters.kind === "budget_adjustment") {
      expect(increaseGoogleShoppingBudgetBy1000.parameters.operation.kind).toBe(
        "DELTA",
      );
    }

    if (increaseGoogleShoppingBudget20.parameters.kind === "budget_adjustment") {
      expect(increaseGoogleShoppingBudget20.parameters.operation.kind).toBe(
        "MULTIPLY",
      );
    }
  });

  it("distinguishes decision time from delayed effective time", () => {
    expect(reorderInventoryWith45DayDelay.timing.decisionTime).toBe(
      "2026-09-21T13:00:00Z",
    );
    expect(reorderInventoryWith45DayDelay.timing.effectiveStart).toEqual({
      kind: "known",
      at: "2026-11-05T13:00:00Z",
    });
    expect(reorderInventoryWith45DayDelay.timing.implementationDelaySeconds).toEqual(
      {
        kind: "known",
        seconds: 45 * 24 * 60 * 60,
      },
    );
  });

  it("keeps NO_OP and WAIT/OBSERVE as distinct first-class actions", () => {
    expect(doNothingAction.actionType).toBe("no_op.do_nothing");
    expect(waitObserveAction.actionType).toBe("no_op.wait_observe");
    expect(doNothingAction.parameters.kind).toBe("no_op");
    expect(waitObserveAction.parameters.kind).toBe("wait_observe");
  });

  it("represents investigation as information-state work", () => {
    expect(investigateTrackingAnomaly.actionCategory).toBe("investigation");
    expect(investigateTrackingAnomaly.parameters.kind).toBe("investigate");
  });

  it("represents experiment output without building an experiment selector", () => {
    expect(runExperimentAction.parameters.kind).toBe("run_experiment");
    if (runExperimentAction.parameters.kind === "run_experiment") {
      expect(runExperimentAction.parameters.hypothesisRef).toBe(
        "hypothesis:checkout-friction",
      );
      expect(runExperimentAction.parameters.interventionActionId).not.toBe(
        runExperimentAction.parameters.controlActionId,
      );
    }
  });

  it("keeps compound actions as readiness-only references", () => {
    expect(budgetReallocationReadiness.kind).toBe("compound_action");
    expect(budgetReallocationReadiness.componentActionIds).toHaveLength(2);
    expect("executionPolicy" in budgetReallocationReadiness).toBe(false);
    expect("components" in budgetReallocationReadiness).toBe(false);
  });

  it("does not put evaluation, ranking or lifecycle state into Action", () => {
    expect("state" in increaseGoogleShoppingBudget20).toBe(false);
    expect("expectedProfit" in increaseGoogleShoppingBudget20).toBe(false);
    expect("predictedLift" in increaseGoogleShoppingBudget20).toBe(false);
    expect("rank" in increaseGoogleShoppingBudget20).toBe(false);
    expect("recommendationScore" in increaseGoogleShoppingBudget20).toBe(false);
  });

  it("keeps risk and uncertainty distinct", () => {
    expect(increaseGoogleShoppingBudget20.riskDimensions.length).toBeGreaterThan(0);
    expect(
      increaseGoogleShoppingBudget20.uncertaintyDimensions.length,
    ).toBeGreaterThan(0);
    expect(
      increaseGoogleShoppingBudget20.riskDimensions.some(
        (risk) => "probability" in risk || "confidence" in risk,
      ),
    ).toBe(false);
  });
});
