import {
  evaluateExactActionSet,
  type ExactOracleInput,
} from "./exact-decision-oracle.js";
import type { OracleEconomics } from "./finite-decision-oracle.js";
import { buildTractableCheckoutControl } from "./tractable-checkout-control.js";
import { sha256 } from "./replay-manifest.js";
import type { ExecutableValidationCase } from "./validation-evidence.js";
import { MEASUREMENT_VERSION, measurePerfectWorld, type PerfectObservableWorld } from "../measurement_corruption/index.js";

export const EXECUTABLE_DIFFICULTY_WORLD_VERSION =
  "phase1-executable-difficulty-worlds/0.1.0" as const;

type DeterministicAction =
  | { readonly kind: "baseline" }
  | { readonly kind: "checkout_fix" }
  | { readonly kind: "discount_10" };

interface DeterministicWorld {
  readonly demandUnits: number;
}

interface DeterministicParameters {
  readonly unitPriceMinor: number;
  readonly cogsMinor: number;
  readonly paymentFeeMinor: number;
  readonly fulfillmentMinor: number;
  readonly shippingMinor: number;
  readonly checkoutImplementationMinor: number;
}

const deterministicParameters: DeterministicParameters = {
  unitPriceMinor: 10_000,
  cogsMinor: 4_000,
  paymentFeeMinor: 300,
  fulfillmentMinor: 500,
  shippingMinor: 200,
  checkoutImplementationMinor: 1_000,
};

function deterministicEconomics(
  action: DeterministicAction,
  world: DeterministicWorld,
  p: DeterministicParameters = deterministicParameters,
): OracleEconomics {
  if (!Number.isSafeInteger(world.demandUnits) || world.demandUnits < 0) {
    throw new RangeError("deterministic demand must be a non-negative integer");
  }
  const discount = action.kind === "discount_10" ? 0.1 : 0;
  const unitPriceMinor = Math.floor(p.unitPriceMinor * (1 - discount));
  const units =
    world.demandUnits +
    (action.kind === "checkout_fix" || action.kind === "discount_10" ? 1 : 0);
  return {
    netSalesMinor: units * unitPriceMinor,
    cogsMinor: units * p.cogsMinor,
    paymentFeesMinor: units * p.paymentFeeMinor,
    fulfillmentMinor: units * p.fulfillmentMinor,
    shippingCostMinor: units * p.shippingMinor,
    variableOperatingCostMinor: 0,
    paidSpendMinor: 0,
    actionCostMinor:
      action.kind === "checkout_fix" ? p.checkoutImplementationMinor : 0,
  };
}

function contribution(e: OracleEconomics): number {
  return (
    e.netSalesMinor -
    e.cogsMinor -
    e.paymentFeesMinor -
    e.fulfillmentMinor -
    e.shippingCostMinor -
    e.variableOperatingCostMinor -
    e.paidSpendMinor -
    e.actionCostMinor
  );
}

/**
 * Level 1 is deliberately deterministic. The oracle has exactly one world
 * state. Separate fixed-demand probes establish that the checkout mechanism
 * has the same deterministic incremental economics across multiple exogenous
 * demand contexts; no random seed or probability draw is involved.
 */
export function buildDeterministicDifficultyControl(): ExactOracleInput<
  DeterministicAction,
  DeterministicWorld,
  DeterministicParameters
> {
  return {
    modelVersion: "difficulty-level-1-deterministic-commerce/1.0.0",
    modelParameters: deterministicParameters,
    actionSetVersion: "difficulty-level-1-actions/1.0.0",
    completeActionSet: true,
    completeOutcomeSupport: true,
    baselineActionId: "baseline",
    candidates: [
      { actionId: "baseline", action: { kind: "baseline" } },
      { actionId: "checkout-fix", action: { kind: "checkout_fix" } },
      { actionId: "discount-10", action: { kind: "discount_10" } },
    ],
    outcomes: [
      {
        outcomeId: "known-demand",
        weight: 1,
        world: { demandUnits: 2 },
      },
    ],
    currency: "CAD",
    scope: "deterministic_checkout_one_period_booked_contribution",
    horizon: {
      start: "2026-01-01T00:00:00.000Z",
      end: "2026-01-02T00:00:00.000Z",
    },
    maximumEvaluations: 3,
    evaluate: ({ action, world, parameters }) =>
      deterministicEconomics(action, world, parameters),
  };
}

