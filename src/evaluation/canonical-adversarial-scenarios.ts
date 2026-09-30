import {
  evaluateExactActionSet,
  type ExactOracleInput,
  type ExactOracleResult,
} from "./exact-decision-oracle.js";
import type { OracleEconomics } from "./finite-decision-oracle.js";
import type { ExecutableValidationCase } from "./validation-evidence.js";
import { sha256 } from "./replay-manifest.js";
import {
  MEASUREMENT_VERSION,
  measurePerfectWorld,
  type CorruptionConfigInput,
  type PerfectEvent,
  type PerfectObservableWorld,
} from "../measurement_corruption/index.js";

export const CANONICAL_ADVERSARIAL_VERSION =
  "canonical-adversarial-exact-controls/1.0.0" as const;

export const CANONICAL_ADVERSARIAL_FAMILIES = [
  { id: "adv-001", family: "retargeting_selection" },
  { id: "adv-002", family: "branded_search_saturation" },
  { id: "adv-003", family: "discount_margin_inversion" },
  { id: "adv-004", family: "inventory_stockout" },
  { id: "adv-005", family: "simpsons_mix_shift" },
  { id: "adv-006", family: "seasonal_correlation" },
  { id: "adv-007", family: "upper_funnel_delayed_decay" },
  { id: "adv-008", family: "utm_loss_direct_fallback" },
  { id: "adv-009", family: "cross_device_hidden_assist" },
  { id: "adv-010", family: "cookie_loss_repeat_identity" },
  { id: "adv-011", family: "consent_selection_extrapolation" },
  { id: "adv-012", family: "pixel_outage" },
  { id: "adv-013", family: "duplicate_receipts" },
  { id: "adv-014", family: "reporting_delay_immature_tail" },
  { id: "adv-015", family: "overlapping_platform_claims" },
  { id: "adv-016", family: "channel_misclassification" },
  { id: "adv-017", family: "product_mix_margin" },
  { id: "adv-018", family: "promotion_pullforward" },
  { id: "adv-019", family: "delayed_returns" },
  { id: "adv-020", family: "supplier_lead_time" },
] as const;

type Family = (typeof CANONICAL_ADVERSARIAL_FAMILIES)[number]["family"];
type Action = { readonly kind: "baseline" | "tempting" | "corrective" };
interface World { readonly state: 0 | 1 | 2 | 3 }
interface Parameters { readonly family: Family }

const OUTCOMES = ([0, 1, 2, 3] as const).map((state) => ({
  outcomeId: "state-" + state,
  weight: 1,
  world: { state },
}));

function economic(
  units: number,
  options: {
    readonly priceMinor?: number;
    readonly cogsMinor?: number;
    readonly spendMinor?: number;
    readonly actionCostMinor?: number;
    readonly variableCostMinor?: number;
  } = {},
): OracleEconomics {
  const count = Math.max(0, Math.floor(units));
  const price = options.priceMinor ?? 10_000;
  const cogs = options.cogsMinor ?? 4_000;
  return {
    netSalesMinor: count * price,
    cogsMinor: count * cogs,
    paymentFeesMinor: count * 300,
    fulfillmentMinor: count * 400,
    shippingCostMinor: count * 300,
    variableOperatingCostMinor: options.variableCostMinor ?? 0,
    paidSpendMinor: options.spendMinor ?? 0,
    actionCostMinor: options.actionCostMinor ?? 0,
  };
}

