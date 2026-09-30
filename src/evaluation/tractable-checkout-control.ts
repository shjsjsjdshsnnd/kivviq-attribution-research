import type { OracleEconomics } from "./finite-decision-oracle.js";
import type { ExactOracleInput } from "./exact-decision-oracle.js";

export const TRACTABLE_CONTROL_VERSION = "tractable-checkout-control/1.0.0" as const;
interface Action { readonly kind: "none" | "google" | "meta" | "checkout" | "winback" | "discount"; readonly amount: number }
interface Parameters {
  readonly unitPriceMinor: number; readonly cogsMinor: number; readonly shippingMinor: number;
  readonly stock: number; readonly intentThresholds: readonly number[]; readonly mobile: readonly boolean[]; readonly returning: readonly boolean[];
}
/**
 * Small enumerated structural control, NOT a replacement for the frozen
 * event simulator or a calibrated ecommerce/adversarial scenario. Four buyers
 * have independent uniform integer thresholds in {0,1,2,3}: exactly 4^4 states.
 * Purchases, finite stock, prices, fees and spend generate scores; no answer table.
 */
export function buildTractableCheckoutControl(): ExactOracleInput<Action, readonly number[], Parameters> {
  const candidates: ExactOracleInput<Action, readonly number[], Parameters>["candidates"][number][] = [{ actionId: "a0", action: { kind: "none", amount: 0 } }];
  for (const kind of ["google", "meta"] as const) for (let n = 1; n <= 12; n += 1) candidates.push({ actionId: `${kind}-${n}`, action: { kind, amount: n * 10000 } });
  for (const kind of ["checkout", "winback", "discount"] as const) for (let n = 1; n <= 4; n += 1) candidates.push({ actionId: `${kind}-${n}`, action: { kind, amount: kind === "discount" ? n * 5 : n } });
  const outcomes = Array.from({ length: 256 }, (_, state) => ({ outcomeId: `u${state}`, weight: 1,
    world: Array.from({ length: 4 }, (_, buyer) => Math.floor(state / 4 ** buyer) % 4) }));
  return { modelVersion: TRACTABLE_CONTROL_VERSION,
    modelParameters: { unitPriceMinor: 100000, cogsMinor: 55000, shippingMinor: 3000,
      stock: 3, intentThresholds: [1, 2, 1, 2], mobile: [true, false, true, false], returning: [false, true, false, true] },
    actionSetVersion: "tractable-control-37-actions/1.0.0", completeActionSet: true, completeOutcomeSupport: true,
    baselineActionId: "a0", candidates, outcomes, currency: "CAD", scope: "four_explicit_buyers_one_period_booked_contribution",
    horizon: { start: "2026-01-01T00:00:00.000Z", end: "2026-01-02T00:00:00.000Z" }, maximumEvaluations: 37 * 256,
    evaluate: ({ action, world, parameters: p }): OracleEconomics => {
      const discount = action.kind === "discount" ? action.amount : 0;
      const price = Math.floor(p.unitPriceMinor * (100 - discount) / 100);
      const spend = action.kind === "google" || action.kind === "meta" ? action.amount : 0;
      const implementation = action.kind === "checkout" ? action.amount * 2500 : action.kind === "winback" ? action.amount * 500 : 0;
      let sold = 0;
      for (let buyer = 0; buyer < p.intentThresholds.length; buyer += 1) {
        const google = action.kind === "google" ? Math.min(1, Math.floor(action.amount / 40000)) : 0;
        const checkout = action.kind === "checkout" && p.mobile[buyer] ? action.amount : 0;
        const winback = action.kind === "winback" && p.returning[buyer] ? action.amount : 0;
        const threshold = Math.min(4, p.intentThresholds[buyer]! + google + checkout + winback + Math.floor(discount / 5));
        if (world[buyer]! < threshold && sold < p.stock) sold += 1;
      }
      return { netSalesMinor: sold * price, cogsMinor: sold * p.cogsMinor, paymentFeesMinor: sold * Math.floor(price * 3 / 100),
        fulfillmentMinor: sold * 1000, shippingCostMinor: sold * p.shippingMinor, variableOperatingCostMinor: 0,
        paidSpendMinor: spend, actionCostMinor: implementation };
    },
  };
}
