module.exports = {
  forbidden: [
    {
      name: "operator-facing-code-cannot-import-god-mode",
      comment:
        "Operator-facing modules must never depend on GroundTruth, generation, latent customers, simulation, advertising economics, cross-channel interactions, ecommerce economics, product economics, evaluator/oracle, or other God-mode internals.",
      severity: "error",
      from: {
        path: "^(src/(observation|operator|operator_safe|action_ontology)(/|$)|src/index\\.ts$)",
      },
      to: {
        path: "^src/(ground_truth|generation|customer_population|simulation|advertising_economics|cross_channel|ecommerce_economics|product_economics|evaluation|oracle|god_mode)(/|$)",
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
