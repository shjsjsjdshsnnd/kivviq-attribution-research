import { describe, expect, it } from "vitest";
import { doNothingAction, investigateTrackingAnomaly } from "../../src/action_ontology/fixtures.js";
import { validateAction } from "../../src/action_ontology/validation.js";
import { translateBusinessAction } from "../../src/action_translation/translate.js";
import { fullTranslationContext } from "../../src/action_translation/fixtures.js";

const clone = (v: unknown): any => JSON.parse(JSON.stringify(v));

describe("Steps 14–15 decision forms", () => {
  it("preserves scoped NO_OP as an explicit zero-intervention decision", () => {
    for (const target of [
      { kind: "merchant", merchantId: "merchant:synthetic" },
      { kind: "advertising_channel", channelId: "google" },
      { kind: "sku", skuId: "sku-a" },
      { kind: "customer_segment", segmentId: "segment-x" },
    ]) {
      const action = { ...doNothingAction, target };
      expect(validateAction(action).ok).toBe(true);
      const translated = translateBusinessAction(action, fullTranslationContext);
      expect(translated.status).toBe("TRANSLATED");
      if (translated.status === "TRANSLATED") expect(translated.interventions).toEqual([]);
    }
    expect(validateAction(null).ok).toBe(false);
    expect(validateAction([]).ok).toBe(false);
  });

  it("keeps investigation separate from NO_OP and from findings", () => {
    const action = clone(investigateTrackingAnomaly);
    action.parameters = {
      kind: "investigate", investigationType: "TRACKING_AUDIT",
      question: "Are purchase events duplicated?", sourceRef: "ga4",
      metricRef: "purchase", requestedEvidenceRefs: ["ga4.purchase", "shopify.orders"],
      observationWindow: { start: "2026-08-27T00:00:00Z", end: "2026-09-26T00:00:00Z" },
      maximumInvestigationHorizonSeconds: 172800,
    };
    expect(validateAction(action).ok).toBe(true);
    const result = translateBusinessAction(action, fullTranslationContext);
    expect(result.status).toBe("TRANSLATED");
    if (result.status === "TRANSLATED") expect(result.interventions).toEqual([]);
    action.parameters.findings = ["GA4 duplicates purchases"];
    expect(validateAction(action).ok).toBe(false);
  });

  it("requires explicit missing facts and anomaly baselines", () => {
    const missing = clone(investigateTrackingAnomaly);
    missing.parameters.investigationType = "MISSING_DATA_REQUEST";
    expect(validateAction(missing).ok).toBe(false);
    missing.parameters.targetRef = "sku:A";
    missing.parameters.metricRef = "cogs_per_unit";
    expect(validateAction(missing).ok).toBe(true);

    const anomaly = clone(missing);
    anomaly.parameters.investigationType = "ANOMALY_DIAGNOSIS";
    expect(validateAction(anomaly).ok).toBe(false);
    anomaly.parameters.observationWindow = { start: "2026-09-19T00:00:00Z", end: "2026-09-26T00:00:00Z" };
    anomaly.parameters.comparisonWindow = { start: "2026-09-12T00:00:00Z", end: "2026-09-19T00:00:00Z" };
    expect(validateAction(anomaly).ok).toBe(true);
    anomaly.parameters.comparisonWindow.end = anomaly.parameters.comparisonWindow.start;
    expect(validateAction(anomaly).ok).toBe(false);
  });

  it("rejects outcome leakage for both forms", () => {
    for (const original of [doNothingAction, investigateTrackingAnomaly]) {
      const action = clone(original);
      action.parameters.expectedValueOfInformation = 200;
      expect(validateAction(action).ok).toBe(false);
    }
  });
});