async function level1Evidence() {
  const oracle = await evaluateExactActionSet(
    buildDeterministicDifficultyControl(),
  );
  const probes = [0, 1, 2, 3, 4].map((demandUnits) => {
    const world = { demandUnits };
    const base = contribution(
      deterministicEconomics({ kind: "baseline" }, world),
    );
    const fixed = contribution(
      deterministicEconomics({ kind: "checkout_fix" }, world),
    );
    return {
      demandUnits,
      baselineContributionMinor: base,
      checkoutFixContributionMinor: fixed,
      checkoutFixDeltaMinor: fixed - base,
    };
  });
  const deltas = new Set(probes.map((row) => row.checkoutFixDeltaMinor));
  const deterministicAcrossExogenousStates =
    deltas.size === 1 &&
    probes.every((row) => Number.isSafeInteger(row.checkoutFixDeltaMinor));
  const passed =
    oracle.probabilityDenominator === "1" &&
    oracle.evaluations === 3 &&
    oracle.bestActionId === "checkout-fix" &&
    deterministicAcrossExogenousStates;
  return {
    passed,
    measurements: {
      worldHash: oracle.inputHash,
      candidateSetHash: oracle.candidateSetHash,
      oracleHash: oracle.resultHash,
      verifiedFeatures: [],
      deterministicAcrossExogenousStates,
      probabilityDenominator: oracle.probabilityDenominator,
      exogenousProbeCount: probes.length,
      probeHash: sha256(probes),
      qualification:
        "executed_structural_world_not_logic_only_receipt",
    },
  };
}

async function level2Evidence() {
  const oracle = await evaluateExactActionSet(
    buildTractableCheckoutControl(),
  );
  const byAction = new Map<string, Set<number>>();
  for (const row of oracle.ledger) {
    const values = byAction.get(row.actionId) ?? new Set<number>();
    values.add(row.contributionMinor);
    byAction.set(row.actionId, values);
  }
  const stochasticOutcomeResponse =
    BigInt(oracle.probabilityDenominator) > 1n &&
    new Set(oracle.ledger.map((row) => row.outcomeId)).size > 1 &&
    [...byAction.values()].some((values) => values.size > 1);
  const passed =
    oracle.evaluations === 9_472 &&
    oracle.ranking.length === 37 &&
    stochasticOutcomeResponse;
  return {
    passed,
    measurements: {
      worldHash: oracle.inputHash,
      candidateSetHash: oracle.candidateSetHash,
      oracleHash: oracle.resultHash,
      verifiedFeatures: ["stochastic"],
      deterministicAcrossExogenousStates: false,
      probabilityDenominator: oracle.probabilityDenominator,
      outcomeCount: new Set(oracle.ledger.map((row) => row.outcomeId)).size,
      evaluatedActions: oracle.ranking.length,
      stochasticOutcomeResponse,
      qualification:
        "executed_structural_world_not_logic_only_receipt",
    },
  };
}


type ConfoundedAction =
  | { readonly kind: "baseline_meta" }
  | { readonly kind: "scale_meta" }
  | { readonly kind: "cut_meta" };

interface ConfoundedWorld {
  readonly highIntent: readonly boolean[];
}

interface ConfoundedParameters {
  readonly unitPriceMinor: number;
  readonly unitVariableCostMinor: number;
  readonly baselineMetaSpendMinor: number;
}

const confoundedParameters: ConfoundedParameters = {
  unitPriceMinor: 12_000,
  unitVariableCostMinor: 5_000,
  baselineMetaSpendMinor: 12_000,
};

function binaryWorlds(size: number): readonly {
  readonly outcomeId: string;
  readonly weight: number;
  readonly world: ConfoundedWorld;
}[] {
  if (!Number.isSafeInteger(size) || size < 1 || size > 12) {
    throw new RangeError("confounded world size must be a small positive integer");
  }
  return Array.from({ length: 2 ** size }, (_, mask) => ({
    outcomeId: `intent-${mask.toString(2).padStart(size, "0")}`,
    weight: 1,
    world: {
      highIntent: Array.from(
        { length: size },
        (_, index) => ((mask >> index) & 1) === 1,
      ),
    },
  }));
}

function confoundedEconomics(
  action: ConfoundedAction,
  world: ConfoundedWorld,
  p: ConfoundedParameters = confoundedParameters,
): OracleEconomics {
  const purchases = world.highIntent.filter(Boolean).length;
  const paidSpendMinor =
    action.kind === "cut_meta"
      ? 0
      : action.kind === "scale_meta"
        ? p.baselineMetaSpendMinor * 2
        : p.baselineMetaSpendMinor;
  return {
    netSalesMinor: purchases * p.unitPriceMinor,
    cogsMinor: purchases * p.unitVariableCostMinor,
    paymentFeesMinor: 0,
    fulfillmentMinor: 0,
    shippingCostMinor: 0,
    variableOperatingCostMinor: 0,
    paidSpendMinor,
    actionCostMinor: 0,
  };
}