function scenarioEconomics(
  family: Family,
  action: Action,
  world: World,
): OracleEconomics {
  const b = 8 + world.state;
  const k = action.kind;
  switch (family) {
    case "retargeting_selection":
      return economic(b, {
        spendMinor: k === "baseline" ? 10_000 : k === "tempting" ? 25_000 : 0,
      });
    case "branded_search_saturation":
      return economic(k === "tempting" ? b + 3 : b + 2, {
        spendMinor: k === "baseline" ? 12_000 : k === "tempting" ? 30_000 : 6_000,
      });
    case "discount_margin_inversion":
      return k === "baseline"
        ? economic(b)
        : k === "tempting"
          ? economic(b + 5, { priceMinor: 7_500 })
          : economic(b + 1, { priceMinor: 9_500, actionCostMinor: 1_000 });
    case "inventory_stockout": {
      const stock = k === "corrective" ? 14 : 10;
      const demand = k === "baseline" ? b : k === "tempting" ? b + 5 : b + 3;
      return economic(Math.min(stock, demand), {
        spendMinor: k === "baseline" ? 5_000 : k === "tempting" ? 20_000 : 10_000,
        actionCostMinor: k === "corrective" ? 4_000 : 0,
      });
    }
    case "simpsons_mix_shift":
      return economic(k === "baseline" ? b + 2 : k === "tempting" ? b : b + 3, {
        actionCostMinor: k === "baseline" ? 0 : k === "tempting" ? 2_000 : 3_000,
      });
    case "seasonal_correlation":
      return economic(b + 3, {
        spendMinor: k === "baseline" ? 5_000 : k === "tempting" ? 20_000 : 0,
      });
    case "upper_funnel_delayed_decay":
      return economic(k === "tempting" ? b - 1 : b + 4, {
        spendMinor: k === "baseline" ? 12_000 : k === "tempting" ? 4_000 : 12_000,
        actionCostMinor: k === "corrective" ? 1_000 : 0,
      });
    case "utm_loss_direct_fallback":
      return economic(k === "tempting" ? b : b + 3, {
        spendMinor: k === "tempting" ? 0 : 10_000,
        actionCostMinor: k === "corrective" ? 1_000 : 0,
      });
    case "cross_device_hidden_assist":
      return economic(k === "tempting" ? b : b + 2, {
        spendMinor: k === "tempting" ? 0 : 8_000,
        actionCostMinor: k === "corrective" ? 1_000 : 0,
      });
    case "cookie_loss_repeat_identity":
      return economic(b + 2, {
        spendMinor: k === "tempting" ? 15_000 : 4_000,
        actionCostMinor: k === "corrective" ? 1_000 : 0,
      });
    case "consent_selection_extrapolation":
      return economic(k === "baseline" ? b + 2 : b + 3, {
        spendMinor: k === "baseline" ? 8_000 : k === "tempting" ? 20_000 : 12_000,
      });
    case "pixel_outage":
      return economic(k === "tempting" ? b + 1 : b + 2, {
        spendMinor: 6_000,
        actionCostMinor: k === "tempting" ? 2_000 : k === "corrective" ? 1_000 : 0,
      });
    case "duplicate_receipts":
      return economic(b + 2, {
        spendMinor: k === "tempting" ? 15_000 : 6_000,
        actionCostMinor: k === "corrective" ? 1_000 : 0,
      });
    case "reporting_delay_immature_tail":
      return economic(k === "tempting" ? b : b + 3, {
        spendMinor: k === "tempting" ? 0 : 8_000,
        actionCostMinor: k === "corrective" ? 500 : 0,
      });
    case "overlapping_platform_claims":
      return economic(k === "corrective" ? b + 4 : b + 3, {
        spendMinor: k === "baseline" ? 10_000 : k === "tempting" ? 25_000 : 13_000,
      });
    case "channel_misclassification":
      return economic(k === "tempting" ? b + 1 : b + 2, {
        spendMinor: 8_000,
        actionCostMinor: k === "corrective" ? 500 : 0,
      });
    case "product_mix_margin":
      return k === "baseline"
        ? economic(b, { priceMinor: 10_000, cogsMinor: 4_000 })
        : k === "tempting"
          ? economic(b + 2, { priceMinor: 12_000, cogsMinor: 9_000 })
          : economic(b + 1, {
              priceMinor: 9_000,
              cogsMinor: 3_000,
              actionCostMinor: 1_000,
            });
    case "promotion_pullforward":
      return economic(b + 4, {
        priceMinor: k === "tempting" ? 8_000 : 10_000,
        actionCostMinor: k === "corrective" ? 1_000 : 0,
      });
    case "delayed_returns":
      return k === "baseline"
        ? economic(b + 2, { spendMinor: 8_000 })
        : k === "tempting"
          ? economic(b + 1, { spendMinor: 10_000, variableCostMinor: 6_000 })
          : economic(b + 3, { spendMinor: 10_000, variableCostMinor: 1_000 });
    case "supplier_lead_time": {
      const stock = k === "corrective" ? 14 : 8;
      const demand = k === "baseline" ? b + 3 : k === "tempting" ? b + 6 : b + 3;
      return economic(Math.min(stock, demand), {
        spendMinor: k === "tempting" ? 15_000 : 5_000,
        actionCostMinor: k === "corrective" ? 5_000 : 0,
      });
    }
  }
}

