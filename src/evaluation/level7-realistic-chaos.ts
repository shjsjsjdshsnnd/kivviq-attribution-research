import { MEASUREMENT_VERSION, measurePerfectWorld, type PerfectEvent, type PerfectObservableWorld } from "../measurement_corruption/index.js";
import { evaluateExactActionSet, type ExactOracleInput } from "./exact-decision-oracle.js";
import type { OracleEconomics } from "./finite-decision-oracle.js";
import { LEVEL7_MECHANISM_REQUIREMENTS } from "./difficulty-curriculum.js";
import { sha256 } from "./replay-manifest.js";

export const LEVEL7_REALISTIC_CHAOS_VERSION =
  "difficulty-level-7-realistic-chaos/1.0.0" as const;

type ChaosAction =
  | { readonly kind: "baseline" }
  | { readonly kind: "scale_meta" }
  | { readonly kind: "scale_google" }
  | { readonly kind: "discount_20" }
  | { readonly kind: "retention_push" }
  | { readonly kind: "cut_meta" };

interface ChaosWorld {
  readonly highIntent: readonly boolean[];
  readonly externalDemandShock: boolean;
  readonly returnsShock: boolean;
}

interface ChaosParameters {
  readonly unitPriceMinor: number;
  readonly unitCogsMinor: number;
  readonly paymentFeeMinor: number;
  readonly fulfillmentMinor: number;
  readonly shippingMinor: number;
  readonly returnProcessingMinor: number;
  readonly inventoryUnits: number;
  readonly baselineMetaSpendMinor: number;
  readonly baselineGoogleSpendMinor: number;
  readonly retentionActionCostMinor: number;
  readonly discountElasticityUnits: number;
  readonly externalShockUnits: number;
}

const parameters: ChaosParameters = {
  unitPriceMinor: 12_000,
  unitCogsMinor: 5_000,
  paymentFeeMinor: 300,
  fulfillmentMinor: 600,
  shippingMinor: 300,
  returnProcessingMinor: 900,
  inventoryUnits: 14,
  baselineMetaSpendMinor: 8_000,
  baselineGoogleSpendMinor: 10_000,
  retentionActionCostMinor: 4_000,
  discountElasticityUnits: 5,
  externalShockUnits: 2,
};

function paidResponseUnits(spendMinor: number, baselineSpendMinor: number): number {
  if (!Number.isSafeInteger(spendMinor) || spendMinor < 0) {
    throw new RangeError("paid spend must be a non-negative integer");
  }
  if (spendMinor === 0) return 0;
  if (spendMinor <= baselineSpendMinor) return 2;
  if (spendMinor <= baselineSpendMinor * 2) return 3;
  return 4;
}

function actionSettings(action: ChaosAction, p: ChaosParameters) {
  return {
    metaSpendMinor:
      action.kind === "cut_meta"
        ? 0
        : action.kind === "scale_meta"
          ? p.baselineMetaSpendMinor * 2
          : p.baselineMetaSpendMinor,
    googleSpendMinor:
      action.kind === "scale_google"
        ? p.baselineGoogleSpendMinor * 2
        : p.baselineGoogleSpendMinor,
    discountRate: action.kind === "discount_20" ? 0.2 : 0,
    repeatOrders: action.kind === "retention_push" ? 2 : 1,
    actionCostMinor:
      action.kind === "retention_push" ? p.retentionActionCostMinor : 0,
  };
}

