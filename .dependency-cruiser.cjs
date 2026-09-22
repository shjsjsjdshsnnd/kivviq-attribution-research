module.exports = {
  forbidden: [
    {
      name: "operator-facing-code-cannot-import-god-mode",
      comment:
        "Operator-facing modules must never depend on GroundTruth, generation, latent customers, simulation, advertising economics, cross-channel interactions, ecommerce economics, product economics, evaluator/oracle, or other God-mode internals.",
      severity: "error",
      from: {
        path: "^(src/(observation|operator|operator_safe|action_ontology|action_translation|simulator_intervention|paid_media|pricing|promotion|shipping|merchandising|inventory)(/|$)|src/index\\.ts$)",
      },
      to: {
        path: "^src/(ground_truth|generation|customer_population|simulation|advertising_economics|cross_channel|ecommerce_economics|product_economics|evaluation|oracle|god_mode)(/|$)",
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