function inputFor(family: Family): ExactOracleInput<Action, World, Parameters> {
  return {
    modelVersion: CANONICAL_ADVERSARIAL_VERSION + ":" + family,
    modelParameters: { family },
    actionSetVersion: "canonical-adversarial-three-actions/1.0.0:" + family,
    completeActionSet: true,
    completeOutcomeSupport: true,
    baselineActionId: "a0",
    candidates: [
      { actionId: "a0", action: { kind: "baseline" } },
      { actionId: "a1", action: { kind: "tempting" } },
      { actionId: "a2", action: { kind: "corrective" } },
    ],
    outcomes: OUTCOMES,
    currency: "CAD",
    scope: "scenario_specific_long_horizon_contribution",
    horizon: {
      start: "2026-01-01T00:00:00.000Z",
      end: "2026-05-01T00:00:00.000Z",
    },
    maximumEvaluations: 12,
    evaluate: ({ action, world, parameters }) =>
      scenarioEconomics(parameters.family, action, world),
  };
}

function weightedRevenue(oracle: ExactOracleResult, actionId: string): bigint {
  return oracle.ledger
    .filter((row) => row.actionId === actionId)
    .reduce(
      (sum, row) =>
        sum + BigInt(row.weight) * BigInt(row.economics.netSalesMinor),
      0n,
    );
}

function weightedContribution(oracle: ExactOracleResult, actionId: string): bigint {
  return BigInt(
    oracle.ranking.find((row) => row.actionId === actionId)!
      .weightedContribution,
  );
}

function sameRevenueStatewise(
  oracle: ExactOracleResult,
  left: string,
  right: string,
): boolean {
  const compare = new Map(
    oracle.ledger
      .filter((row) => row.actionId === right)
      .map((row) => [row.outcomeId, row.economics.netSalesMinor]),
  );
  return oracle.ledger
    .filter((row) => row.actionId === left)
    .every((row) => compare.get(row.outcomeId) === row.economics.netSalesMinor);
}

function observedPattern(family: Family): Record<string, number | boolean> {
  switch (family) {
    case "retargeting_selection":
      return { reportedRoas: 8.2, highIntentShare: 0.9 };
    case "branded_search_saturation":
      return { reportedRoas: 11, brandedDemandShare: 0.88 };
    case "discount_margin_inversion":
      return { shortWindowRevenueLift: 0.31 };
    case "inventory_stockout":
      return { campaignCvr: 0.061, campaignGrossMargin: 0.58 };
    case "simpsons_mix_shift":
      return {
        segmentABefore: 0.9,
        segmentAAfter: 0.95,
        segmentBBefore: 0.3,
        segmentBAfter: 0.4,
        pooledBefore: 93 / 110,
        pooledAfter: 59 / 120,
      };
    case "seasonal_correlation":
      return { channelSalesCorrelation: 0.93, seasonalDemandIndex: 1.4 };
    case "upper_funnel_delayed_decay":
      return { sevenDayContributionDeltaMinor: 8_000 };
    case "utm_loss_direct_fallback":
      return { directShareBefore: 0.2, directShareAfter: 0.65, paidAttributedDrop: 0.5 };
    case "cross_device_hidden_assist":
      return { observedAssistedConversions: 0 };
    case "cookie_loss_repeat_identity":
      return { repeatRateBefore: 0.35, repeatRateAfter: 0.15, visitorInflation: 1.7 };
    case "consent_selection_extrapolation":
      return { consentedSegmentRoas: 8.5, consentedPopulationShare: 0.35 };
    case "pixel_outage":
      return { browserPurchasesBefore: 100, browserPurchasesAfter: 0, serverOrdersAfter: 100 };
    case "duplicate_receipts":
      return { purchaseReceipts: 200, distinctOrders: 100 };
    case "reporting_delay_immature_tail":
      return { latestDayReportedOrders: 0, matureOrders: 20 };
    case "overlapping_platform_claims":
      return { metaClaimRevenue: 80_000, googleClaimRevenue: 90_000, storeRevenue: 100_000 };
    case "channel_misclassification":
      return { apparentWinnerRevenueDelta: 30_000, storeRevenueDelta: 0 };
    case "product_mix_margin":
      return { temptingProductRevenue: 120_000, baselineProductRevenue: 90_000 };
    case "promotion_pullforward":
      return { promotionWindowRevenueLift: 0.4, postPromotionObservedDays: 0 };
    case "delayed_returns":
      return { temptingBookedRevenue: 130_000, correctiveBookedRevenue: 100_000, matureReturnsObserved: false };
    case "supplier_lead_time":
      return { historicalLeadDays: 14, currentObservedDemandIndex: 1.2, disruptionVisible: false };
  }
}