function demandBreakdown(
  action: ChaosAction,
  world: ChaosWorld,
  p: ChaosParameters = parameters,
) {
  const settings = actionSettings(action, p);
  const organicUnits =
    world.highIntent.filter(Boolean).length * 2 +
    (world.externalDemandShock ? p.externalShockUnits : 0);
  const metaUnits = paidResponseUnits(
    settings.metaSpendMinor,
    p.baselineMetaSpendMinor,
  );
  const googleUnits = paidResponseUnits(
    settings.googleSpendMinor,
    p.baselineGoogleSpendMinor,
  );
  const crossChannelUnits =
    settings.metaSpendMinor > 0 && settings.googleSpendMinor > 0 ? 1 : 0;
  const priceElasticityUnits =
    settings.discountRate > 0 ? p.discountElasticityUnits : 0;
  const demandedUnits =
    organicUnits +
    metaUnits +
    googleUnits +
    crossChannelUnits +
    priceElasticityUnits +
    settings.repeatOrders;
  return {
    ...settings,
    organicUnits,
    metaUnits,
    googleUnits,
    crossChannelUnits,
    priceElasticityUnits,
    demandedUnits,
    fulfilledUnits: Math.min(p.inventoryUnits, demandedUnits),
  };
}

function chaosEconomics(
  action: ChaosAction,
  world: ChaosWorld,
  p: ChaosParameters = parameters,
): OracleEconomics {
  const demand = demandBreakdown(action, world, p);
  const unitPriceMinor = Math.floor(
    p.unitPriceMinor * (1 - demand.discountRate),
  );
  const returnedUnits = world.returnsShock
    ? Math.floor(demand.fulfilledUnits / 3)
    : 0;
  const keptUnits = demand.fulfilledUnits - returnedUnits;
  return {
    netSalesMinor: keptUnits * unitPriceMinor,
    cogsMinor: keptUnits * p.unitCogsMinor,
    paymentFeesMinor: demand.fulfilledUnits * p.paymentFeeMinor,
    fulfillmentMinor: demand.fulfilledUnits * p.fulfillmentMinor,
    shippingCostMinor: demand.fulfilledUnits * p.shippingMinor,
    variableOperatingCostMinor: returnedUnits * p.returnProcessingMinor,
    paidSpendMinor: demand.metaSpendMinor + demand.googleSpendMinor,
    actionCostMinor: demand.actionCostMinor,
  };
}

function chaosWorlds(): readonly {
  readonly outcomeId: string;
  readonly weight: number;
  readonly world: ChaosWorld;
}[] {
  const outcomes: {
    outcomeId: string;
    weight: number;
    world: ChaosWorld;
  }[] = [];
  for (let mask = 0; mask < 8; mask += 1) {
    const highIntent = Array.from(
      { length: 3 },
      (_, index) => ((mask >> index) & 1) === 1,
    );
    for (const externalDemandShock of [false, true]) {
      for (const returnsShock of [false, true]) {
        outcomes.push({
          outcomeId:
            "intent-" +
            mask.toString(2).padStart(3, "0") +
            ":shock-" +
            (externalDemandShock ? "on" : "off") +
            ":returns-" +
            (returnsShock ? "on" : "off"),
          weight: 1,
          world: { highIntent, externalDemandShock, returnsShock },
        });
      }
    }
  }
  return outcomes;
}

export function buildLevel7RealisticChaosControl(): ExactOracleInput<
  ChaosAction,
  ChaosWorld,
  ChaosParameters
> {
  const outcomes = chaosWorlds();
  return {
    modelVersion: LEVEL7_REALISTIC_CHAOS_VERSION,
    modelParameters: parameters,
    actionSetVersion: "difficulty-level-7-actions/1.0.0",
    completeActionSet: true,
    completeOutcomeSupport: true,
    baselineActionId: "baseline",
    candidates: [
      { actionId: "baseline", action: { kind: "baseline" } },
      { actionId: "scale-meta", action: { kind: "scale_meta" } },
      { actionId: "scale-google", action: { kind: "scale_google" } },
      { actionId: "discount-20", action: { kind: "discount_20" } },
      { actionId: "retention-push", action: { kind: "retention_push" } },
      { actionId: "cut-meta", action: { kind: "cut_meta" } },
    ],
    outcomes,
    currency: "CAD",
    scope:
      "realistic_chaos_two_period_booked_contribution_with_returns_and_inventory",
    horizon: {
      start: "2026-01-01T00:00:00.000Z",
      end: "2026-03-01T00:00:00.000Z",
    },
    maximumEvaluations: outcomes.length * 6,
    evaluate: ({ action, world, parameters: p }) =>
      chaosEconomics(action, world, p),
  };
}

