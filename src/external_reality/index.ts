import { SharedRandomness, SimulationClock } from "../simulation/kernel.js";

export const EXTERNAL_REALITY_MODEL_VERSION =
  "external_reality_model_v1" as const;

export type ExternalDomain =
  | "competition"
  | "economy"
  | "consumer"
  | "ad_market"
  | "platform"
  | "social"
  | "weather"
  | "supplier"
  | "logistics"
  | "calendar";

export type ExternalEventKind =
  | "competitor_launch"
  | "competitor_sale"
  | "economic_slowdown"
  | "viral_tiktok"
  | "weather_event"
  | "holiday_timing"
  | "supplier_problem"
  | "shipping_disruption"
  | "cac_inflation"
  | "platform_algorithm_change"
  | "consumer_trend";

export type ExternalTarget =
  | "demand"
  | "purchase_propensity"
  | "price_sensitivity"
  | "consideration_time"
  | "organic_traffic"
  | "store_traffic"
  | "cpm"
  | "cpc"
  | "ctr"
  | "traffic_quality"
  | "reported_attribution"
  | "supplier_lead_time"
  | "inventory_availability"
  | "landed_cost"
  | "delivery_time"
  | "shipping_cost"
  | "return_propensity"
  | "category_preference";

export type ExternalDevice =
  | "mobile"
  | "desktop"
  | "tablet";

export interface ExternalScope {
  readonly markets?: readonly string[];
  readonly categories?: readonly string[];
  readonly channels?: readonly string[];
  readonly products?: readonly string[];
  readonly devices?: readonly ExternalDevice[];
}

export interface ExternalContext {
  readonly market?: string;
  readonly category?: string;
  readonly channel?: string;
  readonly product?: string;
  readonly device?: ExternalDevice;
}

export interface ExternalEffect {
  readonly target: ExternalTarget;
  /**
   * Additive change in log space. Math.log(0.8) means a 20% reduction;
   * Math.log(1.25) means a 25% increase. Multiple effects compose
   * multiplicatively without order-dependent imperative mutation.
   */
  readonly logMultiplier: number;
  readonly scope?: ExternalScope;
  readonly delayMs?: number;
  readonly rampMs?: number;
  readonly decayMs?: number;
}

export type ExternalObservationKind =
  | "forecast"
  | "contemporaneous"
  | "lagged_report";

export interface ExternalObservation {
  readonly kind: ExternalObservationKind;
  readonly availableAt: string;
  readonly signal: string;
}

export interface ExternalEvent {
  readonly id: string;
  readonly domain: ExternalDomain;
  readonly kind: ExternalEventKind;
  readonly startsAt: string;
  /** Exclusive; omitted for structural changes. */
  readonly endsAt?: string;
  readonly effects: readonly ExternalEffect[];
  readonly observations?: readonly ExternalObservation[];
}

export interface ExternalEnvironment {
  readonly version: typeof EXTERNAL_REALITY_MODEL_VERSION;
  readonly environmentId: string;
  readonly seed: number;
  readonly events: readonly ExternalEvent[];
}

export interface ExternalEffectContribution {
  readonly eventId: string;
  readonly eventKind: ExternalEventKind;
  readonly target: ExternalTarget;
  readonly logMultiplier: number;
  readonly temporalWeight: number;
  readonly appliedLogMultiplier: number;
}

export interface ResolvedExternalEffect {
  readonly target: ExternalTarget;
  readonly timestampMs: number;
  readonly context: ExternalContext;
  readonly multiplier: number;
  readonly contributions: readonly ExternalEffectContribution[];
}

export interface ExternalSignalObservation {
  readonly eventId: string;
  readonly domain: ExternalDomain;
  readonly eventKind: ExternalEventKind;
  readonly observationKind: ExternalObservationKind;
  readonly availableAt: string;
  readonly signal: string;
}

export interface ExternalRealityGodModeTruth {
  readonly modelVersion: typeof EXTERNAL_REALITY_MODEL_VERSION;
  readonly environmentId: string;
  readonly seed: number;
  readonly events: readonly ExternalEvent[];
}

