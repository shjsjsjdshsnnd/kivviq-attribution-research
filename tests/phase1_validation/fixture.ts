import { buildMeasurementScenario } from "../../src/evaluation/scenario-library.js";
import { generateCustomerPopulation } from "../../src/customer_population/generator.js";
import { SCHEDULED_SPEND_VERSION } from "../../src/evaluation/scheduled-spend.js";
import type { ScheduledDecisionInput } from "../../src/evaluation/scheduled-decision-oracle.js";
export function scheduledFixture(): ScheduledDecisionInput {
  const built = buildMeasurementScenario("adv-013", 1410);
  const startTime = "2026-01-01T00:00:00.000Z", endTime = "2026-01-05T00:00:00.000Z";
  return { initial: { ...built.request, startTime, endTime,
    latentPopulation: generateCustomerPopulation({ merchantWorld: built.request.merchantWorld, populationSeed: 74111,
      populationConfig: { maxExplicitAgents: 12, complexity: "adversarial", maxCategoryPreferences: 4, maxProductPreferences: 6 } }),
    interventions: built.request.interventions!.filter(i => !i.variable.startsWith("marketing.")) },
    measurement: { corruption: built.controlCorruption, scope: "explicit_simulated_agents" },
    spendPlan: { version: SCHEDULED_SPEND_VERSION, periodStart: startTime, periodEnd: endTime, referencePeriodMs: 86400000,
      scope: "explicit_simulated_agents", execution: "fully_spent_time_prorated_allocation",
      initialAllocation: { meta: 10000, google_search: 20000, google_shopping: 0, pinterest: 0, affiliate: 0 }, changes: [] },
    decisionAt: "2026-01-02T00:00:00.000Z",
    candidates: [{ actionId: "a0", action: { actionId: "a0", interventions: [], actionCostMinor: 0 } },
      { actionId: "a1", action: { actionId: "a1", interventions: [], actionCostMinor: 100,
        budgetAdjustments: [{ channel: "meta", operation: "delta", amountMinor: 100000 }] } }],
    baselineActionId: "a0", actionSetVersion: "blind-trial-control/1", universeComplete: true, seeds: [1410], maximumEvaluations: 4 };
}