function perfectObservation(world: ChaosWorld, ordinal: number): PerfectObservableWorld {
  const periodStart = "2026-01-01T00:00:00.000Z";
  const periodEnd = "2026-03-01T00:00:00.000Z";
  const events: PerfectEvent[] = [];
  const addPeriod = (
    label: "pre" | "post",
    sessionAt: string,
    purchaseAt: string,
  ) => {
    world.highIntent.forEach((highIntent, buyer) => {
      const subjectId = "difficulty-l7-" + ordinal + "-buyer-" + buyer;
      const sessionId =
        "difficulty-l7-" + ordinal + "-" + label + "-session-" + buyer;
      events.push({
        eventId:
          "difficulty-l7-" + ordinal + "-" + label + "-visit-" + buyer,
        origin: "browser",
        eventType: "session_start",
        occurredAt: sessionAt,
        subjectId,
        subjectCreatedAt: periodStart,
        sessionId,
        source: highIntent ? "meta" : "direct",
        ...(highIntent
          ? { utmSource: "meta", utmMedium: "paid_social" }
          : { directNavigation: true }),
      });
      if (highIntent) {
        events.push({
          eventId:
            "difficulty-l7-" + ordinal + "-" + label + "-purchase-" + buyer,
          origin: "server",
          eventType: "purchase",
          occurredAt: purchaseAt,
          subjectId,
          subjectCreatedAt: periodStart,
          knownCustomerId: "customer-" + buyer,
          source: "unknown",
          orderId:
            "difficulty-l7-" + ordinal + "-" + label + "-order-" + buyer,
          amountMinor: parameters.unitPriceMinor,
        });
      }
    });
  };
  addPeriod(
    "pre",
    "2026-01-10T00:00:00.000Z",
    "2026-01-11T00:00:00.000Z",
  );
  addPeriod(
    "post",
    "2026-02-10T00:00:00.000Z",
    "2026-02-11T00:00:00.000Z",
  );
  if (world.externalDemandShock) {
    for (let index = 0; index < parameters.externalShockUnits; index += 1) {
      const subjectId = "difficulty-l7-" + ordinal + "-shock-" + index;
      events.push({
        eventId: subjectId + "-visit",
        origin: "browser",
        eventType: "session_start",
        occurredAt: "2026-02-12T00:00:00.000Z",
        subjectId,
        subjectCreatedAt: "2026-02-01T00:00:00.000Z",
        sessionId: subjectId + "-session",
        source: "direct",
        directNavigation: true,
      });
      events.push({
        eventId: subjectId + "-purchase",
        origin: "server",
        eventType: "purchase",
        occurredAt: "2026-02-13T00:00:00.000Z",
        subjectId,
        subjectCreatedAt: "2026-02-01T00:00:00.000Z",
        knownCustomerId: "shock-customer-" + index,
        source: "unknown",
        orderId: subjectId + "-order",
        amountMinor: parameters.unitPriceMinor,
      });
    }
  }
  return {
    schemaVersion: "perfect-observation/1.0.0",
    periodStart,
    periodEnd,
    events,
    spend: [
      {
        id: "difficulty-l7-" + ordinal + "-meta-spend",
        platform: "meta",
        occurredAt: "2026-01-10T00:00:00.000Z",
        amountMinor: parameters.baselineMetaSpendMinor,
      },
      {
        id: "difficulty-l7-" + ordinal + "-google-spend",
        platform: "google",
        occurredAt: "2026-01-10T00:00:00.000Z",
        amountMinor: parameters.baselineGoogleSpendMinor,
      },
    ],
  };
}

