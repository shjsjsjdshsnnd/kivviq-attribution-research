import { describe, expect, it } from "vitest";
import {
  adaptLegacyActionCharacteristics,
  type LegacyActionCharacteristicsInput,
} from "../../src/action_characteristics/legacy.js";
import { adaptLegacyRiskDimensions } from "../../src/action_risk/legacy.js";
import { adaptLegacyDependency } from "../../src/action_dependencies/legacy.js";
import { adaptLegacyConflict } from "../../src/action_conflicts/legacy.js";

const money = (sourceKind: LegacyActionCharacteristicsInput["costs"][number]["sourceKind"], fieldRef: string, amountMinor = 125) => ({
  sourceKind,
  fieldRef,
  amountMinor,
  currency: "CAD",
} as const);

describe("legacy action portfolio adapters", () => {
  it("maps every exact monetary source kind losslessly into the seven native buckets", () => {
    const costs = [
      money("PAID_SPEND", "cost.media"),
      money("STAFF_SERVICE", "cost.staff"),
      money("PROVIDER_LICENSE", "cost.platform"),
      money("INVENTORY_ACQUISITION", "cost.inventory"),
      money("SHIPPING_HANDLING", "cost.fulfillment"),
      money("PRE_EFFECT_CANCELLATION", "cost.cancel"),
      money("OTHER_TYPED_MONETARY", "cost.other"),
    ];
    const result = adaptLegacyActionCharacteristics({
      costs,
      implementationDelaySeconds: 90,
      burdens: [],
      cancellationStages: [],
    });
    expect(result.characteristics.implementationCost.map((line) => line.category)).toEqual([
      "MEDIA", "LABOR", "PLATFORM", "PROCUREMENT", "FULFILLMENT", "CANCELLATION", "OTHER",
    ]);
    expect(result.provenance.map((item) => ({ fieldRef: item.fieldRef, amountMinor: item.amountMinor, currency: item.currency }))).toEqual(
      costs.map(({ fieldRef, amountMinor, currency }) => ({ fieldRef, amountMinor, currency })),
    );
    expect(result.timingImplementationDelay).toEqual({ amount: 90, unit: "SECOND" });
    expect(JSON.stringify(result.characteristics)).not.toContain("implementationDelay");
  });

  it("excludes ambiguous money and commitments from burden while mapping exact resource quantities", () => {
    const result = adaptLegacyActionCharacteristics({
      costs: [
        money("OTHER_TYPED_MONETARY", "negative", -1),
        { sourceKind: "OTHER_TYPED_MONETARY", fieldRef: "missing.currency", amountMinor: 1 },
      ],
      burdens: [
        { fieldRef: "staff", resourceKind: "STAFF", resourceRef: "staff.ops", quantity: 2, unit: "hours" },
        { fieldRef: "inventory", resourceKind: "INVENTORY_COMMITMENT", resourceRef: "sku.a", quantity: 2, unit: "units" },
        { fieldRef: "budget", resourceKind: "AD_BUDGET_COMMITMENT", resourceRef: "ads", quantity: 2, unit: "placements" },
      ],
      cancellationStages: [],
    } as unknown as LegacyActionCharacteristicsInput);
    expect(result.characteristics.implementationCost).toEqual([]);
    expect(result.characteristics.operationalBurden).toHaveLength(1);
    expect(result.rejected.map((item) => item.fieldRef).sort()).toEqual(["budget", "inventory", "missing.currency", "negative"]);
  });

  it("maps only exact rollback identities and defaults absent cancellation stage data to UNKNOWN", () => {
    const exact = adaptLegacyActionCharacteristics({
      costs: [], burdens: [], cancellationStages: [],
      reversibility: { classification: "FULLY_REVERSIBLE", reversal: { kind: "ACTION", actionId: "action_undo", actionFingerprint: "fnv1a64:0123456789abcdef" }, minimumDelaySeconds: 60 },
    });
    expect(exact.characteristics.reversibility.kind).toBe("FULLY_REVERSIBLE");
    expect(exact.reversibilityMinimumDelay).toEqual({ amount: 60, unit: "SECOND" });
    expect(exact.cancellation).toEqual({ state: "UNKNOWN", reason: "Legacy input has no typed stage-specific cancellation data" });

    const prose = adaptLegacyActionCharacteristics({ costs: [], burdens: [], cancellationStages: [], reversibility: { classification: "FULLY_REVERSIBLE", rollbackDescription: "undo it" } } as unknown as LegacyActionCharacteristicsInput);
    expect(prose.characteristics.reversibility.kind).toBe("UNKNOWN");
    const reachable = adaptLegacyActionCharacteristics({ costs: [], burdens: [], cancellationStages: [], reachability: { kind: "TEMPORARY_PRICE", implementationPrecedesEffect: true, hasFiniteCompletion: true } });
    expect(reachable.cancellation).toMatchObject({ state: "UNKNOWN", stages: [
      { stage: "BEFORE_START", state: "UNKNOWN" }, { stage: "IMPLEMENTING", state: "UNKNOWN" },
      { stage: "EFFECTIVE", state: "UNKNOWN" }, { stage: "COMPLETED", state: "UNKNOWN" },
    ] });
  });

  it("maps risk only from exact registered contracts and never from prose", () => {
    const result = adaptLegacyRiskDimensions({
      registeredContracts: [{ legacyRef: "risk.financial", contract: { measurementId: "metric.financial" } }],
      legacyRefs: ["risk.financial", "risk.unknown"],
      downsideDefinitions: ["large downside"],
      informationGaps: ["we do not know"],
    });
    expect(result.riskDimensions).toEqual({ state: "ABSENT" });
    expect(result.unmappedRefs).toEqual(["risk.financial", "risk.unknown"]);
    expect(JSON.stringify(result.riskDimensions)).not.toMatch(/downside|informationGap|large downside|do not know/i);
  });

  it("rejects every duplicate and generated-ID collision independent of order", () => {
    const input = {
      costs: [money("PAID_SPEND", "same field"), money("STAFF_SERVICE", "same_field")],
      burdens: [
        { fieldRef: "staff time", resourceKind: "STAFF" as const, resourceRef: "staff.ops", quantity: 1, unit: "hours" as const },
        { fieldRef: "staff_time", resourceKind: "STAFF" as const, resourceRef: "staff.ops", quantity: 1, unit: "hours" as const },
      ], cancellationStages: [],
    };
    for (const value of [input, { ...input, costs: [...input.costs].reverse(), burdens: [...input.burdens].reverse() }]) {
      const result = adaptLegacyActionCharacteristics(value as never);
      expect(result.characteristics.implementationCost).toEqual([]);
      expect(result.characteristics.operationalBurden).toEqual([]);
      expect(result.rejected).toHaveLength(4);
    }
  });

  it("isolates malformed legacy subsections without throwing away valid projections", () => {
    const result = adaptLegacyActionCharacteristics({
      costs: [null, money("PAID_SPEND", "cost.valid")],
      burdens: [
        null,
        { fieldRef: "burden.valid", resourceKind: "STAFF", resourceRef: "staff.ops", quantity: 2, unit: "hours" },
      ],
      reversibility: { classification: "FULLY_REVERSIBLE", reversal: null, minimumDelaySeconds: 30 },
      cancellationStages: [null, {
        stage: "BEFORE_START", cancellationAvailable: true,
        cancellationCost: [], compensationCost: [], operationalBurden: [],
      }],
      reachability: { kind: "TEMPORARY_PRICE", implementationPrecedesEffect: true, hasFiniteCompletion: true },
    } as unknown as LegacyActionCharacteristicsInput);

    expect(result.characteristics.implementationCost).toHaveLength(1);
    expect(result.characteristics.operationalBurden).toHaveLength(1);
    expect(result.characteristics.reversibility).toEqual({ kind: "UNKNOWN", reason: expect.any(String) });
    expect(result).not.toHaveProperty("reversibilityMinimumDelay");
    expect(result.cancellation).toMatchObject({
      state: "PRESENT",
      stages: [
        { stage: "BEFORE_START", state: "KNOWN" },
        { stage: "IMPLEMENTING", state: "UNKNOWN" },
        { stage: "EFFECTIVE", state: "UNKNOWN" },
        { stage: "COMPLETED", state: "UNKNOWN" },
      ],
    });
    expect(result.rejected.length).toBeGreaterThanOrEqual(3);
  });

  it("does not infer dependency or conflict semantics from prose", () => {
    expect(adaptLegacyDependency({ kind: "TEXT", description: "requires inventory" })).toBeUndefined();
    expect(adaptLegacyConflict({ kind: "TEXT", description: "cannot coexist" })).toBeUndefined();
    expect(adaptLegacyDependency({ kind: "EXACT_LOCAL_GATE", dependencyId: "dependency.inventory", checkId: "domain.inventory.available", evaluationBoundary: "TRANSLATION_TIME", whenUnknown: "BLOCKED" })).toMatchObject({ kind: "ELIGIBILITY_CHECK_GATE", checkId: "domain.inventory.available" });
    expect(adaptLegacyDependency({ kind: "EXACT_LOCAL_GATE", dependencyId: "dependency.inventory", checkId: "domain.inventory.available", evaluationBoundary: "TRANSLATION_TIME", whenUnknown: "future_value" })).toBeUndefined();
  });
});