export const CANONICAL_EXTERNAL_EVENT_KINDS: readonly ExternalEventKind[] = [
  "competitor_launch",
  "competitor_sale",
  "economic_slowdown",
  "viral_tiktok",
  "weather_event",
  "holiday_timing",
  "supplier_problem",
  "shipping_disruption",
  "cac_inflation",
  "platform_algorithm_change",
  "consumer_trend",
] as const;

const DOMAIN_BY_KIND: Readonly<Record<ExternalEventKind, ExternalDomain>> = {
  competitor_launch: "competition",
  competitor_sale: "competition",
  economic_slowdown: "economy",
  viral_tiktok: "social",
  weather_event: "weather",
  holiday_timing: "calendar",
  supplier_problem: "supplier",
  shipping_disruption: "logistics",
  cac_inflation: "ad_market",
  platform_algorithm_change: "platform",
  consumer_trend: "consumer",
};

export const ALLOWED_TARGETS_BY_KIND: Readonly<
  Record<ExternalEventKind, readonly ExternalTarget[]>
> = {
  competitor_launch: [
    "demand",
    "purchase_propensity",
    "category_preference",
    "organic_traffic",
  ],
  competitor_sale: [
    "demand",
    "purchase_propensity",
    "price_sensitivity",
    "organic_traffic",
  ],
  economic_slowdown: [
    "demand",
    "purchase_propensity",
    "price_sensitivity",
    "consideration_time",
  ],
  viral_tiktok: [
    "demand",
    "organic_traffic",
    "store_traffic",
    "category_preference",
  ],
  weather_event: [
    "demand",
    "store_traffic",
    "delivery_time",
    "shipping_cost",
    "return_propensity",
  ],
  holiday_timing: [
    "demand",
    "purchase_propensity",
    "consideration_time",
    "organic_traffic",
    "store_traffic",
  ],
  supplier_problem: [
    "supplier_lead_time",
    "inventory_availability",
    "landed_cost",
  ],
  shipping_disruption: [
    "delivery_time",
    "shipping_cost",
    "purchase_propensity",
    "return_propensity",
  ],
  cac_inflation: [
    "cpm",
    "cpc",
    "traffic_quality",
  ],
  platform_algorithm_change: [
    "cpm",
    "cpc",
    "ctr",
    "traffic_quality",
    "reported_attribution",
    "organic_traffic",
  ],
  consumer_trend: [
    "demand",
    "purchase_propensity",
    "category_preference",
    "organic_traffic",
  ],
};

const MIN_COMBINED_MULTIPLIER = 0.05;
const MAX_COMBINED_MULTIPLIER = 20;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function timestamp(value: string): number {
  const result = Date.parse(value);
  if (
    !Number.isFinite(result) ||
    !/Z$|[+-]\d\d:\d\d$/.test(value)
  ) {
    throw new RangeError(
      `invalid external timestamp: ${value}`,
    );
  }
  return result;
}

function validateScopeValues(
  name: string,
  values: readonly string[] | undefined,
): void {
  if (values === undefined) return;
  if (values.length === 0) {
    throw new RangeError(
      `external scope ${name} cannot be empty`,
    );
  }
  const normalized = values.map((value) => value.trim());
  if (normalized.some((value) => value.length === 0)) {
    throw new RangeError(
      `external scope ${name} cannot contain empty values`,
    );
  }
  if (new Set(normalized).size !== normalized.length) {
    throw new RangeError(
      `external scope ${name} cannot contain duplicates`,
    );
  }
}

function validateScope(scope: ExternalScope | undefined): void {
  if (scope === undefined) return;
  validateScopeValues("markets", scope.markets);
  validateScopeValues("categories", scope.categories);
  validateScopeValues("channels", scope.channels);
  validateScopeValues("products", scope.products);
  validateScopeValues("devices", scope.devices);
}

