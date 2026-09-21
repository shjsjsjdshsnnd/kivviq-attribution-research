import { describe, expect, it } from "vitest";
import { increaseGoogleShoppingBudget20 } from "../../src/action_ontology/fixtures.js";
import {
  canTransitionActionState,
  transitionActionState,
} from "../../src/action_ontology/lifecycle.js";

describe("Step 2.1 Action lifecycle", () => {
  it("keeps ACCEPTED distinct from IMPLEMENTED", () => {
    const accepted = transitionActionState(
      increaseGoogleShoppingBudget20,
      "ACCEPTED",
    );

    expect(accepted.state).toBe("ACCEPTED");
    expect(accepted.state).not.toBe("IMPLEMENTED");

    const implemented = transitionActionState(accepted, "IMPLEMENTED");
    expect(implemented.state).toBe("IMPLEMENTED");
  });

  it("supports scheduling before implementation", () => {
    const accepted = transitionActionState(
      increaseGoogleShoppingBudget20,
      "ACCEPTED",
    );
    const scheduled = transitionActionState(accepted, "SCHEDULED");

    expect(transitionActionState(scheduled, "IMPLEMENTED").state).toBe(
      "IMPLEMENTED",
    );
  });

  it("rejects invalid lifecycle jumps", () => {
    expect(canTransitionActionState("PROPOSED", "IMPLEMENTED")).toBe(false);
    expect(() =>
      transitionActionState(increaseGoogleShoppingBudget20, "IMPLEMENTED"),
    ).toThrow(/Invalid Action lifecycle transition/);
  });
});
