import { describe, expect, it } from "vitest";
import { assertValidAction, validateAction } from "../../src/action_ontology/validation.js";
import {
  paidMediaReallocationFingerprint,
  serializePaidMediaReallocation,
  validatePaidMediaReallocation,
} from "../../src/paid_media/reallocation.js";
import {
  googleBrandToNonBrand300PerDay,
  googleNonBrandCampaignXtoY20Percent,
  metaCampaignAtoB500PerDay,
  metaRetargetingToProspecting1000PerWeek,
  metaToGoogle2000PerWeek,
  pinterestToMetaTenPercent,
  rugsToLighting1000PerWeek,
} from "../../src/paid_media/fixtures.js";

function clone<T>(value: T): any {
  return JSON.parse(JSON.stringify(value));
}

describe("Step 3 paid-media reallocations", () => {
  it("validates cross-channel and intra-channel monetary reallocations", () => {
    expect(validatePaidMediaReallocation(metaToGoogle2000PerWeek).ok).toBe(
      true,
    );
    expect(validatePaidMediaReallocation(metaCampaignAtoB500PerDay).ok).toBe(
      true,
    );
    expect(
      validatePaidMediaReallocation(metaRetargetingToProspecting1000PerWeek).ok,
    ).toBe(true);
    expect(
      validatePaidMediaReallocation(googleBrandToNonBrand300PerDay).ok,
    ).toBe(true);
    expect(validatePaidMediaReallocation(rugsToLighting1000PerWeek).ok).toBe(
      true,
    );
  });

  it("validates percentage-of-source reallocations without inventing a dollar baseline", () => {
    expect(validatePaidMediaReallocation(pinterestToMetaTenPercent).ok).toBe(
      true,
    );
    expect(
      validatePaidMediaReallocation(googleNonBrandCampaignXtoY20Percent).ok,
    ).toBe(true);

    const source = pinterestToMetaTenPercent.components[0]!;
    expect(source.parameters.kind).toBe("paid_media_transfer_leg");
    if (source.parameters.kind === "paid_media_transfer_leg") {
      expect(source.parameters.amount).toMatchObject({
        kind: "percentage_of_source",
        basisPoints: 1000,
        sourceTarget: {
          kind: "advertising_channel",
          channelId: "pinterest_ads",
        },
      });
    }
  });

  it("rejects a pure CAD 2,000 transfer that increases destination by CAD 2,500", () => {
    const invalid = clone(metaToGoogle2000PerWeek);
    const destination = invalid.components[1];
    destination.parameters.operation.amount.amountMinor = 250_000;
    invalid.components[1] = assertValidAction(destination);

    const result = validatePaidMediaReallocation(invalid);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.errors.some(
          (issue) => issue.code === "REALLOCATION_NOT_CONSERVED",
        ),
      ).toBe(true);
    }
  });

  it("allows additional funding only when it is explicit", () => {
    const funded = clone(metaToGoogle2000PerWeek);
    const destination = funded.components[1];
    destination.parameters.operation.amount.amountMinor = 250_000;
    funded.components[1] = assertValidAction(destination);
    funded.fundingPolicy = {
      kind: "incremental_funding",
      amount: {
        kind: "money_rate",
        amountMinor: 50_000,
        currency: "CAD",
        per: "week",
      },
    };

    expect(validatePaidMediaReallocation(funded).ok).toBe(true);
  });

  it("rejects currency and rate-period mismatch", () => {
    const currencyMismatch = clone(metaToGoogle2000PerWeek);
    const currencyDestination = currencyMismatch.components[1];
    currencyDestination.parameters.operation.amount.currency = "USD";
    currencyDestination.parameters.operation.reference.value.currency = "USD";
    currencyMismatch.components[1] = assertValidAction(currencyDestination);
    const first = validatePaidMediaReallocation(currencyMismatch);
    expect(first.ok).toBe(false);
    if (!first.ok) {
      expect(
        first.errors.some(
          (issue) => issue.code === "REALLOCATION_UNIT_MISMATCH",
        ),
      ).toBe(true);
    }

    const periodMismatch = clone(metaToGoogle2000PerWeek);
    const periodDestination = periodMismatch.components[1];
    periodDestination.parameters.operation.amount.per = "day";
    periodDestination.parameters.operation.reference.value.per = "day";
    periodMismatch.components[1] = assertValidAction(periodDestination);
    const second = validatePaidMediaReallocation(periodMismatch);
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(
        second.errors.some(
          (issue) => issue.code === "REALLOCATION_UNIT_MISMATCH",
        ),
      ).toBe(true);
    }
  });

  it("rejects identical source and destination target+scope", () => {
    const invalid = clone(metaCampaignAtoB500PerDay);
    invalid.components[1] = assertValidAction({
      ...invalid.components[1],
      target: invalid.components[0].target,
      scope: invalid.components[0].scope,
    });

    const result = validatePaidMediaReallocation(invalid);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.errors.some(
          (issue) =>
            issue.code === "REALLOCATION_IDENTICAL_SOURCE_DESTINATION",
        ),
      ).toBe(true);
    }
  });

  it("rejects missing source or destination legs", () => {
    const missingSource = clone(metaToGoogle2000PerWeek);
    missingSource.components = [missingSource.components[1]];
    missingSource.compoundAction.componentActionIds = [
      missingSource.components[0].actionId,
    ];
    const first = validatePaidMediaReallocation(missingSource);
    expect(first.ok).toBe(false);
    if (!first.ok) {
      expect(
        first.errors.some(
          (issue) => issue.code === "REALLOCATION_MISSING_SOURCE",
        ),
      ).toBe(true);
    }

    const missingDestination = clone(metaToGoogle2000PerWeek);
    missingDestination.components = [missingDestination.components[0]];
    missingDestination.compoundAction.componentActionIds = [
      missingDestination.components[0].actionId,
    ];
    const second = validatePaidMediaReallocation(missingDestination);
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(
        second.errors.some(
          (issue) => issue.code === "REALLOCATION_MISSING_DESTINATION",
        ),
      ).toBe(true);
    }
  });

  it("rejects a transfer leg whose role and DELTA direction disagree", () => {
    const invalid = clone(pinterestToMetaTenPercent);
    invalid.components[0].parameters.direction = "increase";
    const componentResult = validateAction(invalid.components[0]);
    expect(componentResult.ok).toBe(false);
    if (!componentResult.ok) {
      expect(
        componentResult.errors.some(
          (issue) => issue.code === "TRANSFER_SOURCE_MUST_DECREASE",
        ),
      ).toBe(true);
    }
  });

  it("rejects coordinated legs with mismatched timing", () => {
    const invalid = clone(metaToGoogle2000PerWeek);
    const destination = invalid.components[1];
    destination.timing = {
      ...destination.timing,
      requestedStart: {
        kind: "known",
        at: "2026-09-21T14:00:00Z",
      },
      effectiveStart: {
        kind: "known",
        at: "2026-09-21T14:00:00Z",
      },
    };
    invalid.components[1] = assertValidAction(destination);

    const result = validatePaidMediaReallocation(invalid);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.errors.some(
          (issue) => issue.code === "REALLOCATION_TIMING_MISMATCH",
        ),
      ).toBe(true);
    }
  });

  it("canonically serializes coordinated media decisions deterministically", () => {
    expect(serializePaidMediaReallocation(metaToGoogle2000PerWeek)).toBe(
      serializePaidMediaReallocation(metaToGoogle2000PerWeek),
    );
    expect(serializePaidMediaReallocation(metaToGoogle2000PerWeek)).not.toBe(
      serializePaidMediaReallocation(metaCampaignAtoB500PerDay),
    );
  });

  it("fingerprints materially different coordinated media decisions differently", () => {
    const fingerprints = new Set([
      paidMediaReallocationFingerprint(metaToGoogle2000PerWeek),
      paidMediaReallocationFingerprint(metaCampaignAtoB500PerDay),
      paidMediaReallocationFingerprint(metaRetargetingToProspecting1000PerWeek),
      paidMediaReallocationFingerprint(googleBrandToNonBrand300PerDay),
      paidMediaReallocationFingerprint(pinterestToMetaTenPercent),
    ]);
    expect(fingerprints.size).toBe(5);
  });
});