/**
 * Level 3 introduces selection confounding without measurement corruption.
 * High-intent buyers are preferentially observed with Meta exposure, but Meta
 * has zero causal effect on purchase. Exact state-by-state interventions prove
 * that cutting Meta leaves purchases unchanged while saving spend.
 */
export function buildConfoundedDifficultyControl(): ExactOracleInput<
  ConfoundedAction,
  ConfoundedWorld,
  ConfoundedParameters
> {
  return {
    modelVersion: "difficulty-level-3-selection-confounding/1.0.0",
    modelParameters: confoundedParameters,
    actionSetVersion: "difficulty-level-3-actions/1.0.0",
    completeActionSet: true,
    completeOutcomeSupport: true,
    baselineActionId: "baseline-meta",
    candidates: [
      { actionId: "baseline-meta", action: { kind: "baseline_meta" } },
      { actionId: "scale-meta", action: { kind: "scale_meta" } },
      { actionId: "cut-meta", action: { kind: "cut_meta" } },
    ],
    outcomes: binaryWorlds(4),
    currency: "CAD",
    scope: "confounded_meta_selection_one_period_booked_contribution",
    horizon: {
      start: "2026-01-01T00:00:00.000Z",
      end: "2026-01-08T00:00:00.000Z",
    },
    maximumEvaluations: 48,
    evaluate: ({ action, world, parameters }) =>
      confoundedEconomics(action, world, parameters),
  };
}

async function level3Evidence() {
  const input = buildConfoundedDifficultyControl();
  const oracle = await evaluateExactActionSet(input);
  const baselineRows = oracle.ledger.filter(
    (row) => row.actionId === "baseline-meta",
  );
  const cutRows = oracle.ledger.filter((row) => row.actionId === "cut-meta");
  const cutByOutcome = new Map(
    cutRows.map((row) => [row.outcomeId, row]),
  );

  // Perfectly observed exposure/purchase association. Exposure is selected by
  // latent intent: every high-intent buyer is Meta-exposed; low-intent buyers
  // are not. The latent intent variable itself is not observable.
  let exposed = 0;
  let exposedPurchases = 0;
  let unexposed = 0;
  let unexposedPurchases = 0;
  let statewisePurchaseInvariance = true;
  for (const outcome of input.outcomes) {
    for (const highIntent of outcome.world.highIntent) {
      if (highIntent) {
        exposed += outcome.weight;
        exposedPurchases += outcome.weight;
      } else {
        unexposed += outcome.weight;
      }
    }
    const baseline = baselineRows.find(
      (row) => row.outcomeId === outcome.outcomeId,
    )!;
    const cut = cutByOutcome.get(outcome.outcomeId)!;
    // Paid spend is the only economic field changed by the intervention.
    statewisePurchaseInvariance &&=
      baseline.economics.netSalesMinor === cut.economics.netSalesMinor &&
      baseline.economics.cogsMinor === cut.economics.cogsMinor;
  }
  const exposedConversion =
    exposed === 0 ? 0 : exposedPurchases / exposed;
  const unexposedConversion =
    unexposed === 0 ? 0 : unexposedPurchases / unexposed;
  const confoundingObserved =
    exposed > 0 &&
    unexposed > 0 &&
    exposedConversion > unexposedConversion;
  const stochasticOutcomeResponse =
    BigInt(oracle.probabilityDenominator) > 1n &&
    new Set(
      baselineRows.map((row) => row.contributionMinor),
    ).size > 1;
  const passed =
    oracle.evaluations === 48 &&
    oracle.bestActionId === "cut-meta" &&
    stochasticOutcomeResponse &&
    confoundingObserved &&
    statewisePurchaseInvariance;

  return {
    passed,
    measurements: {
      worldHash: oracle.inputHash,
      candidateSetHash: oracle.candidateSetHash,
      oracleHash: oracle.resultHash,
      verifiedFeatures: ["stochastic", "confounding"],
      deterministicAcrossExogenousStates: false,
      probabilityDenominator: oracle.probabilityDenominator,
      outcomeCount: input.outcomes.length,
      exposedConversion,
      unexposedConversion,
      confoundingObserved,
      statewisePurchaseInvariance,
      qualification:
        "executed_structural_world_not_logic_only_receipt",
    },
  };
}


