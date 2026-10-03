const inherited = require('./.dependency-cruiser.cjs');
module.exports = {
  ...inherited,
  forbidden: [
    ...inherited.forbidden,
    {
      name: 'decision-optimizer-cannot-import-hidden-truth-or-execution',
      severity: 'error',
      from: { path: '^src/decision_optimizer(/|$)' },
      to: { path: '^src/(ground_truth|generation|customer_population|simulation|advertising_economics|cross_channel|ecommerce_economics|product_economics|inventory_dynamics|pricing_promotions|retention_ltv|website_cro|external_reality|measurement_corruption|evaluation|oracle|god_mode|provider_execution)(/|$)' },
    },
    {
      name: 'action-definitions-cannot-depend-on-decision-optimizer',
      severity: 'error',
      from: { path: '^src/(action_ontology|canonical_action|action_dependencies|action_conflicts|action_constraints|action_eligibility|action_characteristics|action_risk|action_outcomes|action_validation|opportunity_engine)(/|$)' },
      to: { path: '^src/decision_optimizer(/|$)' },
    },
  ],
};
