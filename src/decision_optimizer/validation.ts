import { INPUT_METRICS, OBJECTIVE_METRICS, type OptimizationInput } from "./types.js";
import { finite, nonnegative } from "./math.js";
/** Reject non-JSON objects/accessors before reading them; cap input complexity. */
export function copyData<T>(input: T): T {
  let nodes = 0;
  const ancestors = new Set<object>();
  const visit = (value: unknown, depth: number): unknown => {
    if (++nodes > 250_000 || depth > 40) throw new Error("Input complexity limit exceeded");
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number") { finite(value, "JSON number"); return value; }
    if (typeof value !== "object") throw new Error("Only plain JSON data is accepted");
    if (ancestors.has(value)) throw new Error("Cyclic input");
    const array = Array.isArray(value);
    if (!array && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new Error("Non-plain object");
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.getOwnPropertySymbols(value).length) throw new Error("Symbol properties forbidden");
    ancestors.add(value);
    const result: Record<string, unknown> | unknown[] = array ? [] : {};
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (array && key === "length") continue;
      if (!descriptor.enumerable || !("value" in descriptor)) throw new Error("Hidden properties/accessors forbidden");
      if (["__proto__", "constructor", "prototype"].includes(key)) throw new Error("Unsafe property");
      if (/(ground.?truth|oracle|god.?mode|latent.?state|actual.?best.?action|decision.?regret)/i.test(key)) throw new Error("Hidden evaluator information forbidden");
      if (array && !/^(0|[1-9]\d*)$/.test(key)) throw new Error("Non-index array property");
      (result as Record<string, unknown>)[key] = visit(descriptor.value, depth + 1);
    }
    if (array && Object.keys(result).length !== (value as unknown[]).length) throw new Error("Sparse arrays forbidden");
    ancestors.delete(value); return result;
  };
  return visit(input, 0) as T;
}
export function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object") { Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); }
  return value;
}
export function exactKeys(value: object, allowed: readonly string[]): void {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Object required");
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`Unknown field ${key}`);
}
export function id(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9_.:-]{0,250}$/.test(value)
    || /(^|[_.:-])(oracle|ground.?truth|god.?mode|latent)([_.:-]|$)/i.test(value)) throw new Error("Invalid operator-safe identifier");
}
export function strings(values: string[], minimum = 0): void {
  if (!Array.isArray(values) || values.length < minimum || values.some(value => typeof value !== "string" || !value.trim())) throw new Error("Nonempty strings required");
}
function integer(value: unknown, low: number, high: number): asserts value is number {
  finite(value, "integer"); if (!Number.isInteger(value) || value < low || value > high) throw new Error("Integer outside bounds");
}
const metrics = [...INPUT_METRICS, "contributionProfit", "grossMarginRate", "retentionRate", "conversionRate", "cac"] as readonly string[];
export function validateInput(input: OptimizationInput): void {
  exactKeys(input, ["decisionId", "context", "objective", "options", "resources", "metricConstraints", "policy"]); id(input.decisionId);
  const c = input.context;
  exactKeys(c, ["merchantId", "snapshotId", "currency", "moneyUnit", "asOf", "timeZone", "dayBoundaries"]); id(c.merchantId); id(c.snapshotId);
  if (c.moneyUnit !== "MAJOR") throw new Error("Explicit major currency units required");
  if (!/^[A-Z]{3}$/.test(c.currency)) throw new Error("Explicit currency required");
  strings([c.timeZone], 1);
  const calendar = new Intl.DateTimeFormat("en-CA", { timeZone: c.timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  const timestamp = (value: string): number => {
    if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value)) throw new Error("UTC timestamp required");
    const result = Date.parse(value); if (!Number.isFinite(result) || new Date(result).toISOString().replace(".000Z", "Z") !== value.replace(".000Z", "Z")) throw new Error("Invalid timestamp");
    return result;
  };
  if (!Array.isArray(c.dayBoundaries)) throw new Error("Day boundaries required");
  integer(c.dayBoundaries.length, 2, 367);
  const times = c.dayBoundaries.map(timestamp);
  if (timestamp(c.asOf) > times[0]!) throw new Error("Snapshot cannot postdate decision horizon");
  for (let i = 1; i < times.length; i++) if (!(times[i]! > times[i - 1]!)) throw new Error("Day boundaries must increase");
  const localDays = times.map(time => {
    const parts = Object.fromEntries(calendar.formatToParts(new Date(time)).map(part => [part.type, part.value]));
    if (parts["hour"] !== "00" || parts["minute"] !== "00" || parts["second"] !== "00" || time % 1000 !== 0) throw new Error("Day boundary must be merchant-local midnight");
    return Date.UTC(Number(parts["year"]), Number(parts["month"]) - 1, Number(parts["day"]));
  });
  for (let i = 1; i < localDays.length; i++) if (localDays[i]! - localDays[i - 1]! !== 86400000) throw new Error("Calendar days must be consecutive");
  const days = times.length - 1;
  exactKeys(input.objective, ["intent", "terms"]); strings([input.objective.intent], 1);
  if (!Array.isArray(input.objective.terms) || !input.objective.terms.length) throw new Error("Measurable objective required");
  const objectiveKeys = new Set<string>();
  for (const term of input.objective.terms) {
    exactKeys(term, ["metric", "direction", "weight", "scale"]);
    if (!(OBJECTIVE_METRICS as readonly string[]).includes(term.metric) || !["MAXIMIZE", "MINIMIZE"].includes(term.direction)) throw new Error("Unsupported objective; attributed revenue/ROAS cannot be optimized");
    if (objectiveKeys.has(term.metric)) throw new Error("Duplicate/conflicting objective metric"); objectiveKeys.add(term.metric);
    finite(term.weight, "weight"); finite(term.scale, "scale"); if (!(term.weight > 0 && term.scale > 0)) throw new Error("Positive weights/scales required");
  }
  const p = input.policy;
  exactKeys(p, ["maxCandidates", "maxPortfolioSize", "uncertaintyPenalty", "downsidePenalty", "irreversiblePenalty", "tailProbability", "practicalTieUtility", "requireCalibration"]);
  integer(p.maxCandidates, 1, 10000); integer(p.maxPortfolioSize, 1, 8);
  for (const number of [p.uncertaintyPenalty, p.downsidePenalty, p.irreversiblePenalty, p.practicalTieUtility]) nonnegative(number, "risk/tie policy");
  if (!(p.tailProbability > 0 && p.tailProbability < 0.5) || typeof p.requireCalibration !== "boolean") throw new Error("Explicit uncertainty policy required");
  const resourceIds = new Set<string>();
  if (!Array.isArray(input.resources)) throw new Error("Resources required");
  for (const resource of input.resources) {
    exactKeys(resource, ["resourceId", "unit", "kind", "capacityByDay", "evidenceRefs"]); id(resource.resourceId);
    if (resourceIds.has(resource.resourceId)) throw new Error("Duplicate resource"); resourceIds.add(resource.resourceId);
    if (!["CONSUMABLE", "RENEWABLE"].includes(resource.kind) || !["MONEY", "UNITS", "HOURS", "COUNT"].includes(resource.unit)) throw new Error("Invalid resource kind/unit");
    if (!Array.isArray(resource.capacityByDay) || resource.capacityByDay.length !== days) throw new Error("Resource calendar mismatch");
    resource.capacityByDay.forEach(value => nonnegative(value, "capacity")); strings(resource.evidenceRefs, 1); resource.evidenceRefs.forEach(id);
  }
  const seen = new Set<string>(); const actions = new Set<string>();
  if (!Array.isArray(input.options)) throw new Error("Options required"); integer(input.options.length, 0, 1000);
  for (const option of input.options) {
    exactKeys(option, ["optionId", "opportunityId", "merchantId", "snapshotId", "actionId", "actionFingerprint", "label", "actionType", "targetRef", "parameters", "startDay", "endDay", "resources", "exclusiveGroups", "conflictKeys", "dependencies", "reversibility", "owner", "evidenceRefs", "assumptions", "stopRules"]);
    [option.optionId, option.opportunityId, option.actionId, option.targetRef].forEach(id);
    strings([option.actionFingerprint, option.label, option.actionType, option.owner], 4);
    if (seen.has(option.optionId) || actions.has(option.actionId)) throw new Error("Duplicate option/action identity"); seen.add(option.optionId); actions.add(option.actionId);
    if (option.merchantId !== c.merchantId || option.snapshotId !== c.snapshotId) throw new Error("Cross-merchant/snapshot option");
    integer(option.startDay, 0, days - 1); integer(option.endDay, option.startDay + 1, days);
    exactKeys(option.parameters, Object.keys(option.parameters));
    for (const value of Object.values(option.parameters)) if (value !== null && !["string", "number", "boolean"].includes(typeof value)) throw new Error("Primitive bound parameters required");
    strings(option.exclusiveGroups); strings(option.conflictKeys); strings(option.assumptions); strings(option.evidenceRefs, 1); option.evidenceRefs.forEach(id);
    if (!Array.isArray(option.resources) || !Array.isArray(option.dependencies) || !Array.isArray(option.stopRules)) throw new Error("Action contracts required");
    const uses = new Set<string>();
    for (const use of option.resources) {
      exactKeys(use, ["resourceId", "quantity"]); id(use.resourceId); nonnegative(use.quantity, "resource use");
      if (!resourceIds.has(use.resourceId)) throw new Error(`Unbounded resource ${use.resourceId}`);
      if (uses.has(use.resourceId)) throw new Error("Duplicate resource debit"); uses.add(use.resourceId);
    }
    for (const dep of option.dependencies) {
      exactKeys(dep, ["opportunityId", "minimumLagDays", "outcomeGate"]); id(dep.opportunityId); integer(dep.minimumLagDays, 0, days);
      if (typeof dep.outcomeGate !== "boolean") throw new Error("Dependency outcome gate required");
    }
    if (!["FULL", "PARTIAL", "NONE", "UNKNOWN"].includes(option.reversibility)) throw new Error("Unknown reversibility");
    for (const rule of option.stopRules) {
      exactKeys(rule, ["ruleId", "metric", "operator", "threshold", "consecutiveCompleteDays", "response"]); id(rule.ruleId);
      if (![...metrics, "marginalCac"].includes(rule.metric) || !["ABOVE", "BELOW"].includes(rule.operator) || !["STOP", "ROLLBACK", "REASSESS"].includes(rule.response)) throw new Error("Invalid stop rule");
      finite(rule.threshold, "stop threshold"); integer(rule.consecutiveCompleteDays, 1, 366);
      if (rule.response === "ROLLBACK" && option.reversibility !== "FULL") throw new Error("Automatic rollback requires full reversibility");
    }
  }
  const constraintIds = new Set<string>();
  if (!Array.isArray(input.metricConstraints)) throw new Error("Constraints required");
  for (const rule of input.metricConstraints) {
    exactKeys(rule, ["constraintId", "metric", "basis", "operator", "threshold", "enforcement"]); id(rule.constraintId);
    if (constraintIds.has(rule.constraintId)) throw new Error("Duplicate constraint"); constraintIds.add(rule.constraintId);
    if (!metrics.includes(rule.metric) || !["TOTAL", "INCREMENTAL"].includes(rule.basis) || !["AT_LEAST", "AT_MOST"].includes(rule.operator) || !["EXPECTED", "EVERY_SCENARIO"].includes(rule.enforcement)) throw new Error("Invalid metric constraint");
    finite(rule.threshold, "constraint threshold");
  }
}
