const forbiddenKeys = new Set([
  "groundtruth",
  "groundtruthmanifest",
  "oraclestate",
  "oracleanswer",
  "latentstate",
  "futurestate",
  "optimalaction",
  "optimalvalue",
  "decisionregret",
  "actualbestaction",
  "trueincrementalprofit",
  "trueincrementalroas",
  "predictedbestaction",
]);

const forbiddenReference = /(^|[.:/_-])(ground[_-]?truth|oracle|god[_-]?mode|latent[_-]?state|future[_-]?state|optimal[_-]?(action|value)|actual[_-]?best[_-]?action|true[_-]?incremental[_-]?(profit|roas))([.:/_-]|$)/i;

function normalized(key: string): string {
  return key.replace(/[_-]/g, "").toLowerCase();
}

export class OpportunitySafetyError extends Error {
  override readonly name = "OpportunitySafetyError";
}

export function assertOperatorSafeOpportunityInput(
  value: unknown,
  path: readonly (string | number)[] = [],
  state: { readonly ancestors: WeakSet<object>; nodes: number } = { ancestors: new WeakSet<object>(), nodes: 0 },
): void {
  if (typeof value === "string") {
    if (forbiddenReference.test(value)) throw new OpportunitySafetyError("Hidden evaluator or future-state reference at " + path.join("."));
    return;
  }
  if (value === null || typeof value !== "object") return;
  state.nodes += 1;
  if (state.nodes > 30_000) throw new OpportunitySafetyError("Opportunity input exceeds bounded validation complexity");
  if (state.ancestors.has(value)) throw new OpportunitySafetyError("Cyclic opportunity input at " + path.join("."));
  state.ancestors.add(value);
  const entries = Array.isArray(value)
    ? value.map((entry, index) => [index, entry] as const)
    : Object.entries(value);
  for (const [key, nested] of entries) {
    if (typeof key === "string" && forbiddenKeys.has(normalized(key))) {
      throw new OpportunitySafetyError("Hidden evaluator or future-state field at " + [...path, key].join("."));
    }
    assertOperatorSafeOpportunityInput(nested, [...path, key], state);
  }
  state.ancestors.delete(value);
}
