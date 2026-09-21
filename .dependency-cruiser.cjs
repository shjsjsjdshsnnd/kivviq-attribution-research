module.exports = {
  forbidden: [
    {
      name: "operator-facing-code-cannot-import-god-mode",
      comment:
        "Operator-facing modules must never depend on GroundTruth, generation, latent customers, simulation, advertising economics, cross-channel interactions, ecommerce economics, product economics, evaluator/oracle, or other God-mode internals.",
      severity: "error",
      from: {
        path: "^(src/(observation|operator|operator_safe|action_ontology|action_translation|simulator_intervention|paid_media)(/|$)|src/index\\.ts$)",
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
