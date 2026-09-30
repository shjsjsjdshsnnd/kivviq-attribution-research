import assert from "node:assert/strict";

const [root, dependencies, conflicts, characteristics, risk] = await Promise.all([
  import("@kivviq/growth-operator-research"),
  import("@kivviq/growth-operator-research/action-dependencies"),
  import("@kivviq/growth-operator-research/action-conflicts"),
  import("@kivviq/growth-operator-research/action-characteristics"),
  import("@kivviq/growth-operator-research/action-risk"),
]);

for (const [name, value] of [
  ["root actionDependencySchema", root.actionDependencySchema],
  ["root assessPortfolioCompatibility", root.assessPortfolioCompatibility],
  ["root validateActionCharacteristics", root.validateActionCharacteristics],
  ["root validateRiskMeasurementContracts", root.validateRiskMeasurementContracts],
  ["dependency subpath", dependencies.assessActionDependencies],
  ["conflict subpath", conflicts.assessPortfolioCompatibility],
  ["characteristics subpath", characteristics.aggregateActionCharacteristics],
  ["risk subpath", risk.describeActionRiskContracts],
]) assert.ok(value, `${name} must be exported from the built package`);
