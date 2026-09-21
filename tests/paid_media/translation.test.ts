import { describe, expect, it } from "vitest";
import { utcTimestamp } from "../../src/core/units.js";
import {
  TRANSLATION_CONTEXT_SCHEMA_VERSION,
  type TranslationContext,
} from "../../src/action_translation/types.js";
import { translateBusinessAction } from "../../src/action_translation/translate.js";
import {
  blackFridayProspectingFourDays,
  googleBrandToNonBrand300PerDay,
  googleNonBrandCampaignXtoY20Percent,
  increaseGoogleShoppingBudget20,
  increaseSkuAAdvertising20,
  metaCampaignAtoB500PerDay,
  metaProspectingRetargeting75_25,
  metaToGoogle2000PerWeek,
  pauseMetaCampaignA,
  pinterestToMetaTenPercent,
  resumeGoogleCampaignB,
  rugsToLighting1000PerWeek,
  unsupportedTikTokSpendCap,
} from "../../src/paid_media/fixtures.js";

const context: TranslationContext = {
  schemaVersion: TRANSLATION_CONTEXT_SCHEMA_VERSION,
  simulatorClock: utcTimestamp("2026-09-21T13:00:00Z"),
  capabilities: ["campaign_budget", "campaign_delivery"],
  entityMappings: [
    {
      actionTarget: {
        kind: "campaign",
        channelId: "google_ads",
        campaignId: "google_shopping",
      },
      simulatorTarget: {
        kind: "campaign",
        simulatorChannelId: "sim:google_ads",
        simulatorCampaignId: "sim:google_shopping",
      },
      sourceRef: "mapping:google-shopping",
    },
    {
      actionTarget: {
        kind: "campaign",
        channelId: "meta_ads",
        campaignId: "meta_campaign_a",
      },
      simulatorTarget: {
        kind: "campaign",
        simulatorChannelId: "sim:meta_ads",
        simulatorCampaignId: "sim:meta_campaign_a",
      },
      sourceRef: "mapping:meta-a",
    },
    {
      actionTarget: {
        kind: "campaign",
        channelId: "meta_ads",
        campaignId: "meta_campaign_b",
      },
      simulatorTarget: {
        kind: "campaign",
        simulatorChannelId: "sim:meta_ads",
        simulatorCampaignId: "sim:meta_campaign_b",
      },
      sourceRef: "mapping:meta-b",
    },
    {
      actionTarget: {
        kind: "campaign",
        channelId: "google_ads",
        campaignId: "google_campaign_b",
      },
      simulatorTarget: {
        kind: "campaign",
        simulatorChannelId: "sim:google_ads",
        simulatorCampaignId: "sim:google_campaign_b",
      },
      sourceRef: "mapping:google-b",
    },
    {
      actionTarget: {
        kind: "advertising_channel",
        channelId: "meta_ads",
      },
      simulatorTarget: {
        kind: "channel",
        simulatorChannelId: "sim:meta_ads",
      },
      sourceRef: "mapping:meta-channel",
    },
    {
      actionTarget: {
        kind: "advertising_channel",
        channelId: "google_ads",
      },
      simulatorTarget: {
        kind: "channel",
        simulatorChannelId: "sim:google_ads",
      },
      sourceRef: "mapping:google-channel",
    },
    {
      actionTarget: {
        kind: "advertising_channel",
        channelId: "pinterest_ads",
      },
      simulatorTarget: {
        kind: "channel",
        simulatorChannelId: "sim:pinterest_ads",
      },
      sourceRef: "mapping:pinterest-channel",
    },
  ],
  referenceBindings: [
    {
      actionId: increaseGoogleShoppingBudget20.actionId,
      reference: {
        kind: "current_at_decision",
        decisionTime: utcTimestamp("2026-09-21T13:00:00Z"),
      },
      value: {
        kind: "money_rate",
        amountMinor: 1_000_000,
        currency: "CAD" as any,
        per: "week",
      },
      sourceRef: "observed:google-shopping-budget",
    },
  ],
};

function resolved(bundle: {
  readonly compoundAction: any;
  readonly components: readonly any[];
}) {
  return {
    kind: "resolved_compound_business_action" as const,
    compoundAction: bundle.compoundAction,
    components: bundle.components,
  };
}

