import { expect, it } from "vitest";
import { investigationExamples } from "../../src/decision_forms/fixtures.js";
const investigation = {
  ...investigationExamples.missingCogs,
  requiredEvidence: [
    {
      evidenceId: "cogs",
      reference: { kind: "FACT", ref: "unit_cogs" },
      targetRef: "sku-a",
    },
  ],
  successCriteria: [
    { kind: "EVIDENCE_COVERAGE", evidenceIds: ["cogs"], minimumCoverage: 1 },
  ],
};
import {
  validateInvestigationResult,
  checkInvestigationReadiness,
  checkInvestigationDependency,
} from "../../src/investigation/index.js";
const action = {
  actionId: "audit-a",
  actionFingerprint: "fp-a",
  what: investigation,
};
const result = {
  actionId: "audit-a",
  actionFingerprint: "fp-a",
  status: "RESOLVED",
  evidenceCollected: [{ evidenceId: "cogs", artifactRef: "artifact-a" }],
  coverage: [{ evidenceId: "cogs", fraction: 1 }],
  findings: [
    {
      findingId: "finding-a",
      evidenceIds: ["cogs"],
      code: "EVIDENCE_VERIFIED",
    },
  ],
  unresolvedEvidenceIds: [],
  completedAt: "2026-09-27T12:00:00Z",
  provenance: {
    sourceRef: "audit-service",
    recordedAt: "2026-09-27T12:00:00Z",
  },
};
it("validates evidence, identity and truthful resolution before allowing dependencies", () => {
  expect(validateInvestigationResult(action, result).ok).toBe(true);
  expect(
    validateInvestigationResult(action, {
      ...result,
      actionFingerprint: "other",
    }).ok,
  ).toBe(false);
  expect(
    validateInvestigationResult(action, {
      ...result,
      coverage: [{ evidenceId: "cogs", fraction: 0.3 }],
    }).ok,
  ).toBe(false);
  expect(
    validateInvestigationResult(action, {
      ...result,
      findings: [
        {
          findingId: "finding-a",
          evidenceIds: ["missing"],
          code: "EVIDENCE_VERIFIED",
        },
      ],
    }).ok,
  ).toBe(false);
  expect(
    checkInvestigationDependency(
      {
        relation: "REQUIRES",
        actionId: "audit-a",
        actionFingerprint: "fp-a",
        requiredStatus: "RESOLVED",
      },
      action,
      result,
    ).satisfied,
  ).toBe(true);
  expect(
    checkInvestigationDependency(
      {
        relation: "REQUIRES",
        actionId: "audit-a",
        actionFingerprint: "fp-a",
        requiredStatus: "RESOLVED",
      },
      action,
      undefined,
    ).satisfied,
  ).toBe(false);
});
it("keeps readiness gates separate and unknown context blocks readiness", () => {
  expect(checkInvestigationReadiness(action, {}).status).toBe("UNKNOWN");
  const context = {
    existingTargetRefs: ["sku-a"],
    availableSourceRefs: [],
    permissions: "GRANTED",
    observationWindowValid: true,
    definedMetricRefs: [],
    definedFactRefs: ["unit_cogs"],
    registeredCustomCategories: [],
  };
  expect(checkInvestigationReadiness(action, context).status).toBe("READY");
  expect(
    checkInvestigationReadiness(action, { ...context, existingTargetRefs: [] })
      .status,
  ).toBe("BLOCKED");
  expect(
    checkInvestigationReadiness(action, { ...context, permissions: "DENIED" })
      .status,
  ).toBe("BLOCKED");
});

