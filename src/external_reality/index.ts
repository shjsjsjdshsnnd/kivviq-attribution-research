import { SharedRandomness, SimulationClock } from "../simulation/kernel.js";

export const EXTERNAL_REALITY_MODEL_VERSION = "external_reality_model_v1" as const;

export type ExternalDomain = "competition" | "economy" | "consumer" | "ad_market" | "platform" | "social" | "weather" | "supplier" | "logistics" | "calendar" | "category_market";
export type ExternalTarget = "demand" | "purchase_propensity" | "price_sensitivity" | "consideration_time" | "organic_traffic" | "store_traffic" | "cpm" | "cpc" | "ctr" | "traffic_quality" | "reported_attribution" | "supplier_lead_time" | "inventory_availability" | "landed_cost" | "delivery_time" | "shipping_cost" | "return_propensity" | "category_preference";
export interface ExternalScope {
  readonly markets?: readonly string[];
  readonly categories?: readonly string[];
  readonly channels?: readonly string[];
}
export interface ExternalEffect {
  readonly target: ExternalTarget;
  /** Additive change to the log of the target's baseline multiplier. */
  readonly logMultiplier: number;
  readonly scope?: ExternalScope;
  readonly delayMs?: number;
  readonly rampMs?: number;
  readonly decayMs?: number;
}
export interface ExternalEvent {
  readonly id: string;
  readonly domain: ExternalDomain;
  readonly kind: string;
  readonly startsAt: string;
  /** Exclusive; omitted for structural changes. */
  readonly endsAt?: string;
  readonly effects: readonly ExternalEffect[];
  readonly observation?: { readonly availableAt: string; readonly signal: string };
}
export interface ExternalEnvironment {
  readonly version: typeof EXTERNAL_REALITY_MODEL_VERSION;
  readonly seed: number;
  readonly events: readonly ExternalEvent[];
}
export interface ExternalContext {
  readonly market?: string;
  readonly category?: string;
  readonly channel?: string;
}

function timestamp(value: string): number {
  const result = Date.parse(value);
  if (!Number.isFinite(result) || !/Z$|[+-]\d\d:\d\d$/.test(value)) throw new RangeError(`invalid external timestamp: ${value}`);
  return result;
}

export function validateExternalEnvironment(environment: ExternalEnvironment): void {
  if (environment.version !== EXTERNAL_REALITY_MODEL_VERSION || !Number.isSafeInteger(environment.seed) || environment.seed < 0) throw new RangeError("invalid external model version or seed");
  const ids = new Set<string>();
  for (const event of environment.events) {
    if (!event.id || ids.has(event.id)) throw new RangeError("external event ids must be unique and nonempty");
    ids.add(event.id);
    const start = timestamp(event.startsAt);
    if (event.endsAt !== undefined && timestamp(event.endsAt) <= start) throw new RangeError("external event end must follow start");
    if (event.observation && timestamp(event.observation.availableAt) < start) throw new RangeError("early observation requires a separate public advance signal");
    for (const effect of event.effects) {
      if (!Number.isFinite(effect.logMultiplier) || effect.delayMs !== undefined && effect.delayMs < 0 || effect.rampMs !== undefined && effect.rampMs < 0 || effect.decayMs !== undefined && effect.decayMs < 0) throw new RangeError("invalid external effect");
    }
  }
}

/** Reuses the simulator's clock and counter-based randomness; no independent clock or mutable PRNG. */
export class ExternalRealityRuntime {
  private readonly streams: SharedRandomness;
  public constructor(public readonly environment: ExternalEnvironment, private readonly clock: SimulationClock) {
    validateExternalEnvironment(environment);
    this.streams = new SharedRandomness(environment.seed, EXTERNAL_REALITY_MODEL_VERSION);
  }
  public draw(domain: ExternalDomain, key: string): number {
    return this.streams.fork(domain).uniform(key);
  }
  public multiplier(target: ExternalTarget, context: ExternalContext = {}): number {
    const now = this.clock.nowMs;
    let log = 0;
    for (const event of this.environment.events) for (const effect of event.effects) {
      if (effect.target !== target || !matches(effect.scope, context)) continue;
      const start = timestamp(event.startsAt) + (effect.delayMs ?? 0);
      const end = event.endsAt === undefined ? Infinity : timestamp(event.endsAt) + (effect.delayMs ?? 0);
      if (now < start || now >= end + (effect.decayMs ?? 0)) continue;
      const ramp = effect.rampMs ? Math.min(1, (now - start) / effect.rampMs) : 1;
      const decay = now < end ? 1 : 1 - (now - end) / (effect.decayMs ?? 1);
      log += effect.logMultiplier * ramp * decay;
    }
    return Math.exp(log);
  }
  /** The only operator-facing projection; no effects, unseen events, or future signals. */
  public observations(): readonly { readonly eventId: string; readonly availableAt: string; readonly signal: string }[] {
    const now = this.clock.nowMs;
    return this.environment.events.flatMap(event => event.observation && timestamp(event.observation.availableAt) <= now
      ? [{ eventId: event.id, ...event.observation }] : []);
  }
}

function matches(scope: ExternalScope | undefined, context: ExternalContext): boolean {
  return (!scope?.markets || context.market !== undefined && scope.markets.includes(context.market))
    && (!scope?.categories || context.category !== undefined && scope.categories.includes(context.category))
    && (!scope?.channels || context.channel !== undefined && scope.channels.includes(context.channel));
}
