import { describe, expect, it } from "vitest";
import { SimulationClock } from "../../src/simulation/kernel.js";
import {
  ALLOWED_TARGETS_BY_KIND,
  CANONICAL_EXTERNAL_EVENT_KINDS,
  EXTERNAL_REALITY_MODEL_VERSION,
  ExternalRealityRuntime,
  projectExternalObservations,
  resolveExternalEffect,
  validateExternalEnvironment,
  type ExternalEnvironment,
} from "../../src/external_reality/index.js";

const day = (n: number) =>
  `2026-01-${String(n).padStart(2, "0")}T00:00:00Z`;

const environment: ExternalEnvironment = {
  version: EXTERNAL_REALITY_MODEL_VERSION,
  environmentId: "step14-test",
  seed: 42,
  events: [
    {
      id: "competitor-sale",
      domain: "competition",
      kind: "competitor_sale",
      startsAt: day(3),
      endsAt: day(6),
      effects: [
        {
          target: "purchase_propensity",
          logMultiplier: Math.log(0.8),
          scope: { markets: ["QC"] },
        },
      ],
      observations: [
        {
          kind: "forecast",
          availableAt: day(2),
          signal: "competitor sale announced",
        },
        {
          kind: "lagged_report",
          availableAt: day(5),
          signal: "competitor discount confirmed",
        },
      ],
    },
  ],
};

describe("external reality contracts", () => {
  it("has a typed known-effect contract for every requested event kind", () => {
    expect(CANONICAL_EXTERNAL_EVENT_KINDS).toHaveLength(11);
    for (const kind of CANONICAL_EXTERNAL_EVENT_KINDS) {
      expect(ALLOWED_TARGETS_BY_KIND[kind].length).toBeGreaterThan(0);
    }
  });

  it("keeps effects scoped to interval and market", () => {
    validateExternalEnvironment(environment);
    expect(
      resolveExternalEffect(
        environment,
        "purchase_propensity",
        Date.parse(day(2)),
        { market: "QC" },
      ).multiplier,
    ).toBe(1);

    expect(
      resolveExternalEffect(
        environment,
        "purchase_propensity",
        Date.parse(day(4)),
        { market: "QC" },
      ).multiplier,
    ).toBeCloseTo(0.8);

    expect(
      resolveExternalEffect(
        environment,
        "purchase_propensity",
        Date.parse(day(4)),
        { market: "ON" },
      ).multiplier,
    ).toBe(1);

    expect(
      resolveExternalEffect(
        environment,
        "purchase_propensity",
        Date.parse(day(6)),
        { market: "QC" },
      ).multiplier,
    ).toBe(1);
  });

  it("supports forecasts without revealing effect settings", () => {
    const projected = projectExternalObservations(
      environment,
      Date.parse(day(2)),
    );
    expect(projected).toEqual([
      {
        eventId: "competitor-sale",
        domain: "competition",
        eventKind: "competitor_sale",
        observationKind: "forecast",
        availableAt: day(2),
        signal: "competitor sale announced",
      },
    ]);
    expect(JSON.stringify(projected)).not.toContain(
      "logMultiplier",
    );
  });

  it("composes simultaneous effects deterministically in log space", () => {
    const combined: ExternalEnvironment = {
      version: EXTERNAL_REALITY_MODEL_VERSION,
      environmentId: "combined",
      seed: 8,
      events: [
        {
          id: "economy",
          domain: "economy",
          kind: "economic_slowdown",
          startsAt: day(1),
          endsAt: day(5),
          effects: [
            {
              target: "demand",
              logMultiplier: Math.log(0.8),
            },
          ],
        },
        {
          id: "holiday",
          domain: "calendar",
          kind: "holiday_timing",
          startsAt: day(1),
          endsAt: day(5),
          effects: [
            {
              target: "demand",
              logMultiplier: Math.log(1.25),
            },
          ],
        },
      ],
    };

    expect(
      resolveExternalEffect(
        combined,
        "demand",
        Date.parse(day(3)),
      ).multiplier,
    ).toBeCloseTo(1);
  });

  it("applies ramp and decay without discontinuous causal jumps", () => {
    const ramped: ExternalEnvironment = {
      version: EXTERNAL_REALITY_MODEL_VERSION,
      environmentId: "ramped",
      seed: 9,
      events: [
        {
          id: "trend",
          domain: "consumer",
          kind: "consumer_trend",
          startsAt: day(1),
          endsAt: day(5),
          effects: [
            {
              target: "demand",
              logMultiplier: Math.log(2),
              rampMs: 2 * 86_400_000,
              decayMs: 2 * 86_400_000,
            },
          ],
        },
      ],
    };

    expect(
      resolveExternalEffect(
        ramped,
        "demand",
        Date.parse(day(2)),
      ).multiplier,
    ).toBeCloseTo(Math.sqrt(2));

    expect(
      resolveExternalEffect(
        ramped,
        "demand",
        Date.parse(day(6)),
      ).multiplier,
    ).toBeCloseTo(Math.sqrt(2));
  });

  it("replays domain streams identically without cross-domain draw coupling", () => {
    const clock = new SimulationClock({
      startTime: day(1),
      endTime: day(10),
    });
    const a = new ExternalRealityRuntime(
      environment,
      clock,
    );
    const b = new ExternalRealityRuntime(
      environment,
      clock,
    );
    const value = a.draw("competition", "launch-1");
    a.draw("weather", "storm-1");
    expect(
      a.draw("competition", "launch-1"),
    ).toBe(value);
    expect(
      b.draw("competition", "launch-1"),
    ).toBe(value);
  });

  it("rejects domain mismatches and implausible targets", () => {
    expect(() =>
      validateExternalEnvironment({
        version: EXTERNAL_REALITY_MODEL_VERSION,
        environmentId: "bad",
        seed: 1,
        events: [
          {
            id: "bad-event",
            domain: "weather",
            kind: "cac_inflation",
            startsAt: day(1),
            effects: [
              {
                target: "supplier_lead_time",
                logMultiplier: Math.log(2),
              },
            ],
          },
        ],
      }),
    ).toThrow();
  });
});