function trapPredicate(
  family: Family,
  oracle: ExactOracleResult,
  observed: Record<string, number | boolean>,
): { readonly passed: boolean; readonly values: Record<string, number | boolean | string> } {
  const base = weightedContribution(oracle, "a0");
  const tempting = weightedContribution(oracle, "a1");
  const corrective = weightedContribution(oracle, "a2");
  const baseRevenue = weightedRevenue(oracle, "a0");
  const temptingRevenue = weightedRevenue(oracle, "a1");
  const correctiveRevenue = weightedRevenue(oracle, "a2");
  let mechanism = false;

  switch (family) {
    case "retargeting_selection":
      mechanism = Number(observed["reportedRoas"]) > 1 &&
        sameRevenueStatewise(oracle, "a0", "a1") && tempting < base;
      break;
    case "branded_search_saturation":
      mechanism = Number(observed["reportedRoas"]) >= 10 &&
        temptingRevenue > baseRevenue && tempting < base && corrective > base;
      break;
    case "discount_margin_inversion":
      mechanism = Number(observed["shortWindowRevenueLift"]) > 0 &&
        temptingRevenue > baseRevenue && tempting < base;
      break;
    case "inventory_stockout":
      mechanism = tempting < base && corrective > base && correctiveRevenue > baseRevenue;
      break;
    case "simpsons_mix_shift":
      mechanism =
        Number(observed["segmentAAfter"]) > Number(observed["segmentABefore"]) &&
        Number(observed["segmentBAfter"]) > Number(observed["segmentBBefore"]) &&
        Number(observed["pooledAfter"]) < Number(observed["pooledBefore"]) &&
        tempting < base;
      break;
    case "seasonal_correlation":
      mechanism = Number(observed["channelSalesCorrelation"]) > 0.8 &&
        sameRevenueStatewise(oracle, "a0", "a1") && tempting < base;
      break;
    case "upper_funnel_delayed_decay":
      mechanism = Number(observed["sevenDayContributionDeltaMinor"]) > 0 &&
        tempting < base && oracle.bestActionId !== "a1";
      break;
    case "utm_loss_direct_fallback":
      mechanism = Number(observed["directShareAfter"]) > Number(observed["directShareBefore"]) &&
        Number(observed["paidAttributedDrop"]) > 0 && tempting < base;
      break;
    case "cross_device_hidden_assist":
      mechanism = Number(observed["observedAssistedConversions"]) === 0 && tempting < base;
      break;
    case "cookie_loss_repeat_identity":
      mechanism = Number(observed["repeatRateAfter"]) < Number(observed["repeatRateBefore"]) &&
        Number(observed["visitorInflation"]) > 1 && sameRevenueStatewise(oracle, "a0", "a1") &&
        tempting < base;
      break;
    case "consent_selection_extrapolation":
      mechanism = Number(observed["consentedSegmentRoas"]) > 1 &&
        temptingRevenue > baseRevenue && tempting < base && corrective > base;
      break;
    case "pixel_outage":
      mechanism = Number(observed["browserPurchasesAfter"]) === 0 &&
        Number(observed["serverOrdersAfter"]) === Number(observed["browserPurchasesBefore"]) &&
        tempting < base;
      break;
    case "duplicate_receipts":
      mechanism = Number(observed["purchaseReceipts"]) > Number(observed["distinctOrders"]) &&
        sameRevenueStatewise(oracle, "a0", "a1") && tempting < base;
      break;
    case "reporting_delay_immature_tail":
      mechanism = Number(observed["latestDayReportedOrders"]) === 0 &&
        Number(observed["matureOrders"]) > 0 && tempting < base;
      break;
    case "overlapping_platform_claims":
      mechanism =
        Number(observed["metaClaimRevenue"]) + Number(observed["googleClaimRevenue"]) >
          Number(observed["storeRevenue"]) &&
        sameRevenueStatewise(oracle, "a0", "a1") && tempting < base && corrective > base;
      break;
    case "channel_misclassification":
      mechanism = Number(observed["apparentWinnerRevenueDelta"]) > 0 &&
        Number(observed["storeRevenueDelta"]) === 0 && tempting < base;
      break;
    case "product_mix_margin":
      mechanism = Number(observed["temptingProductRevenue"]) > Number(observed["baselineProductRevenue"]) &&
        temptingRevenue > baseRevenue && tempting < base && corrective > base;
      break;
    case "promotion_pullforward":
      mechanism = Number(observed["promotionWindowRevenueLift"]) > 0 &&
        Number(observed["postPromotionObservedDays"]) === 0 &&
        temptingRevenue < baseRevenue && tempting < base;
      break;
    case "delayed_returns":
      mechanism = Number(observed["temptingBookedRevenue"]) > Number(observed["correctiveBookedRevenue"]) &&
        observed["matureReturnsObserved"] === false && tempting < corrective;
      break;
    case "supplier_lead_time":
      mechanism = Number(observed["historicalLeadDays"]) === 14 &&
        observed["disruptionVisible"] === false && tempting < base && corrective > base;
      break;
  }

  return {
    passed:
      mechanism &&
      oracle.evaluations === 12 &&
      oracle.ranking.length === 3 &&
      oracle.bestActionId !== "a1" &&
      tempting < (oracle.bestActionId === "a0" ? base : corrective),
    values: {
      mechanism,
      bestActionId: oracle.bestActionId,
      baselineExpectedContributionMinor: Number(base) / 4,
      temptingExpectedContributionMinor: Number(tempting) / 4,
      correctiveExpectedContributionMinor: Number(corrective) / 4,
      baselineExpectedRevenueMinor: Number(baseRevenue) / 4,
      temptingExpectedRevenueMinor: Number(temptingRevenue) / 4,
      correctiveExpectedRevenueMinor: Number(correctiveRevenue) / 4,
    },
  };
}