it("rejects false partial resolution and missing coverage provenance", () => {
  expect(
    validateInvestigationResult(action, {
      ...result,
      status: "PARTIALLY_RESOLVED",
    }).ok,
  ).toBe(false);
  expect(
    validateInvestigationResult(action, { ...result, evidenceCollected: [] })
      .ok,
  ).toBe(false);
  expect(
    validateInvestigationResult(action, {
      ...result,
      status: "UNRESOLVED",
      coverage: [],
      evidenceCollected: [],
      findings: [],
    }).ok,
  ).toBe(false);
  expect(
    validateInvestigationResult(action, {
      ...result,
      provenance: {
        sourceRef: "audit-service",
        recordedAt: "2026-09-26T12:00:00Z",
      },
    }).ok,
  ).toBe(false);
  expect(
    validateInvestigationResult(action, { ...result, expectedProfit: 100 }).ok,
  ).toBe(false);
});
it("requires source and registry availability independently", () => {
  const trackingAction = {
    ...action,
    what: investigationExamples.metaTracking,
  };
  const context = {
    existingTargetRefs: ["meta-pixel"],
    availableSourceRefs: [],
    permissions: "GRANTED",
    observationWindowValid: true,
    definedMetricRefs: [],
    definedFactRefs: ["purchase_event_trace"],
  };
  expect(
    checkInvestigationReadiness(trackingAction, context).gates["source"],
  ).toBe("BLOCKED");
  expect(
    checkInvestigationReadiness(trackingAction, {
      ...context,
      availableSourceRefs: ["meta"],
      definedEventRefs: ["purchase"],
    }).status,
  ).toBe("READY");
  const custom = {
    ...action,
    what: {
      ...investigation,
      category: {
        kind: "CUSTOM",
        registryRef: "merchant-registry",
        code: "inventory-audit",
      },
    },
  };
  expect(checkInvestigationReadiness(custom, {}).gates["taxonomy"]).toBe(
    "UNKNOWN",
  );
  expect(
    checkInvestigationReadiness(custom, { registeredCustomCategories: [] })
      .gates["taxonomy"],
  ).toBe("BLOCKED");
});
it("does not resolve or unlock dependencies when any required evidence is unaccounted for", () => {
  const incomplete = {
    ...action,
    what: {
      ...investigation,
      requiredEvidence: [
        ...investigation.requiredEvidence,
        {
          evidenceId: "missing-second",
          reference: { kind: "FACT", ref: "supplier_lead_time" },
          targetRef: "sku-a",
        },
      ],
    },
  };
  expect(validateInvestigationResult(incomplete, result).ok).toBe(false);
  expect(
    checkInvestigationDependency(
      {
        relation: "REQUIRES",
        actionId: "audit-a",
        actionFingerprint: "fp-a",
        requiredStatus: "RESOLVED",
      },
      incomplete,
      result,
    ).satisfied,
  ).toBe(false);
  expect(
    validateInvestigationResult(incomplete, {
      ...result,
      status: "PARTIALLY_RESOLVED",
      unresolvedEvidenceIds: ["missing-second"],
    }).ok,
  ).toBe(true);
});
it("requires definitions for anomaly metrics, metric targets and tracking events", () => {
  const context = {
    existingTargetRefs: ["checkout"],
    availableSourceRefs: [],
    permissions: "GRANTED",
    observationWindowValid: true,
    definedMetricRefs: [],
    definedFactRefs: ["funnel_diagnostics"],
  };
  const anomaly = { ...action, what: investigationExamples.checkoutDecline };
  expect(checkInvestigationReadiness(anomaly, context).gates["metric"]).toBe(
    "BLOCKED",
  );
  expect(
    checkInvestigationReadiness(anomaly, {
      ...context,
      definedMetricRefs: ["checkout_conversion_rate"],
    }).status,
  ).toBe("READY");
  const metricTarget = {
    ...action,
    what: { ...investigation, targets: [{ kind: "METRIC", ref: "sku-a" }] },
  };
  expect(
    checkInvestigationReadiness(metricTarget, {
      ...context,
      existingTargetRefs: ["sku-a"],
      definedFactRefs: ["unit_cogs"],
    }).gates["metric"],
  ).toBe("BLOCKED");
  const tracking = { ...action, what: investigationExamples.metaTracking };
  const trackingContext = {
    ...context,
    existingTargetRefs: ["meta-pixel"],
    availableSourceRefs: ["meta"],
    definedFactRefs: ["purchase_event_trace"],
  };
  expect(checkInvestigationReadiness(tracking, trackingContext).status).toBe(
    "UNKNOWN",
  );
  expect(
    checkInvestigationReadiness(tracking, {
      ...trackingContext,
      definedEventRefs: [],
    }).gates["event"],
  ).toBe("BLOCKED");
  expect(
    checkInvestigationReadiness(tracking, {
      ...trackingContext,
      definedEventRefs: ["purchase"],
    }).status,
  ).toBe("READY");
});
