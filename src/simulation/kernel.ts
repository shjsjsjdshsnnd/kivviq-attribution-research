export const WORLD_SIMULATOR_VERSION = "customer-journey-simulator-4.0.0" as const;

export type SimulationEventKind =
  | "need_formation"
  | "channel_opportunity"
  | "marketing_exposure"
  | "latent_effect"
  | "interaction_effect"
  | "search"
  | "visit"
  | "session_step"
  | "return_visit"
  | "repeat_need"
  | "lifecycle_check"
  | "inventory_replenishment"
  | "inventory_reservation_expired"
  | "inventory_reorder_check"
  | "inventory_return_received"
  | "inventory_return_restocked"
  | "inventory_backorder_cancelled"
  | "supplier_shipment_dispatched"
  | "supplier_shipment_delayed"
  | "shock_start"
  | "shock_end";

export interface SimulationEvent<T = unknown> {
  readonly id: string;
  readonly kind: SimulationEventKind;
  readonly timestampMs: number;
  readonly priority: number;
  readonly sequence: number;
  readonly customerId?: string;
  readonly payload: T;
}

export interface SimulationTimeRange {
  readonly startTime: string;
  readonly endTime: string;
}

export class SimulationKernelError extends Error {}

function fnv1a32(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function uniformFromHash(hash: number): number {
  let t = hash + 0x6d2b79f5;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * Counter-based randomness. A draw is a pure function of:
 * simulation seed + stable draw key.
 *
 * Factual/counterfactual worlds using the same simulation seed and semantic
 * draw keys therefore share stochastic structure even when event paths diverge.
 */
export class SharedRandomness {
  public constructor(
    private readonly simulationSeed: number,
    private readonly namespace = "world",
  ) {
    if (!Number.isSafeInteger(simulationSeed) || simulationSeed < 0) {
      throw new SimulationKernelError(
        "simulation seed must be a non-negative safe integer",
      );
    }
  }

  public fork(namespace: string): SharedRandomness {
    return new SharedRandomness(
      this.simulationSeed,
      `${this.namespace}/${namespace}`,
    );
  }

  public uniform(key: string): number {
    return uniformFromHash(
      fnv1a32(`${this.simulationSeed}|${this.namespace}|${key}`),
    );
  }

  public bool(key: string, probability: number): boolean {
    if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
      throw new SimulationKernelError(
        `probability must be within [0,1], received ${probability}`,
      );
    }
    return this.uniform(key) < probability;
  }

  public normal(key: string, mean = 0, std = 1): number {
    const u1 = Math.max(Number.EPSILON, this.uniform(`${key}:u1`));
    const u2 = Math.max(Number.EPSILON, this.uniform(`${key}:u2`));
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return mean + std * z;
  }

  public exponential(key: string, ratePerMs: number): number {
    if (!Number.isFinite(ratePerMs) || ratePerMs <= 0) {
      return Number.POSITIVE_INFINITY;
    }
    const u = Math.max(Number.EPSILON, 1 - this.uniform(key));
    return -Math.log(u) / ratePerMs;
  }

  public integer(key: string, min: number, maxInclusive: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(maxInclusive) || maxInclusive < min) {
      throw new SimulationKernelError("invalid integer draw bounds");
    }
    return min + Math.floor(this.uniform(key) * (maxInclusive - min + 1));
  }

  public pick<T>(key: string, values: readonly T[]): T {
    if (values.length === 0) {
      throw new SimulationKernelError("cannot pick from an empty collection");
    }
    return values[
      Math.min(
        values.length - 1,
        Math.floor(this.uniform(key) * values.length),
      )
    ]!;
  }

  public weightedPick<T>(
    key: string,
    values: readonly { readonly value: T; readonly weight: number }[],
  ): T {
    const valid = values.filter(
      (entry) => Number.isFinite(entry.weight) && entry.weight > 0,
    );
    if (valid.length === 0) {
      throw new SimulationKernelError(
        "weighted pick requires a positive finite weight",
      );
    }
    const total = valid.reduce((sum, entry) => sum + entry.weight, 0);
    let cursor = this.uniform(key) * total;
    for (const entry of valid) {
      cursor -= entry.weight;
      if (cursor <= 0) return entry.value;
    }
    return valid[valid.length - 1]!.value;
  }
}

