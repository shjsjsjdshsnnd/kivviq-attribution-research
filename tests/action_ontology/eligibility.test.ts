import { describe, expect, it } from "vitest";
import {
  eligibilityInformationRequirements,
  type ActionEligibilityEvaluator,
} from "../../src/action_ontology/eligibility.js";
import { increaseGoogleShoppingBudget20 } from "../../src/action_ontology/fixtures.js";

describe("Action eligibility contract", () => {
  it("declares the information needed by a future eligibility evaluator", () => {
    const requirements = eligibilityInformationRequirements(
      increaseGoogleShoppingBudget20,
    );

    expect(
      requirements.some(
        (requirement) =>
          requirement.kind === "business_property" &&
          requirement.reference === "budget.available_minor",
      ),
    ).toBe(true);

    expect(
      requirements.some(
        (requirement) => requirement.kind === "entity_presence",
      ),
    ).toBe(true);

    expect(
      requirements.some(
        (requirement) =>
          requirement.reference === "finance.gross_margin_rate",
      ),
    ).toBe(false);
  });

  it("supports tri-state eligibility without requiring a Business State engine", () => {
    const evaluator: ActionEligibilityEvaluator = {
      isEligible() {
        return {
          status: "unknown",
          failedConstraintIds: [],
          missingEvidenceRefs: ["budget.available_minor"],
          reasonCodes: ["INSUFFICIENT_EVIDENCE"],
        };
      },
    };

    expect(
      evaluator.isEligible(increaseGoogleShoppingBudget20, {
        readProperty() {
          return { status: "unknown", reason: "not loaded" };
        },
        entityExists() {
          return { status: "known", value: true };
        },
        capabilityAvailable() {
          return { status: "known", value: true };
        },
        evidenceAvailable() {
          return { status: "unknown", reason: "not loaded" };
        },
      }).status,
    ).toBe("unknown");
  });
});
