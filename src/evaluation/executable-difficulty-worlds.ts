import {
  evaluateExactActionSet,
  type ExactOracleInput,
} from "./exact-decision-oracle.js";
import type { OracleEconomics } from "./finite-decision-oracle.js";
import { buildTractableCheckoutControl } from "./tractable-checkout-control.js";
import { sha256 } from "./replay-manifest.js";
import type { ExecutableValidationCase } from "./validation-evidence.js";

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
  ] as const;
}
