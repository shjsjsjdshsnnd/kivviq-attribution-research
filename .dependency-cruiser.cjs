module.exports = {
  forbidden: [
    {
      name: "action-portfolio-cannot-import-hidden-or-execution-internals",
      comment:
        "Dependencies, conflicts, characteristics, and risk contracts are operator-safe and cannot depend on simulation internals, hidden truth, prediction, evaluation, ranking, optimization, oracle state, provider execution, or economic-response internals.",
      severity: "error",
      from: {
        path: "^src/(action_dependencies|action_conflicts|action_characteristics|action_risk)(/|$)",
      },
      to: {
        path: "^src/(simulation|ground_truth|generation|customer_population|advertising_economics|cross_channel|ecommerce_economics|product_economics|prediction|evaluation|ranking|optimizer|optimization|oracle|god_mode|provider_execution|provider-execution)(/|$)",
      },
    },
    {
      name: "action-portfolio-schemas-cannot-import-upward",
      comment:
        "Pure portfolio definition schemas remain below canonical envelopes, runtime assessment, translation, and execution layers.",
      severity: "error",
      from: {
        path: "^src/(action_dependencies|action_conflicts|action_characteristics|action_risk)/schema\\.ts$",
      },
      to: {
        path: "^src/(canonical_action|compound_action|experiment|action_eligibility|action_translation|simulator_intervention|simulation)(/|$)|^src/(action_dependencies|action_conflicts|action_characteristics|action_risk)/(assessment|aggregate|validation|legacy|adapters)\\.ts$",
      },
    },
    {
      name: "canonical-action-cannot-import-portfolio-runtime",
      comment:
        "The canonical envelope may import portfolio definition schemas, never their assessment, aggregation, validation, adapter, or translation behavior.",
      severity: "error",
      from: { path: "^src/canonical_action(/|$)" },
      to: {
        path: "^src/(action_dependencies|action_conflicts|action_characteristics|action_risk)/(assessment|aggregate|validation|legacy|adapters)\\.ts$",
      },
    },
    {
      name: "action-portfolio-assessments-use-public-contracts-only",
      comment:
        "Portfolio assessment may depend on canonical definitions and public evidence/readiness contracts, but cannot reach translation, execution, or unrelated implementation layers.",
      severity: "error",
      from: {
        path: "^src/((action_dependencies|action_conflicts)/assessment|action_characteristics/(validation|aggregate)|action_risk/aggregate)\\.ts$",
      },
      to: {
        path: "^src/",
        pathNot: "^src/(core|observation|canonical_action|compound_action|action_timing|action_constraints|action_eligibility|experiment|investigation|action_dependencies|action_conflicts|action_characteristics|action_risk)(/|$)",
      },
    },
    {
      name: "action-translation-must-use-portfolio-assessments",
      comment:
        "Translation consumes portfolio assessment APIs and cannot bypass them by importing portfolio definitions, adapters, legacy conversion, aggregation, or validation modules directly.",
      severity: "error",
      from: {
        path: "^src/action_translation(/|$)",
      },
      to: {
        path: "^src/(action_dependencies|action_conflicts)/(schema|adapters|legacy)\\.ts$|^src/(action_characteristics|action_risk)/(schema|aggregate|validation|legacy)\\.ts$",
      },
    },
    {
      name: "experiment-eligibility-cannot-import-decision-or-execution-internals",
      comment:
        "Experiment definitions, hard constraints, and eligibility may use operator evidence contracts but cannot import hidden state, evaluation, ranking, optimization, simulator internals, or provider execution.",
      severity: "error",
      from: {
        path: "^src/(experiment|action_constraints|action_eligibility)(/|$)",
      },
      to: {
        path: "^src/(simulation|ground_truth|evaluation|ranking|optimizer|optimization|provider_execution|provider-execution|oracle|god_mode)(/|$)",
      },
    },
    {
      name: "operator-facing-code-cannot-import-god-mode",
      comment:
        "Operator-facing modules must never depend on GroundTruth, generation, latent customers, simulation, advertising economics, cross-channel interactions, ecommerce economics, product economics, evaluator/oracle, or other God-mode internals.",
      severity: "error",
      from: {
        path: "^(src/(observation|operator|operator_safe|business_state|action_ontology|canonical_action|compound_action|decision_forms|investigation|population|action_timing|action_translation|simulator_intervention|paid_media|pricing|promotion|shipping|merchandising|inventory|cro|lifecycle|experiment|action_constraints|action_eligibility)(/|$)|src/index\\.ts$)",
      },
      to: {
        path: "^src/(ground_truth|generation|customer_population|simulation|advertising_economics|cross_channel|ecommerce_economics|product_economics|evaluation|oracle|god_mode)(/|$)",
      },
    },
    {
      name: "action-timing-cannot-depend-on-translation-or-intervention",
      comment:
        "Canonical Action timing must remain independent of simulator intervention and translation implementation details.",
      severity: "error",
      from: {
        path: "^src/(action_timing|population|canonical_action|compound_action|decision_forms|investigation)(/|$)",
      },
      to: {
        path: "^src/(action_translation|simulator_intervention)(/|$)",
      },
    },
    {
      name: "action-ontology-cannot-depend-on-translation-or-intervention",
      comment:
        "Canonical business Actions must remain independent of simulator intervention and translation implementation details.",
      severity: "error",
      from: {
        path: "^src/action_ontology(/|$)",
      },
      to: {
        path: "^src/(action_translation|simulator_intervention)(/|$)",
      },
    },
    {
      name: "simulator-intervention-contract-cannot-depend-on-actions",
      comment:
        "SimulatorIntervention is a simulator-native contract and must not import the business Action ontology.",
      severity: "error",
      from: {
        path: "^src/simulator_intervention(/|$)",
      },
      to: {
        path: "^src/action_ontology(/|$)",
      },
    },
    {
      name: "paid-media-business-language-cannot-depend-on-simulator",
      comment:
        "Paid-media business Actions may depend on canonical Action contracts but not translation adapters or simulator-specific contracts.",
      severity: "error",
      from: {
        path: "^src/paid_media(/|$)",
      },
      to: {
        path: "^src/(action_translation|simulator_intervention|simulation)(/|$)",
      },
    },
    {
      name: "pricing-business-language-cannot-depend-on-simulator",
      comment:
        "Pricing business Actions and rollback readiness may depend on canonical Action contracts but not translation adapters, simulator-specific contracts, product-economics God-mode modules, evaluators or oracle state.",
      severity: "error",
      from: {
        path: "^src/pricing(/|$)",
      },
      to: {
        path: "^src/(action_translation|simulator_intervention|simulation|product_economics|evaluation|oracle|god_mode|ground_truth)(/|$)",
      },
    },
    {
      name: "promotion-business-language-cannot-depend-on-simulator",
      comment:
        "Promotion business Actions, eligibility and conflict contracts may depend on canonical Action contracts but not simulator internals, evaluator/oracle, optimizer or provider-execution layers.",
      severity: "error",
      from: {
        path: "^src/promotion(/|$)",
      },
      to: {
        path: "^src/(action_translation|simulator_intervention|simulation|evaluation|oracle|god_mode|ground_truth|product_economics)(/|$)",
      },
    },
    {
      name: "shipping-business-language-cannot-depend-on-simulator",
      comment:
        "Shipping business Actions, eligibility, rollback and conflict contracts may depend on canonical Action contracts but not simulator internals, evaluator/oracle, optimizer, provider execution or Step 8 God-mode economics.",
      severity: "error",
      from: {
        path: "^src/shipping(/|$)",
      },
      to: {
        path: "^src/(action_translation|simulator_intervention|simulation|evaluation|oracle|god_mode|ground_truth|product_economics)(/|$)",
      },
    },
    {
      name: "merchandising-business-language-cannot-depend-on-simulator",
      comment:
        "Merchandising business Actions, ranking snapshots, eligibility, rollback and conflict contracts may depend on canonical Action contracts but not simulator internals, evaluator/oracle, optimizer, search/personalization engines or Step 8 God-mode economics.",
      severity: "error",
      from: {
        path: "^src/merchandising(/|$)",
      },
      to: {
        path: "^src/(action_translation|simulator_intervention|simulation|evaluation|oracle|god_mode|ground_truth|product_economics)(/|$)",
      },
    },
    {
      name: "inventory-business-language-cannot-depend-on-simulator",
      comment:
        "Inventory business Actions, eligibility, procurement economics and rollback readiness may depend on canonical Action contracts but not simulator internals, evaluator/oracle, optimizer, supplier execution, forecasting or Step 8 God-mode product economics.",
      severity: "error",
      from: {
        path: "^src/inventory(/|$)",
      },
      to: {
        path: "^src/(action_translation|simulator_intervention|simulation|evaluation|oracle|god_mode|ground_truth|product_economics)(/|$)",
      },
    },
    {
      name: "cro-business-language-cannot-depend-on-simulator",
      comment:
        "CRO business Actions, structure snapshots, eligibility, rollback and conflict contracts may depend on canonical Action contracts but not simulator internals, evaluator/oracle, optimizer, experiment outcomes, recommendation ranking, personalization/search engines or provider-specific frontend implementation.",
      severity: "error",
      from: {
        path: "^src/cro(/|$)",
      },
      to: {
        path: "^src/(action_translation|simulator_intervention|simulation|evaluation|oracle|god_mode|ground_truth|product_economics)(/|$)",
      },
    },
    {
      name: "lifecycle-business-language-cannot-depend-on-simulator",
      comment:
        "Lifecycle business Actions, eligibility, flow-conflict and rollback contracts may depend on canonical Action contracts but not simulator internals, evaluator/oracle, optimizer, experiment outcomes, provider execution, message generation or future customer prediction.",
      severity: "error",
      from: {
        path: "^src/lifecycle(/|$)",
      },
      to: {
        path: "^src/(action_translation|simulator_intervention|simulation|evaluation|oracle|god_mode|ground_truth|product_economics)(/|$)",
      },
    },
    {
      name: "simulator-cannot-interpret-business-actions",
      comment:
        "Simulator internals receive typed SimulatorIntervention objects and must not import canonical Actions or the translation layer directly.",
      severity: "error",
      from: {
        path: "^src/simulation(/|$)",
      },
      to: {
        path: "^src/(action_ontology|action_translation)(/|$)",
      },
    },
  ],
  options: {
    doNotFollow: {
      path: "node_modules",
    },
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: "tsconfig.json",
    },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
    },
  },
};