function compareEvents(
  left: SimulationEvent,
  right: SimulationEvent,
): number {
  return (
    left.timestampMs - right.timestampMs ||
    left.priority - right.priority ||
    left.sequence - right.sequence ||
    left.id.localeCompare(right.id)
  );
}

export class SimulationEventQueue {
  private readonly heap: SimulationEvent[] = [];
  private nextSequence = 0;

  public get size(): number {
    return this.heap.length;
  }

  public schedule<T>(
    event: Omit<SimulationEvent<T>, "sequence">,
  ): SimulationEvent<T> {
    if (!Number.isFinite(event.timestampMs)) {
      throw new SimulationKernelError("event timestamp must be finite");
    }
    const full: SimulationEvent<T> = {
      ...event,
      sequence: this.nextSequence++,
    };
    this.heap.push(full as SimulationEvent);
    this.bubbleUp(this.heap.length - 1);
    return full;
  }

  public pop(): SimulationEvent | undefined {
    if (this.heap.length === 0) return undefined;
    const first = this.heap[0]!;
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.bubbleDown(0);
    }
    return first;
  }

  private bubbleUp(index: number): void {
    let current = index;
    while (current > 0) {
      const parent = Math.floor((current - 1) / 2);
      if (compareEvents(this.heap[parent]!, this.heap[current]!) <= 0) break;
      [this.heap[parent], this.heap[current]] = [
        this.heap[current]!,
        this.heap[parent]!,
      ];
      current = parent;
    }
  }

  private bubbleDown(index: number): void {
    let current = index;
    for (;;) {
      const left = current * 2 + 1;
      const right = left + 1;
      let smallest = current;

      if (
        left < this.heap.length &&
        compareEvents(this.heap[left]!, this.heap[smallest]!) < 0
      ) {
        smallest = left;
      }
      if (
        right < this.heap.length &&
        compareEvents(this.heap[right]!, this.heap[smallest]!) < 0
      ) {
        smallest = right;
      }
      if (smallest === current) return;

      [this.heap[current], this.heap[smallest]] = [
        this.heap[smallest]!,
        this.heap[current]!,
      ];
      current = smallest;
    }
  }
}

export class SimulationClock {
  public readonly startMs: number;
  public readonly endMs: number;
  private currentMs: number;

  public constructor(range: SimulationTimeRange) {
    this.startMs = Date.parse(range.startTime);
    this.endMs = Date.parse(range.endTime);
    if (
      !Number.isFinite(this.startMs) ||
      !Number.isFinite(this.endMs) ||
      this.endMs <= this.startMs
    ) {
      throw new SimulationKernelError(
        "simulation range must contain valid increasing timestamps",
      );
    }
    this.currentMs = this.startMs;
  }

  public get nowMs(): number {
    return this.currentMs;
  }

  public get nowIso(): string {
    return new Date(this.currentMs).toISOString();
  }

  public get durationMs(): number {
    return this.endMs - this.startMs;
  }

  public advanceTo(timestampMs: number): void {
    if (timestampMs < this.currentMs) {
      throw new SimulationKernelError("simulation clock cannot move backward");
    }
    if (timestampMs > this.endMs) {
      throw new SimulationKernelError("simulation clock cannot exceed end time");
    }
    this.currentMs = timestampMs;
  }

  public contains(timestampMs: number): boolean {
    return timestampMs >= this.startMs && timestampMs <= this.endMs;
  }
}

export function hours(value: number): number {
  return value * 60 * 60 * 1_000;
}

export function days(value: number): number {
  return hours(value * 24);
}
