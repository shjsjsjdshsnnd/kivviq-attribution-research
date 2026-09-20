import type { Intervention } from "../ground_truth/interventions.js";
import {
  buildAdvertisingPerformanceReport,
  defaultAdvertisingAllocation,
  referenceSpendMinor,
} from "./evaluator.js";
import type {
  AdvertisingAllocation,
  AdvertisingEvaluationRequest,
  AdvertisingPerformanceReport,
  PaidMarketingChannel,
} from "./types.js";

export class AdvertisingBudgetError extends Error {}

export function allocationSpendMinor(
  allocation: AdvertisingAllocation,
): number {
  return Object.values(
    allocation.spendMinorByChannel,
  ).reduce((sum, spend) => sum + (spend ?? 0), 0);
}

export function validateBudgetConstraint(
  allocation: AdvertisingAllocation,
  budgetMinor: number,
): void {
  if (!Number.isFinite(budgetMinor) || budgetMinor < 0) {
    throw new AdvertisingBudgetError(
      "budget must be finite and non-negative",
    );
  }

  const spend = allocationSpendMinor(allocation);
  if (spend > budgetMinor + 1e-9) {
    throw new AdvertisingBudgetError(
      `allocation spend ${spend} exceeds budget ${budgetMinor}`,
    );
  }
}

export function spendSetIntervention(
  channel: PaidMarketingChannel,
  spendMinor: number,
): Intervention {
  if (!Number.isFinite(spendMinor) || spendMinor < 0) {
    throw new AdvertisingBudgetError(
      "spend must be finite and non-negative",
    );
  }

  return {
    variable: `marketing.${channel}.spend`,
    operation: "set",
    value: {
      kind: "number",
      value: spendMinor,
      unit: "money_minor",
    },
  };
}

export function spendDeltaIntervention(
  request: Pick<
    AdvertisingEvaluationRequest,
    "merchantWorld" | "spendMinorByChannel"
  >,
  channel: PaidMarketingChannel,
  deltaMinor: number,
): Intervention {
  if (!Number.isFinite(deltaMinor)) {
    throw new AdvertisingBudgetError(
      "spend delta must be finite",
    );
  }

  const current =
    request.spendMinorByChannel?.[channel] ??
    referenceSpendMinor(request.merchantWorld, channel);

  return spendSetIntervention(
    channel,
    Math.max(0, current + deltaMinor),
  );
}

export function spendMultiplierIntervention(
  request: Pick<
    AdvertisingEvaluationRequest,
    "merchantWorld" | "spendMinorByChannel"
  >,
  channel: PaidMarketingChannel,
  multiplier: number,
): Intervention {
  if (!Number.isFinite(multiplier) || multiplier < 0) {
    throw new AdvertisingBudgetError(
      "spend multiplier must be finite and non-negative",
    );
  }

  const current =
    request.spendMinorByChannel?.[channel] ??
    referenceSpendMinor(request.merchantWorld, channel);

  return spendSetIntervention(
    channel,
    current * multiplier,
  );
}

export interface BudgetCandidate {
  readonly id: string;
  readonly spendMinorByChannel: AdvertisingAllocation["spendMinorByChannel"];
}

export interface BudgetCandidateEvaluation {
  readonly id: string;
  readonly totalSpendMinor: number;
  readonly report: AdvertisingPerformanceReport;
}

export function evaluateBudgetCandidates(
  request: AdvertisingEvaluationRequest,
  budgetMinor: number,
  candidates: readonly BudgetCandidate[],
): readonly BudgetCandidateEvaluation[] {
  if (candidates.length === 0) return [];

  const base = defaultAdvertisingAllocation(
    request.merchantWorld,
    request.periodStart,
    request.periodEnd,
  );

  return candidates.map((candidate) => {
    const allocation: AdvertisingAllocation = {
      ...base,
      spendMinorByChannel: {
        ...base.spendMinorByChannel,
        ...candidate.spendMinorByChannel,
      },
    };

    validateBudgetConstraint(allocation, budgetMinor);

    const report = buildAdvertisingPerformanceReport({
      ...request,
      spendMinorByChannel: allocation.spendMinorByChannel,
    });

    return {
      id: candidate.id,
      totalSpendMinor: allocationSpendMinor(allocation),
      report,
    };
  });
}