function perfectWorldForConfoundedState(
  world: ConfoundedWorld,
  ordinal: number,
): PerfectObservableWorld {
  const periodStart = "2026-01-01T00:00:00.000Z";
  const periodEnd = "2026-01-08T00:00:00.000Z";
  const sessionAt = "2026-01-02T00:00:00.000Z";
  const purchaseAt = "2026-01-03T00:00:00.000Z";
  const events: PerfectObservableWorld["events"] = [];
  world.highIntent.forEach((highIntent, buyer) => {
    const subjectId = `difficulty-l4-${ordinal}-buyer-${buyer}`;
    const sessionId = `difficulty-l4-${ordinal}-session-${buyer}`;
    events.push({
      eventId: `difficulty-l4-${ordinal}-visit-${buyer}`,
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
        eventId: `difficulty-l4-${ordinal}-purchase-${buyer}`,
        origin: "server",
        eventType: "purchase",
        occurredAt: purchaseAt,
        subjectId,
        subjectCreatedAt: periodStart,
        knownCustomerId: `customer-${buyer}`,
        source: "unknown",
        orderId: `difficulty-l4-${ordinal}-order-${buyer}`,
        amountMinor: confoundedParameters.unitPriceMinor,
      });
    }
  });
  return {
    schemaVersion: "perfect-observation/1.0.0",
    periodStart,
    periodEnd,
    events,
    spend: [
      {
        id: `difficulty-l4-${ordinal}-meta-spend`,
        platform: "meta",
        occurredAt: sessionAt,
        amountMinor: confoundedParameters.baselineMetaSpendMinor,
      },
    ],
  };
}

/**
 * Level 4 keeps the Level 3 stochastic confounding mechanism and passes its
 * perfect observable facts through the production measurement-corruption
 * channel. Missing UTMs turn genuine Meta browser sessions into direct traffic
 * while server orders remain unchanged.
 */
async function level4Evidence() {
  const base = await level3Evidence();
  const input = buildConfoundedDifficultyControl();
  const cleanConfig = {
    version: MEASUREMENT_VERSION,
    seed: 9404,
    identitySalt: "difficulty-level4-private-identity",
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
  const reasons = new Set<string>();
  input.outcomes.forEach((outcome, ordinal) => {
    const perfect = perfectWorldForConfoundedState(outcome.world, ordinal);
    const clean = measurePerfectWorld(
      perfect,
      cleanConfig,
      perfect.periodEnd,
    );
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
      sha256(clean.observation.orders) ===
      sha256(corrupted.observation.orders);
    for (const row of corrupted.audit.rows) {
      for (const reason of row.reasons) reasons.add(reason);
    }
  });
  const corruptionObserved =
    cleanMetaEvents > 0 &&
    corruptedMetaEvents === 0 &&
    corruptedDirectEvents > cleanMetaEvents &&
    reasons.has("missing_utms") &&
    reasons.has("direct_fallback") &&
    preservedOrders;
  return {
    passed: base.passed && corruptionObserved,
    measurements: {
      ...base.measurements,
      worldHash: sha256({
        baseWorldHash: base.measurements["worldHash"],
        measurementVersion: MEASUREMENT_VERSION,
        cleanConfig,
        corruptConfig,
      }),
      verifiedFeatures: ["stochastic", "confounding", "corruption"],
      cleanMetaEvents,
      corruptedMetaEvents,
      corruptedDirectEvents,
      preservedOrders,
      corruptionReasons: [...reasons].sort(),
      corruptionObserved,
      qualification:
        "executed_structural_world_with_production_measurement_corruption",
    },
  };
}

export function buildExecutableDifficultyWorldCases(): readonly ExecutableValidationCase[] {
  return [
    {
      spec: {
        caseId: "difficulty:level-1:deterministic-commerce",
        implementationVersion: EXECUTABLE_DIFFICULTY_WORLD_VERSION,
        kind: "qualified_difficulty_world",
        difficultyLevel: 1,
        requirements: ["difficulty_levels"],
      },
      run: level1Evidence,
    },
    {
      spec: {
        caseId: "difficulty:level-2:stochastic-buyers",
        implementationVersion: EXECUTABLE_DIFFICULTY_WORLD_VERSION,
        kind: "qualified_difficulty_world",
        difficultyLevel: 2,
        requirements: ["difficulty_levels"],
      },
      run: level2Evidence,
    },
    {
      spec: {
        caseId: "difficulty:level-3:selection-confounding",
        implementationVersion: EXECUTABLE_DIFFICULTY_WORLD_VERSION,
        kind: "qualified_difficulty_world",
        difficultyLevel: 3,
        requirements: ["difficulty_levels"],
      },
      run: level3Evidence,
    },
    {
      spec: {
        caseId: "difficulty:level-4:corrupted-confounding",
        implementationVersion: EXECUTABLE_DIFFICULTY_WORLD_VERSION,
        kind: "qualified_difficulty_world",
        difficultyLevel: 4,
        requirements: ["difficulty_levels"],
      },
      run: level4Evidence,
    },
  ] as const;
}