const MEASUREMENT_FAMILIES = new Set<Family>([
  "utm_loss_direct_fallback",
  "cross_device_hidden_assist",
  "cookie_loss_repeat_identity",
  "consent_selection_extrapolation",
  "pixel_outage",
  "duplicate_receipts",
  "reporting_delay_immature_tail",
  "overlapping_platform_claims",
  "channel_misclassification",
]);

function perfectObservationForFamily(family: Family): PerfectObservableWorld {
  const periodStart = "2026-01-01T00:00:00.000Z";
  const periodEnd = "2026-02-01T00:00:00.000Z";
  const events: PerfectEvent[] = [];
  const buyerCount = 12;

  for (let buyer = 0; buyer < buyerCount; buyer += 1) {
    const subjectId = "adv-subject-" + buyer;
    const firstDevice = buyer % 2 === 0 ? "mobile" : "desktop";
    const secondDevice = buyer % 2 === 0 ? "desktop" : "mobile";
    const metaSession = "adv-meta-session-" + buyer;
    const googleSession = "adv-google-session-" + buyer;
    events.push({
      eventId: "adv-meta-visit-" + buyer,
      origin: "browser",
      eventType: "session_start",
      occurredAt: "2026-01-05T00:00:00.000Z",
      subjectId,
      subjectCreatedAt: periodStart,
      sessionId: metaSession,
      source: "meta",
      device: firstDevice,
      utmSource: "meta",
      utmMedium: "paid_social",
      directNavigation: false,
    });
    events.push({
      eventId: "adv-google-visit-" + buyer,
      origin: "browser",
      eventType: "session_start",
      occurredAt: "2026-01-06T00:00:00.000Z",
      subjectId,
      subjectCreatedAt: periodStart,
      sessionId: googleSession,
      source: "google_search",
      device: secondDevice,
      utmSource: "google_search",
      utmMedium: "paid_search",
      directNavigation: false,
    });

    if (buyer < 8) {
      const orderId = "adv-order-" + buyer;
      events.push({
        eventId: "adv-browser-purchase-" + buyer,
        origin: "browser",
        eventType: "purchase",
        occurredAt: "2026-01-07T00:00:00.000Z",
        subjectId,
        subjectCreatedAt: periodStart,
        sessionId: googleSession,
        source: "google_search",
        device: secondDevice,
        knownCustomerId: "customer-" + buyer,
        orderId,
        amountMinor: 10_000 + buyer * 100,
        utmSource: "google_search",
        utmMedium: "paid_search",
        directNavigation: false,
      });
      events.push({
        eventId: "adv-server-purchase-" + buyer,
        origin: "server",
        eventType: "purchase",
        occurredAt: "2026-01-07T00:00:01.000Z",
        subjectId,
        subjectCreatedAt: periodStart,
        knownCustomerId: "customer-" + buyer,
        source: "unknown",
        orderId,
        amountMinor: 10_000 + buyer * 100,
        directNavigation: false,
      });
    }

    events.push({
      eventId: "adv-repeat-visit-" + buyer,
      origin: "browser",
      eventType: "session_start",
      occurredAt: "2026-01-20T00:00:00.000Z",
      subjectId,
      subjectCreatedAt: periodStart,
      sessionId: "adv-repeat-session-" + buyer,
      source: "direct",
      device: firstDevice,
      directNavigation: true,
    });
  }

  return {
    schemaVersion: "perfect-observation/1.0.0",
    periodStart,
    periodEnd,
    events,
    spend: [
      {
        id: "adv-meta-spend",
        platform: "meta",
        occurredAt: "2026-01-05T00:00:00.000Z",
        amountMinor: 45_000,
      },
      {
        id: "adv-google-spend",
        platform: "google",
        occurredAt: "2026-01-06T00:00:00.000Z",
        amountMinor: 60_000,
      },
    ],
  };
}

