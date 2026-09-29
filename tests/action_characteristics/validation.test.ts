import { describe, expect, it } from "vitest";
import { adaptLegacyAction } from "../../src/canonical_action/legacy.js";
import { fingerprintCanonicalAction } from "../../src/canonical_action/serialization.js";
import { temporarySkuA799SevenDays, rollbackTemporarySkuAToPreActionPrice } from "../../src/pricing/fixtures.js";
import { reorderSkuA100 } from "../../src/inventory/fixtures.js";
import { increaseGoogleShoppingBudget20 } from "../../src/paid_media/fixtures.js";
import { createCanonicalFixtures } from "../../src/canonical_action/fixtures.js";
import { validateActionCharacteristics } from "../../src/action_characteristics/index.js";

const cost = (id: string) => ({ lineItemId: id, category: "OTHER" as const, amount: { state: "KNOWN" as const, value: { amountMinor: 1, currency: "USD" } } });
const stage = (name: "BEFORE_START" | "IMPLEMENTING" | "COMMITTED" | "EFFECTIVE" | "COMPLETED", available = name === "BEFORE_START" || name === "IMPLEMENTING") => ({ stage: name, cancellationAvailable: available, cancellationCost: available ? [cost(`cancel.${name}`)] : [], compensationCost: available ? [] : [cost(`comp.${name}`)], operationalBurden: [] });
const reversal = { kind: "REGISTERED" as const, registryRef: "rollback.domain", code: "restore", version: "1" };
const withCharacteristics = (action: ReturnType<typeof adaptLegacyAction>, stages: ReturnType<typeof stage>[], reversibility: any = { kind: "FULLY_REVERSIBLE", reversal }) => ({
  ...action,
  characteristics: { state: "PRESENT" as const, value: { implementationCost: [], reversibility, cancellationCosts: stages, operationalBurden: [] } },
});

describe("characteristics domain validation", () => {
  it("validates the four domain stage profiles, including inventory COMMITTED", () => {
    const ad = withCharacteristics(adaptLegacyAction(increaseGoogleShoppingBudget20), [stage("BEFORE_START"), stage("IMPLEMENTING"), stage("EFFECTIVE")]);
    const inventory = withCharacteristics(adaptLegacyAction(reorderSkuA100), [stage("BEFORE_START"), stage("IMPLEMENTING"), stage("COMMITTED", false), stage("EFFECTIVE", false), stage("COMPLETED", false)], { kind: "PARTIALLY_REVERSIBLE", reversal, irreversibleEffects: [{ kind: "INVENTORY_COMMITTED", resourceRef: "inventory.sku_a", unit: "units" }] });
    const price = withCharacteristics(adaptLegacyAction(temporarySkuA799SevenDays), [stage("BEFORE_START"), stage("IMPLEMENTING"), stage("EFFECTIVE", false), stage("COMPLETED", false)]);
    const sendBase = createCanonicalFixtures().find((f) => f.action?.what.actionType === "lifecycle.send")!.action!;
    const send = { ...sendBase, characteristics: { state: "PRESENT" as const, value: { implementationCost: [], reversibility: { kind: "IRREVERSIBLE" as const, irreversibleEffects: [{ kind: "MESSAGE_DELIVERED" as const, channelRef: "channel.email" }] }, cancellationCosts: [stage("BEFORE_START"), stage("EFFECTIVE", false), stage("COMPLETED", false)], operationalBurden: [] } } };
    for (const action of [ad, inventory, price, send]) expect(validateActionCharacteristics(action, { registeredReversals: [{ ...reversal, domainActionTypes: [action.what.actionType] }] }).status).toBe("VALID");
    const missingCommitted = { ...inventory, characteristics: { ...inventory.characteristics, value: { ...inventory.characteristics.value, cancellationCosts: inventory.characteristics.value.cancellationCosts.filter((entry) => entry.stage !== "COMMITTED") } } };
    expect(validateActionCharacteristics(missingCommitted, { registeredReversals: [{ ...reversal, domainActionTypes: [inventory.what.actionType] }] }).issues).toContain("STAGE_PROFILE_MISMATCH");
  });

  it("requires exact unambiguous reversal identity and never treats compensation as full reversal", () => {
    const target = adaptLegacyAction(temporarySkuA799SevenDays);
    const reverse = adaptLegacyAction(rollbackTemporarySkuAToPreActionPrice);
    const exact = withCharacteristics(target, [stage("BEFORE_START"), stage("IMPLEMENTING"), stage("EFFECTIVE", false), stage("COMPLETED", false)], { kind: "FULLY_REVERSIBLE", reversal: { kind: "ACTION", actionId: reverse.actionId, actionFingerprint: fingerprintCanonicalAction(reverse) } });
    expect(validateActionCharacteristics(exact, { actions: [reverse] }).status).toBe("VALID");
    expect(validateActionCharacteristics(exact, { actions: [reverse, reverse] }).status).toBe("UNKNOWN");
    expect(validateActionCharacteristics({ ...exact, characteristics: { ...exact.characteristics, value: { ...exact.characteristics.value, reversibility: { kind: "FULLY_REVERSIBLE", reversal: { kind: "ACTION", actionId: reverse.actionId, actionFingerprint: "fnv1a64:0000000000000000" } } } } }, { actions: [reverse] }).status).toBe("INVALID");
    const sendBase = createCanonicalFixtures().find((f) => f.action?.what.actionType === "lifecycle.send")!.action!;
    const compensatedSend = { ...sendBase, characteristics: { state: "PRESENT" as const, value: { ...exact.characteristics.value, cancellationCosts: [stage("BEFORE_START"), stage("EFFECTIVE", false), stage("COMPLETED", false)] } } };
    expect(validateActionCharacteristics(compensatedSend, { actions: [reverse] }).issues).toContain("IRREVERSIBLE_DOMAIN_CANNOT_BE_FULLY_REVERSIBLE");
  });

  it("does not guess a persistent stage profile for an unregistered domain action", () => {
    const flow = createCanonicalFixtures().find((f) => f.action?.what.actionType === "lifecycle.start_flow")!.action!;
    const candidate = { ...flow, characteristics: { state: "PRESENT" as const, value: { implementationCost: [], reversibility: { kind: "NOT_APPLICABLE" as const, reason: "no rollback" }, cancellationCosts: [], operationalBurden: [] } } };
    expect(validateActionCharacteristics(candidate)).toEqual({ status: "UNKNOWN", issues: ["UNSUPPORTED_STAGE_PROFILE"] });
  });

  it("strictly validates reversal context and rejects duplicate contracts", () => {
    expect(validateActionCharacteristics(null, { extra: true } as any)).toEqual({ status: "INVALID", issues: ["INVALID_VALIDATION_CONTEXT"] });
    const contract = { kind: "REGISTERED" as const, registryRef: "rollback.domain", code: "restore", version: "1", domainActionTypes: ["pricing.adjust_price"] };
    expect(validateActionCharacteristics(null, { registeredReversals: [contract, contract] })).toEqual({ status: "INVALID", issues: ["INVALID_VALIDATION_CONTEXT"] });
    expect(validateActionCharacteristics(null, { registeredReversals: [{ ...contract, domainActionTypes: ["pricing.adjust_price", "pricing.adjust_price"] }] })).toEqual({ status: "INVALID", issues: ["INVALID_VALIDATION_CONTEXT"] });
  });
});
