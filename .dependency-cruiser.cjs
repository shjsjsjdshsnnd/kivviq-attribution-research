module.exports = {
  forbidden: [
    {
      name: "operator-facing-code-cannot-import-god-mode",
      comment:
        "Operator-facing and shared-core modules may not depend on latent worlds, perfect feeds, corruption diagnostics, evaluator manifests or oracle answers.",
      severity: "error",
      from: {
        path: "^(src/(core|observation|operator|operator_safe|business_state|diagnosis|diagnosis_integration)(/|$)|src/index\\.ts$)",
      },
      to: {
        path: "^src/(ground_truth|generation|customer_population|simulation|advertising_economics|cross_channel|ecommerce_economics|product_economics|inventory_dynamics|pricing_promotions|retention_ltv|website_cro|external_reality|measurement_corruption|evaluation|oracle|god_mode)(/|$)",
      },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: { exportsFields: ["exports"] },
  },
};