function corruptionForFamily(family: Family): CorruptionConfigInput {
  const base: CorruptionConfigInput = {
    version: MEASUREMENT_VERSION,
    seed: 990_000 + CANONICAL_ADVERSARIAL_FAMILIES.findIndex(
      (candidate) => candidate.family === family,
    ),
    identitySalt: "canonical-adversarial-private-identity-v1",
  };
  switch (family) {
    case "utm_loss_direct_fallback":
      return { ...base, missingUtmRate: 1, directFallbackRate: 1 };
    case "cross_device_hidden_assist":
      return { ...base, crossDeviceIdentityRate: 1 };
    case "cookie_loss_repeat_identity":
      return { ...base, cookieLossRate: 1 };
    case "consent_selection_extrapolation":
      return { ...base, consentExclusionRate: 0.5 };
    case "pixel_outage":
      return { ...base, blockedPixelRate: 1 };
    case "duplicate_receipts":
      return { ...base, duplicateEventRate: 1 };
    case "reporting_delay_immature_tail":
      return { ...base, platformReportingDelayMs: 7 * 86_400_000 };
    case "overlapping_platform_claims":
      return {
        ...base,
        metaOverAttributionRate: 1,
        googleOverAttributionRate: 1,
        serverToPlatformPurchases: true,
      };
    case "channel_misclassification":
      return { ...base, incorrectChannelRate: 1 };
    default:
      return base;
  }
}

