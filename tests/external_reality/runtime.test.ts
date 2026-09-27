import { describe, expect, it } from "vitest";
import { SimulationClock } from "../../src/simulation/kernel.js";
import {
  ALLOWED_TARGETS_BY_KIND,
  CANONICAL_EXTERNAL_EVENT_KINDS,
  EXTERNAL_REALITY_MODEL_VERSION,
  ExternalRealityRuntime,
  externalEvidenceAt,
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


describe("external reality realized truth and evidence", () => {
  it("records only effects that were actually applied", () => {
    const clock = new SimulationClock({
      startTime: day(1),
      endTime: day(10),
    });
    const runtime = new ExternalRealityRuntime(
      environment,
      clock,
    );

    runtime.applyAt(
      "checkout-1",
      "purchase_propensity",
      Date.parse(day(4)),
      { market: "QC" },
    );
    runtime.applyAt(
      "checkout-2",
      "purchase_propensity",
      Date.parse(day(4)),
      { market: "ON" },
    );

    const truth = runtime.godModeTruth();
    expect(truth.events).toHaveLength(1);
    expect(truth.applications).toHaveLength(1);
    expect(truth.applications[0]?.applicationId).toBe(
      "checkout-1",
    );
    expect(
      truth.applications[0]?.multiplier,
    ).toBeCloseTo(0.8);
  });

  it("maps visible signals to realistic evidence without causal leakage", () => {
    const evidence = externalEvidenceAt(
      environment,
      Date.parse(day(5)),
    );
    expect(evidence).toHaveLength(2);
    expect(evidence[0]?.source).toBe(
      "competitor_monitoring",
    );
    const serialized = JSON.stringify(evidence);
    expect(serialized).not.toContain("logMultiplier");
    expect(serialized).not.toContain("seed");
    expect(serialized).not.toContain("effects");
  });

  it("replays more than three years of daily external resolution exactly", () => {
    const longEnvironment: ExternalEnvironment = {
      version: EXTERNAL_REALITY_MODEL_VERSION,
      environmentId: "three-year-replay",
      seed: 77,
      events: [
        {
          id: "macro",
          domain: "economy",
          kind: "economic_slowdown",
          startsAt: "2026-01-01T00:00:00Z",
          endsAt: "2029-07-01T00:00:00Z",
          effects: [
            {
              target: "demand",
              logMultiplier: Math.log(0.92),
              rampMs: 90 * 86_400_000,
              decayMs: 30 * 86_400_000,
            },
          ],
        },
      ],
    };

    const resolveSeries = () => {
      const values: number[] = [];
      for (let offset = 0; offset < 1_280; offset += 1) {
        values.push(
          resolveExternalEffect(
            longEnvironment,
            "demand",
            Date.parse("2026-01-01T00:00:00Z") +
              offset * 86_400_000,
          ).multiplier,
        );
      }
      return values;
    };

    expect(resolveSeries()).toEqual(resolveSeries());
  });
});