export async function level7RealisticChaosEvidence() {
  const input = buildLevel7RealisticChaosControl();
  const oracle = await evaluateExactActionSet(input);
  const denominator = BigInt(oracle.probabilityDenominator);
  const rows = (actionId: string) =>
    oracle.ledger.filter((row) => row.actionId === actionId);
  const weightedRevenue = (actionId: string) =>
    rows(actionId).reduce(
      (sum, row) =>
        sum + BigInt(row.weight) * BigInt(row.economics.netSalesMinor),
      0n,
    );
  const weightedContribution = (actionId: string) =>
    BigInt(
      oracle.ranking.find((row) => row.actionId === actionId)!
        .weightedContribution,
    );

  const baselineRows = rows("baseline");
  const scaleMetaByOutcome = new Map(
    rows("scale-meta").map((row) => [row.outcomeId, row]),
  );
  const retentionByOutcome = new Map(
    rows("retention-push").map((row) => [row.outcomeId, row]),
  );
  const discountByOutcome = new Map(
    rows("discount-20").map((row) => [row.outcomeId, row]),
  );

  const paidMediaResponse = baselineRows.some((base) => {
    const scaled = scaleMetaByOutcome.get(base.outcomeId)!;
    return scaled.economics.netSalesMinor > base.economics.netSalesMinor;
  });
  const firstMetaTranche =
    paidResponseUnits(parameters.baselineMetaSpendMinor, parameters.baselineMetaSpendMinor) -
    paidResponseUnits(0, parameters.baselineMetaSpendMinor);
  const secondMetaTranche =
    paidResponseUnits(parameters.baselineMetaSpendMinor * 2, parameters.baselineMetaSpendMinor) -
    paidResponseUnits(parameters.baselineMetaSpendMinor, parameters.baselineMetaSpendMinor);
  const diminishingChannelReturns =
    firstMetaTranche > secondMetaTranche && secondMetaTranche > 0;

  const crossChannelInteraction = input.outcomes.every(({ world }) => {
    const baseline = demandBreakdown({ kind: "baseline" }, world);
    const withoutMeta = demandBreakdown({ kind: "cut_meta" }, world);
    return baseline.crossChannelUnits === 1 && withoutMeta.crossChannelUnits === 0;
  });

  const pricingElasticity = input.outcomes.every(({ world }) => {
    const baseline = demandBreakdown({ kind: "baseline" }, world);
    const discounted = demandBreakdown({ kind: "discount_20" }, world);
    return (
      discounted.priceElasticityUnits === parameters.discountElasticityUnits &&
      discounted.demandedUnits > baseline.demandedUnits
    );
  });
  const promotionEconomics =
    weightedRevenue("discount-20") > weightedRevenue("baseline") &&
    weightedContribution("discount-20") < weightedContribution("baseline");

  const retentionCustomerValue =
    input.outcomes.every(({ world }, index) => {
      const baseline = baselineRows[index]!;
      const retained = retentionByOutcome.get(baseline.outcomeId)!;
      return (
        demandBreakdown({ kind: "retention_push" }, world).repeatOrders >
          demandBreakdown({ kind: "baseline" }, world).repeatOrders &&
        retained.economics.actionCostMinor === parameters.retentionActionCostMinor
      );
    }) &&
    weightedContribution("retention-push") > weightedContribution("baseline");

  const inventoryBindingStates = input.outcomes.filter(({ world }) => {
    const demand = demandBreakdown({ kind: "discount_20" }, world);
    return (
      demand.demandedUnits > parameters.inventoryUnits &&
      demand.fulfilledUnits === parameters.inventoryUnits
    );
  }).length;
  const inventoryConstraints =
    inventoryBindingStates > 0 &&
    input.outcomes.every(({ world }) =>
      input.candidates.every(({ action }) => {
        const demand = demandBreakdown(action, world);
        return (
          demand.fulfilledUnits <= parameters.inventoryUnits &&
          demand.fulfilledUnits >= 0
        );
      }),
    );

  let externalShocks = true;
  let returnsEconomics = true;
  for (let mask = 0; mask < 8; mask += 1) {
    const highIntent = Array.from(
      { length: 3 },
      (_, index) => ((mask >> index) & 1) === 1,
    );
    for (const returnsShock of [false, true]) {
      const off = { highIntent, externalDemandShock: false, returnsShock };
      const on = { highIntent, externalDemandShock: true, returnsShock };
      externalShocks &&=
        demandBreakdown({ kind: "baseline" }, on).demandedUnits -
          demandBreakdown({ kind: "baseline" }, off).demandedUnits ===
        parameters.externalShockUnits;
    }
    for (const externalDemandShock of [false, true]) {
      const clean = {
        highIntent,
        externalDemandShock,
        returnsShock: false,
      };
      const returned = {
        highIntent,
        externalDemandShock,
        returnsShock: true,
      };
      returnsEconomics &&=
        chaosEconomics({ kind: "baseline" }, returned).netSalesMinor <=
          chaosEconomics({ kind: "baseline" }, clean).netSalesMinor &&
        (
          chaosEconomics({ kind: "baseline" }, returned)
            .variableOperatingCostMinor >=
          chaosEconomics({ kind: "baseline" }, clean)
            .variableOperatingCostMinor
        );
    }
  }

  const cleanConfig = {
    version: MEASUREMENT_VERSION,
    seed: 9707,
    identitySalt: "difficulty-level7-private-identity",
  } as const;
  const corruptConfig = {
    ...cleanConfig,
    missingUtmRate: 1,
    directFallbackRate: 1,
  } as const;
  let cleanMetaEvents = 0;
  let corruptedMetaEvents = 0;
  let corruptedDirectEvents = 0;
  let preservedOrders = true;
  let exposed = 0;
  let exposedPurchases = 0;
  let unexposed = 0;
  let unexposedPurchases = 0;
  let stablePastAcrossShock = true;
  const shockCutoff = Date.parse("2026-02-01T00:00:00.000Z");

  input.outcomes.forEach((outcome, ordinal) => {
    const perfect = perfectObservation(outcome.world, ordinal);
    const clean = measurePerfectWorld(perfect, cleanConfig, perfect.periodEnd);
    const corrupted = measurePerfectWorld(
      perfect,
      corruptConfig,
      perfect.periodEnd,
    );
    cleanMetaEvents += clean.observation.events.filter(
      (event) => event.origin === "browser" && event.source === "meta",
    ).length;
    corruptedMetaEvents += corrupted.observation.events.filter(
      (event) => event.origin === "browser" && event.source === "meta",
    ).length;
    corruptedDirectEvents += corrupted.observation.events.filter(
      (event) => event.origin === "browser" && event.source === "direct",
    ).length;
    preservedOrders &&=
      sha256(clean.observation.orders) === sha256(corrupted.observation.orders);

    const metaSubjects = new Set(
      perfect.events
        .filter(
          (event) => event.origin === "browser" && event.source === "meta",
        )
        .map((event) => event.subjectId),
    );
    const directSubjects = new Set(
      perfect.events
        .filter(
          (event) => event.origin === "browser" && event.source === "direct",
        )
        .map((event) => event.subjectId),
    );
    const purchasers = new Set(
      perfect.events
        .filter(
          (event) => event.origin === "server" && event.eventType === "purchase",
        )
        .map((event) => event.subjectId),
    );
    exposed += metaSubjects.size;
    exposedPurchases += [...metaSubjects].filter((id) => purchasers.has(id)).length;
    unexposed += directSubjects.size;
    unexposedPurchases += [...directSubjects].filter((id) => purchasers.has(id)).length;
  });

  for (let mask = 0; mask < 8; mask += 1) {
    for (const returnsShock of [false, true]) {
      const highIntent = Array.from(
        { length: 3 },
        (_, index) => ((mask >> index) & 1) === 1,
      );
      const off = perfectObservation(
        { highIntent, externalDemandShock: false, returnsShock },
        80_000 + mask * 4 + (returnsShock ? 1 : 0),
      );
      const on = perfectObservation(
        { highIntent, externalDemandShock: true, returnsShock },
        90_000 + mask * 4 + (returnsShock ? 1 : 0),
      );
      const prefix = (world: PerfectObservableWorld) =>
        world.events
          .filter((event) => Date.parse(event.occurredAt) < shockCutoff)
          .map((event) => ({
            origin: event.origin,
            eventType: event.eventType,
            occurredAt: event.occurredAt,
            source: event.source,
            amountMinor: event.amountMinor,
          }));
      stablePastAcrossShock &&=
        sha256(prefix(off)) === sha256(prefix(on));
    }
  }

  const exposedConversion = exposed === 0 ? 0 : exposedPurchases / exposed;
  const unexposedConversion =
    unexposed === 0 ? 0 : unexposedPurchases / unexposed;
  const confounding =
    exposed > 0 &&
    unexposed > 0 &&
    exposedConversion > unexposedConversion;
  const measurementCorruption =
    cleanMetaEvents > 0 &&
    corruptedMetaEvents === 0 &&
    corruptedDirectEvents > cleanMetaEvents &&
    preservedOrders;
  const dynamics = externalShocks && stablePastAcrossShock;
  const counterfactualInterventions =
    oracle.evaluations === input.candidates.length * input.outcomes.length &&
    new Set(oracle.ranking.map((row) => row.weightedContribution)).size > 1;

  const scaleMetaRevenueTrap =
    weightedRevenue("scale-meta") > weightedRevenue("baseline") &&
    weightedContribution("scale-meta") < weightedContribution("baseline");
  const discountRevenueTrap = promotionEconomics;
  const multipleTraps =
    scaleMetaRevenueTrap &&
    discountRevenueTrap &&
    measurementCorruption &&
    inventoryBindingStates > 0;

  const allMechanismsChecks: Record<
    (typeof LEVEL7_MECHANISM_REQUIREMENTS)[number],
    boolean
  > = {
    paid_media_response: paidMediaResponse,
    diminishing_channel_returns: diminishingChannelReturns,
    cross_channel_interaction: crossChannelInteraction,
    pricing_elasticity: pricingElasticity,
    promotion_economics: promotionEconomics,
    retention_customer_value: retentionCustomerValue,
    inventory_constraints: inventoryConstraints,
    external_shocks: externalShocks,
    measurement_corruption: measurementCorruption,
    returns_economics: returnsEconomics,
    counterfactual_interventions: counterfactualInterventions,
  };

  const allMechanisms = LEVEL7_MECHANISM_REQUIREMENTS.every(
    (mechanism) => allMechanismsChecks[mechanism],
  );
  const passed =
    allMechanisms &&
    confounding &&
    dynamics &&
    multipleTraps &&
    BigInt(oracle.probabilityDenominator) > 1n;

  return {
    passed,
    measurements: {
      worldHash: sha256({
        oracleInputHash: oracle.inputHash,
        measurementVersion: MEASUREMENT_VERSION,
        corruptConfig,
      }),
      candidateSetHash: oracle.candidateSetHash,
      oracleHash: oracle.resultHash,
      verifiedFeatures: [
        "stochastic",
        "confounding",
        "corruption",
        "dynamics",
        "multiple_traps",
        "all_mechanisms",
      ],
      deterministicAcrossExogenousStates: false,
      probabilityDenominator: oracle.probabilityDenominator,
      outcomeCount: input.outcomes.length,
      evaluatedActions: input.candidates.length,
      bestActionId: oracle.bestActionId,
      confoundingObserved: confounding,
      exposedConversion,
      unexposedConversion,
      cleanMetaEvents,
      corruptedMetaEvents,
      corruptedDirectEvents,
      preservedOrders,
      stablePastAcrossShock,
      inventoryBindingStates,
      scaleMetaRevenueTrap,
      discountRevenueTrap,
      allMechanismsCoverage: [...LEVEL7_MECHANISM_REQUIREMENTS],
      allMechanismsChecks,
      qualification:
        "executed_realistic_chaos_world_with_full_canonical_mechanism_evidence",
    },
  };
}