function measurementBoundaryEvidence(family: Family) {
  const perfect = perfectObservationForFamily(family);
  const cleanConfig: CorruptionConfigInput = {
    version: MEASUREMENT_VERSION,
    seed: 880_001,
    identitySalt: "canonical-adversarial-clean-identity-v1",
    serverToPlatformPurchases: true,
  };
  const corruptConfig = corruptionForFamily(family);
  const clean = measurePerfectWorld(perfect, cleanConfig, perfect.periodEnd);
  const corrupted = measurePerfectWorld(
    perfect,
    corruptConfig,
    perfect.periodEnd,
  );
  const replay = measurePerfectWorld(
    perfect,
    corruptConfig,
    perfect.periodEnd,
  );
  const perfectHash = sha256(perfect);
  const cleanHash = sha256(clean.observation);
  const corruptedHash = sha256(corrupted.observation);
  const replayHash = sha256(replay.observation);
  const measurementFamily = MEASUREMENT_FAMILIES.has(family);
  const corruptionApplied = measurementFamily
    ? corruptedHash !== cleanHash
    : true;
  const serverOrdersPreserved =
    sha256(corrupted.observation.orders) ===
    sha256(clean.observation.orders);
  const replayVerified = corruptedHash === replayHash;

  return {
    perfect,
    clean: clean.observation,
    corrupted: corrupted.observation,
    evidence: {
      perfectHash,
      cleanHash,
      corruptedHash,
      replayHash,
      measurementFamily,
      corruptionApplied,
      serverOrdersPreserved,
      replayVerified,
      browserEventsClean: clean.observation.events.filter(
        (event) => event.origin === "browser",
      ).length,
      browserEventsCorrupted: corrupted.observation.events.filter(
        (event) => event.origin === "browser",
      ).length,
      cleanVisitorCount: new Set(
        clean.observation.events
          .filter((event) => event.origin === "browser")
          .map((event) => event.visitorId)
          .filter((value): value is string => value !== undefined),
      ).size,
      corruptedVisitorCount: new Set(
        corrupted.observation.events
          .filter((event) => event.origin === "browser")
          .map((event) => event.visitorId)
          .filter((value): value is string => value !== undefined),
      ).size,
      platformClaimedRevenueCorrupted: corrupted.observation.platformReports.reduce(
        (sum, report) => sum + report.attributedRevenueMinor,
        0,
      ),
      storeRevenueCorrupted: corrupted.observation.orders.reduce(
        (sum, order) => sum + order.netSalesMinor,
        0,
      ),
    },
  };
}

async function runFamily(family: Family) {
  const oracleInput = inputFor(family);
  const oracle = await evaluateExactActionSet(oracleInput);
  const oracleReplay = await evaluateExactActionSet(oracleInput);
  const observed = observedPattern(family);
  const trap = trapPredicate(family, oracle, observed);
  const boundary = measurementBoundaryEvidence(family);
  const operatorOffer = JSON.stringify({
    actions: ["a0", "a1", "a2"],
    observation: boundary.corrupted,
    merchantFacts: observed,
    objective: "contribution_profit",
    currency: "CAD",
  });
  const leakFree = ![
    family,
    "bestActionId",
    "oracle",
    "groundTruth",
    "weightedContribution",
  ].some((term) => operatorOffer.includes(term));
  const oracleReplayVerified = oracle.resultHash === oracleReplay.resultHash;
  const threeLevelBoundaryVerified =
    boundary.evidence.replayVerified &&
    boundary.evidence.serverOrdersPreserved &&
    boundary.evidence.corruptionApplied &&
    boundary.evidence.perfectHash !== boundary.evidence.corruptedHash;
  return {
    passed:
      trap.passed &&
      leakFree &&
      oracleReplayVerified &&
      threeLevelBoundaryVerified,
    measurements: {
      worldHash: oracle.inputHash,
      candidateSetHash: oracle.candidateSetHash,
      oracleHash: oracle.resultHash,
      exactEvaluations: oracle.evaluations,
      completeActionSet: true,
      completeOutcomeSupport: true,
      neutralActionIds: ["a0", "a1", "a2"],
      operatorOfferHash: sha256(operatorOffer),
      operatorLeakFree: leakFree,
      oracleReplayVerified,
      threeLevelBoundaryVerified,
      causalCounterfactualVerified: trap.passed,
      measurementBoundary: boundary.evidence,
      observedPattern: observed,
      trapCheck: trap.values,
      qualification:
        "exact_adversarial_decision_world_with_three_level_measurement_boundary",
    },
  };
}

export function buildCanonicalAdversarialScenarioCases(): readonly ExecutableValidationCase[] {
  return CANONICAL_ADVERSARIAL_FAMILIES.map(({ id, family }) => ({
    spec: {
      caseId: "adversarial:" + id,
      implementationVersion: CANONICAL_ADVERSARIAL_VERSION,
      kind: "canonical_decision_scenario" as const,
      scenarioFamily: family,
      requirements: ["adversarial_scenarios" as const],
    },
    run: () => runFamily(family),
  }));
}
