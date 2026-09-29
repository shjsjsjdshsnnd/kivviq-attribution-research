import { describe, expect, it } from "vitest";
import type {
  ActionRiskContractDimension,
  ActionRiskDimension,
} from "../../src/index.js";

const legacyRisk: ActionRiskDimension = {
  dimension: "financial_downside",
  downsideDefinition: "Gross margin loss in the action window",
};
const contractRisk: ActionRiskContractDimension = "FINANCIAL_DOWNSIDE";

describe("root action risk type compatibility", () => {
  it("preserves the legacy object type beside the new contract dimension alias", () => {
    expect(legacyRisk).toEqual({
      dimension: "financial_downside",
      downsideDefinition: "Gross margin loss in the action window",
    });
    expect(contractRisk).toBe("FINANCIAL_DOWNSIDE");
  });
});