describe("Step 3 paid-media Step 2 translation behavior", () => {
  it("translates supported budget scaling while preserving MULTIPLY", () => {
    const result = translateBusinessAction(
      increaseGoogleShoppingBudget20,
      context,
    );
    expect(result.status).toBe("TRANSLATED");
    if (result.status !== "TRANSLATED") return;

    expect(result.interventions).toHaveLength(1);
    expect(result.interventions[0]!.operation).toMatchObject({
      kind: "MULTIPLY",
      factor: 1.2,
      baseline: {
        value: {
          kind: "money_rate",
          amountMinor: 1_000_000,
          currency: "CAD",
          per: "week",
        },
      },
    });
  });

  it("translates generic paid-media PAUSE and RESUME only for supported campaign targets", () => {
    const paused = translateBusinessAction(pauseMetaCampaignA, context);
    const resumed = translateBusinessAction(resumeGoogleCampaignB, context);

    expect(paused.status).toBe("TRANSLATED");
    expect(resumed.status).toBe("TRANSLATED");
    if (paused.status === "TRANSLATED") {
      expect(paused.interventions[0]!.operation).toEqual({
        kind: "SET",
        value: { kind: "boolean", value: false },
      });
    }
    if (resumed.status === "TRANSLATED") {
      expect(resumed.interventions[0]!.operation).toEqual({
        kind: "SET",
        value: { kind: "boolean", value: true },
      });
    }
  });

  it("translates one cross-channel business decision into coordinated budget interventions", () => {
    const result = translateBusinessAction(
      resolved(metaToGoogle2000PerWeek),
      context,
    );
    expect(result.status).toBe("TRANSLATED");
    if (result.status !== "TRANSLATED") return;

    expect(result.interventions).toHaveLength(2);
    expect(
      new Set(
        result.interventions.map(
          (intervention) =>
            intervention.provenance.originatingBusinessActionId,
        ),
      ),
    ).toEqual(
      new Set([metaToGoogle2000PerWeek.compoundAction.compoundActionId]),
    );
    expect(
      result.interventions.map((intervention) => intervention.operation.kind),
    ).toEqual(["DELTA", "DELTA"]);
  });

  it("translates intra-channel campaign reallocation as one coordinated decision", () => {
    const result = translateBusinessAction(
      resolved(metaCampaignAtoB500PerDay),
      context,
    );
    expect(result.status).toBe("TRANSLATED");
    if (result.status !== "TRANSLATED") return;

    expect(result.interventions).toHaveLength(2);
    expect(result.interventions.map((intervention) => intervention.target)).toEqual([
      {
        kind: "campaign",
        simulatorChannelId: "sim:meta_ads",
        simulatorCampaignId: "sim:meta_campaign_a",
      },
      {
        kind: "campaign",
        simulatorChannelId: "sim:meta_ads",
        simulatorCampaignId: "sim:meta_campaign_b",
      },
    ]);
  });

  it("preserves Brand and Non-Brand scopes when translating a supported fixed reallocation", () => {
    const result = translateBusinessAction(
      resolved(googleBrandToNonBrand300PerDay),
      context,
    );
    expect(result.status).toBe("TRANSLATED");
    if (result.status !== "TRANSLATED") return;

    expect(result.interventions[0]!.scope.dimensions[0]).toMatchObject({
      kind: "paid_media_segment",
      classification: "brand",
    });
    expect(result.interventions[1]!.scope.dimensions[0]).toMatchObject({
      kind: "paid_media_segment",
      classification: "non_brand",
    });
  });

  it("preserves temporary prospecting scope and four-day duration", () => {
    const result = translateBusinessAction(
      blackFridayProspectingFourDays,
      context,
    );
    expect(result.status).toBe("TRANSLATED");
    if (result.status !== "TRANSLATED") return;

    expect(result.interventions[0]!.scope.dimensions[0]).toMatchObject({
      kind: "paid_media_segment",
      classification: "prospecting",
    });
    expect(result.interventions[0]!.duration).toEqual({
      kind: "temporary",
      durationSeconds: 4 * 24 * 60 * 60,
    });
  });

  it("keeps valid allocation policy Actions explicit but unsimulatable until capability exists", () => {
    const result = translateBusinessAction(
      metaProspectingRetargeting75_25,
      context,
    );
    expect(result).toMatchObject({
      status: "UNSUPPORTED_ACTION_TYPE",
      code: "NO_REGISTERED_TRANSLATOR",
    });
  });

  it("does not pretend product, collection or percentage-transfer actions are supported", () => {
    expect(
      translateBusinessAction(increaseSkuAAdvertising20, context),
    ).toMatchObject({
      status: "UNSUPPORTED_TARGET",
      code: "TRANSLATOR_TARGET_UNSUPPORTED",
    });

    expect(
      translateBusinessAction(resolved(rugsToLighting1000PerWeek), context),
    ).toMatchObject({
      status: "UNSUPPORTED_TARGET",
    });

    expect(
      translateBusinessAction(resolved(pinterestToMetaTenPercent), context),
    ).toMatchObject({
      status: "UNSUPPORTED_ACTION_TYPE",
    });

    expect(
      translateBusinessAction(
        resolved(googleNonBrandCampaignXtoY20Percent),
        context,
      ),
    ).toMatchObject({
      status: "UNSUPPORTED_ACTION_TYPE",
    });
  });

  it("returns explicit unsupported result for spend-cap capability not implemented by the simulator", () => {
    expect(
      translateBusinessAction(unsupportedTikTokSpendCap, context),
    ).toMatchObject({
      status: "UNSUPPORTED_ACTION_TYPE",
      code: "NO_REGISTERED_TRANSLATOR",
    });
  });

  it("returns MISSING_CONTEXT rather than guessing a relative budget baseline", () => {
    const withoutBaseline: TranslationContext = {
      ...context,
      referenceBindings: [],
    };
    expect(
      translateBusinessAction(
        increaseGoogleShoppingBudget20,
        withoutBaseline,
      ),
    ).toMatchObject({
      status: "MISSING_CONTEXT",
      code: "MISSING_REFERENCE_BASELINE",
    });
  });

  it("returns unsupported simulator capability when budget mutation itself is unavailable", () => {
    const withoutBudgetCapability: TranslationContext = {
      ...context,
      capabilities: ["campaign_delivery"],
    };

    expect(
      translateBusinessAction(
        increaseGoogleShoppingBudget20,
        withoutBudgetCapability,
      ),
    ).toMatchObject({
      status: "UNSUPPORTED_SIMULATOR_CAPABILITY",
      code: "SIMULATOR_CAPABILITY_UNAVAILABLE",
    });
  });
});
