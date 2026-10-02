import { generateOpportunities, type OpportunityEngineInput } from "./generator.js";

export interface OpportunityValidationScenario {
  readonly scenarioId: string;
  readonly operatorInput: OpportunityEngineInput;
  /** Evaluator-only expected candidates. Never passed to the Opportunity Engine. */
  readonly expectedTemplateIds: readonly string[];
  /** Optional simulator/oracle metadata retained only by the evaluator. */
  readonly evaluatorTruth?: {
    readonly availableInterventionTemplateIds: readonly string[];
    readonly responseCurveRefs: readonly string[];
  };
  /** Evaluator-only candidates that would be invalid or harmful in this scenario. */
  readonly forbiddenTemplateIds?: readonly string[];
}

export interface OpportunityValidationResult {
  readonly scenarioId: string;
  readonly generatedTemplateIds: readonly string[];
  readonly missingExpected: readonly string[];
  readonly generatedForbidden: readonly string[];
  readonly candidateRecall: number;
  readonly passed: boolean;
}

export function validateOpportunityScenario(
  scenario: OpportunityValidationScenario,
): OpportunityValidationResult {
  const generated = generateOpportunities(scenario.operatorInput);
  const generatedTemplateIds = [...new Set(
    generated.opportunities
      .filter((item) => item.status !== "NO_ACTION")
      .map((item) => item.intervention.templateId),
  )].sort();
  const generatedSet = new Set(generatedTemplateIds);
  const expected = [...new Set(scenario.expectedTemplateIds)].sort();
  if (scenario.evaluatorTruth) {
    const available = new Set(scenario.evaluatorTruth.availableInterventionTemplateIds);
    for (const templateId of expected) {
      if (!available.has(templateId)) throw new Error("Expected candidate is not available in evaluator truth: " + templateId);
    }
  }
  const forbidden = [...new Set(scenario.forbiddenTemplateIds ?? [])].sort();
  const missingExpected = expected.filter((templateId) => !generatedSet.has(templateId));
  const generatedForbidden = forbidden.filter((templateId) => generatedSet.has(templateId));
  return {
    scenarioId: scenario.scenarioId,
    generatedTemplateIds,
    missingExpected,
    generatedForbidden,
    candidateRecall: expected.length === 0 ? 1 : (expected.length - missingExpected.length) / expected.length,
    passed: missingExpected.length === 0 && generatedForbidden.length === 0,
  };
}

export function validateOpportunityScenarioSuite(
  scenarios: readonly OpportunityValidationScenario[],
): {
  readonly results: readonly OpportunityValidationResult[];
  readonly passed: boolean;
  readonly meanCandidateRecall: number;
} {
  const results = scenarios.map(validateOpportunityScenario);
  return {
    results,
    passed: results.every((result) => result.passed),
    meanCandidateRecall: results.length === 0
      ? 1
      : results.reduce((sum, result) => sum + result.candidateRecall, 0) / results.length,
  };
}