export function validateExternalEnvironment(
  environment: ExternalEnvironment,
): void {
  if (
    environment.version !== EXTERNAL_REALITY_MODEL_VERSION ||
    !environment.environmentId.trim() ||
    !Number.isSafeInteger(environment.seed) ||
    environment.seed < 0
  ) {
    throw new RangeError(
      "invalid external environment identity, version, or seed",
    );
  }

  const ids = new Set<string>();
  for (const event of environment.events) {
    if (!event.id.trim() || ids.has(event.id)) {
      throw new RangeError(
        "external event ids must be unique and nonempty",
      );
    }
    ids.add(event.id);

    if (DOMAIN_BY_KIND[event.kind] !== event.domain) {
      throw new RangeError(
        `external event ${event.id} has domain ${event.domain}, expected ${DOMAIN_BY_KIND[event.kind]} for ${event.kind}`,
      );
    }

    const start = timestamp(event.startsAt);
    const end =
      event.endsAt === undefined
        ? undefined
        : timestamp(event.endsAt);
    if (end !== undefined && end <= start) {
      throw new RangeError(
        "external event end must follow start",
      );
    }

    if (event.effects.length === 0) {
      throw new RangeError(
        `external event ${event.id} must declare at least one known effect`,
      );
    }

    for (const effect of event.effects) {
      if (
        !ALLOWED_TARGETS_BY_KIND[event.kind].includes(
          effect.target,
        )
      ) {
        throw new RangeError(
          `external event ${event.kind} cannot target ${effect.target}`,
        );
      }
      if (
        !Number.isFinite(effect.logMultiplier) ||
        Math.abs(effect.logMultiplier) > Math.log(100)
      ) {
        throw new RangeError(
          "external log multiplier must be finite and within a 100x bound",
        );
      }
      if (
        (effect.delayMs !== undefined &&
          (!Number.isFinite(effect.delayMs) ||
            effect.delayMs < 0)) ||
        (effect.rampMs !== undefined &&
          (!Number.isFinite(effect.rampMs) ||
            effect.rampMs < 0)) ||
        (effect.decayMs !== undefined &&
          (!Number.isFinite(effect.decayMs) ||
            effect.decayMs < 0))
      ) {
        throw new RangeError(
          "external delay, ramp, and decay must be finite non-negative milliseconds",
        );
      }
      validateScope(effect.scope);
    }

    for (const observation of event.observations ?? []) {
      const available = timestamp(observation.availableAt);
      if (
        observation.kind !== "forecast" &&
        available < start
      ) {
        throw new RangeError(
          "only forecast observations may precede the external event",
        );
      }
      if (!observation.signal.trim()) {
        throw new RangeError(
          "external observation signal cannot be empty",
        );
      }
    }
  }
}

function matches(
  scope: ExternalScope | undefined,
  context: ExternalContext,
): boolean {
  return (
    (!scope?.markets ||
      (context.market !== undefined &&
        scope.markets.includes(context.market))) &&
    (!scope?.categories ||
      (context.category !== undefined &&
        scope.categories.includes(context.category))) &&
    (!scope?.channels ||
      (context.channel !== undefined &&
        scope.channels.includes(context.channel))) &&
    (!scope?.products ||
      (context.product !== undefined &&
        scope.products.includes(context.product))) &&
    (!scope?.devices ||
      (context.device !== undefined &&
        scope.devices.includes(context.device)))
  );
}

function temporalWeight(
  event: ExternalEvent,
  effect: ExternalEffect,
  timestampMs: number,
): number {
  const start =
    timestamp(event.startsAt) + (effect.delayMs ?? 0);
  if (timestampMs < start) return 0;

  const end =
    event.endsAt === undefined
      ? Number.POSITIVE_INFINITY
      : timestamp(event.endsAt) +
        (effect.delayMs ?? 0);

  const rampMs = effect.rampMs ?? 0;
  const rampAt = (timeMs: number): number =>
    rampMs <= 0
      ? 1
      : clamp((timeMs - start) / rampMs, 0, 1);

  if (timestampMs < end) {
    return rampAt(timestampMs);
  }

  const decayMs = effect.decayMs ?? 0;
  if (
    !Number.isFinite(end) ||
    decayMs <= 0 ||
    timestampMs >= end + decayMs
  ) {
    return 0;
  }

  const peak = rampAt(end);
  return (
    peak *
    clamp(1 - (timestampMs - end) / decayMs, 0, 1)
  );
}

export function resolveExternalEffect(
  environment: ExternalEnvironment,
  target: ExternalTarget,
  timestampMs: number,
  context: ExternalContext = {},
): ResolvedExternalEffect {
  validateExternalEnvironment(environment);
  if (!Number.isFinite(timestampMs)) {
    throw new RangeError(
      "external effect timestamp must be finite",
    );
  }

  const contributions: ExternalEffectContribution[] = [];
  for (const event of environment.events) {
    for (const effect of event.effects) {
      if (
        effect.target !== target ||
        !matches(effect.scope, context)
      ) {
        continue;
      }

      const weight = temporalWeight(
        event,
        effect,
        timestampMs,
      );
      if (weight <= 0) continue;

      contributions.push({
        eventId: event.id,
        eventKind: event.kind,
        target,
        logMultiplier: effect.logMultiplier,
        temporalWeight: weight,
        appliedLogMultiplier:
          effect.logMultiplier * weight,
      });
    }
  }

  contributions.sort((a, b) =>
    a.eventId === b.eventId
      ? a.appliedLogMultiplier - b.appliedLogMultiplier
      : a.eventId.localeCompare(b.eventId),
  );

  const combinedLog = contributions.reduce(
    (sum, contribution) =>
      sum + contribution.appliedLogMultiplier,
    0,
  );

  return {
    target,
    timestampMs,
    context,
    multiplier: clamp(
      Math.exp(combinedLog),
      MIN_COMBINED_MULTIPLIER,
      MAX_COMBINED_MULTIPLIER,
    ),
    contributions,
  };
}

export function projectExternalObservations(
  environment: ExternalEnvironment,
  timestampMs: number,
): readonly ExternalSignalObservation[] {
  validateExternalEnvironment(environment);
  const observations: ExternalSignalObservation[] = [];

  for (const event of environment.events) {
    for (const observation of event.observations ?? []) {
      if (timestamp(observation.availableAt) > timestampMs) {
        continue;
      }
      observations.push({
        eventId: event.id,
        domain: event.domain,
        eventKind: event.kind,
        observationKind: observation.kind,
        availableAt: observation.availableAt,
        signal: observation.signal,
      });
    }
  }

  return observations.sort((a, b) => {
    const time =
      timestamp(a.availableAt) -
      timestamp(b.availableAt);
    return time !== 0
      ? time
      : a.eventId.localeCompare(b.eventId);
  });
}

export function externalRealityGodModeTruth(
  environment: ExternalEnvironment,
): ExternalRealityGodModeTruth {
  validateExternalEnvironment(environment);
  return {
    modelVersion: EXTERNAL_REALITY_MODEL_VERSION,
    environmentId: environment.environmentId,
    seed: environment.seed,
    events: environment.events,
  };
}

/**
 * Convenience wrapper for simulations that already own a SimulationClock.
 * Effect resolution itself remains timestamp-addressable and deterministic.
 */
export class ExternalRealityRuntime {
  private readonly streams: SharedRandomness;

  public constructor(
    public readonly environment: ExternalEnvironment,
    private readonly clock: SimulationClock,
  ) {
    validateExternalEnvironment(environment);
    this.streams = new SharedRandomness(
      environment.seed,
      `${EXTERNAL_REALITY_MODEL_VERSION}:${environment.environmentId}`,
    );
  }

  public draw(
    domain: ExternalDomain,
    key: string,
  ): number {
    return this.streams.fork(domain).uniform(key);
  }

  public resolve(
    target: ExternalTarget,
    context: ExternalContext = {},
  ): ResolvedExternalEffect {
    return resolveExternalEffect(
      this.environment,
      target,
      this.clock.nowMs,
      context,
    );
  }

  public multiplier(
    target: ExternalTarget,
    context: ExternalContext = {},
  ): number {
    return this.resolve(target, context).multiplier;
  }

  /**
   * The only operator-safe projection in this module. It exposes detected
   * public/merchant signals, never latent effects, future events, or causal
   * strength.
   */
  public observations(): readonly ExternalSignalObservation[] {
    return projectExternalObservations(
      this.environment,
      this.clock.nowMs,
    );
  }
}
