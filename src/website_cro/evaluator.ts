import type { LatentCustomerPopulation } from "../customer_population/types.js";
import { defaultAdvertisingAllocation } from "../advertising_economics/evaluator.js";
import type { Intervention } from "../ground_truth/interventions.js";
import { simulateWorld } from "../simulation/simulator.js";
import type {
  PerfectObservableJourneyEvent,
  SimulationResult,
} from "../simulation/types.js";
import type {
  CroCounterfactualDelta,
  CroCounterfactualResult,
  CroEvaluationRequest,
  CroOpportunityValue,
  FunnelDiagnosticRow,
  FunnelDiagnostics,
  WebsiteScenario,
} from "./types.js";

interface MutableDiagnostic {
  visits: number;
  landingContinuations: number;
  collectionEngagements: number;
  searchAttempts: number;
  searchSuccesses: number;
  pdpViews: number;
  addToCarts: number;
  checkoutStarts: number;
  purchases: number;
}

function emptyDiagnostic(): MutableDiagnostic {
  return {
    visits: 0,
    landingContinuations: 0,
    collectionEngagements: 0,
    searchAttempts: 0,
    searchSuccesses: 0,
    pdpViews: 0,
    addToCarts: 0,
    checkoutStarts: 0,
    purchases: 0,
  };
}

function rate(
  numerator: number,
  denominator: number,
): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

function finalizeDiagnostic(
  dimension: string,
  row: MutableDiagnostic,
): FunnelDiagnosticRow {
  return {
    dimension,
    ...row,
    landingContinuationRate: rate(
      row.landingContinuations,
      row.visits,
    ),
    searchSuccessRate: rate(
      row.searchSuccesses,
      row.searchAttempts,
    ),
    pdpToAtcRate: rate(row.addToCarts, row.pdpViews),
    atcToCheckoutRate: rate(
      row.checkoutStarts,
      row.addToCarts,
    ),
    checkoutToPurchaseRate: rate(
      row.purchases,
      row.checkoutStarts,
    ),
  };
}

function populationWeightMap(
  population: LatentCustomerPopulation,
): ReadonlyMap<string, number> {
  return new Map(
    population.customers.map(
      (customer) =>
        [
          customer.customerId,
          customer.populationWeight,
        ] as const,
    ),
  );
}

interface SessionSummary {
  readonly sessionId: string;
  readonly customerId: string;
  readonly device: string;
  readonly source: string;
  readonly weight: number;
  readonly events: readonly PerfectObservableJourneyEvent[];
  readonly productIds: ReadonlySet<string>;
}

function sessionSummaries(
  result: SimulationResult,
  population: LatentCustomerPopulation,
): readonly SessionSummary[] {
  const weights = populationWeightMap(population);
  const grouped = new Map<
    string,
    PerfectObservableJourneyEvent[]
  >();

  for (const event of result.observableEvents) {
    if (event.sessionId === undefined) continue;
    const events = grouped.get(event.sessionId) ?? [];
    events.push(event);
    grouped.set(event.sessionId, events);
  }

  return [...grouped.entries()]
    .map(([sessionId, rawEvents]) => {
      const events = [...rawEvents].sort(
        (left, right) =>
          Date.parse(left.occurredAt) -
            Date.parse(right.occurredAt) ||
          left.eventId.localeCompare(right.eventId),
      );
      const first = events[0]!;
      return {
        sessionId,
        customerId: first.anonymousSubjectId,
        device: first.device ?? "unknown",
        source: first.source ?? "unknown",
        weight:
          weights.get(first.anonymousSubjectId) ?? 1,
        events,
        productIds: new Set(
          events
            .map((event) => event.productId)
            .filter(
              (productId): productId is string =>
                productId !== undefined,
            ),
        ),
      };
    })
    .sort((left, right) =>
      left.sessionId.localeCompare(right.sessionId),
    );
}

function addSession(
  row: MutableDiagnostic,
  session: SessionSummary,
): void {
  const eventTypes = new Set(
    session.events.map((event) => event.eventType),
  );
  const hasVisit = eventTypes.has("visit");
  const hasContinuation =
    eventTypes.has("collection_view") ||
    eventTypes.has("site_search") ||
    eventTypes.has("product_view");
  const hasSearch = eventTypes.has("site_search");
  const hasSearchSuccess =
    hasSearch &&
    eventTypes.has("product_view") &&
    !(
      eventTypes.has("search_zero_result") &&
      !eventTypes.has("search_reformulation")
    );

  if (hasVisit) row.visits += session.weight;
  if (hasContinuation) {
    row.landingContinuations += session.weight;
  }
  if (eventTypes.has("collection_view")) {
    row.collectionEngagements += session.weight;
  }
  if (hasSearch) row.searchAttempts += session.weight;
  if (hasSearchSuccess) {
    row.searchSuccesses += session.weight;
  }
  if (eventTypes.has("product_view")) {
    row.pdpViews += session.weight;
  }
  if (eventTypes.has("add_to_cart")) {
    row.addToCarts += session.weight;
  }
  if (eventTypes.has("checkout_start")) {
    row.checkoutStarts += session.weight;
  }
  if (eventTypes.has("purchase")) {
    row.purchases += session.weight;
  }
}

function groupedDiagnostics(
  sessions: readonly SessionSummary[],
  selector: (session: SessionSummary) => string,
): readonly FunnelDiagnosticRow[] {
  const rows = new Map<string, MutableDiagnostic>();
  for (const session of sessions) {
    const key = selector(session);
    const row = rows.get(key) ?? emptyDiagnostic();
    addSession(row, session);
    rows.set(key, row);
  }

  return [...rows.entries()]
    .map(([key, row]) => finalizeDiagnostic(key, row))
    .sort((left, right) =>
      left.dimension.localeCompare(right.dimension),
    );
}

function productDiagnostics(
  result: SimulationResult,
  population: LatentCustomerPopulation,
  sessions: readonly SessionSummary[],
): readonly FunnelDiagnosticRow[] {
  const rows = new Map<string, MutableDiagnostic>();

  for (const session of sessions) {
    for (const productId of session.productIds) {
      const row =
        rows.get(productId) ?? emptyDiagnostic();
      row.visits += session.weight;
      if (
        session.events.some(
          (event) =>
            event.productId === productId &&
            event.eventType === "product_view",
        )
      ) {
        row.pdpViews += session.weight;
      }
      if (
        session.events.some(
          (event) =>
            event.productId === productId &&
            event.eventType === "add_to_cart",
        )
      ) {
        row.addToCarts += session.weight;
      }
      if (
        session.events.some(
          (event) =>
            event.eventType === "checkout_start",
        )
      ) {
        row.checkoutStarts += session.weight;
      }
      rows.set(productId, row);
    }
  }

  const weights = populationWeightMap(population);
  for (const purchase of result.purchases) {
    const weight =
      weights.get(purchase.customerId) ?? 1;
    for (const productId of new Set(
      purchase.lines.map((line) => line.productId),
    )) {
      const row =
        rows.get(productId) ?? emptyDiagnostic();
      row.purchases += weight;
      rows.set(productId, row);
    }
  }

  return [...rows.entries()]
    .map(([key, row]) => finalizeDiagnostic(key, row))
    .sort((left, right) =>
      left.dimension.localeCompare(right.dimension),
    );
}

export function funnelDiagnostics(
  result: SimulationResult,
  population: LatentCustomerPopulation,
): FunnelDiagnostics {
  const sessions = sessionSummaries(result, population);
  const overall = emptyDiagnostic();
  for (const session of sessions) {
    addSession(overall, session);
  }

  return {
    overall: finalizeDiagnostic("overall", overall),
    byDevice: groupedDiagnostics(
      sessions,
      (session) => session.device,
    ),
    byChannel: groupedDiagnostics(
      sessions,
      (session) => session.source,
    ),
    byProduct: productDiagnostics(
      result,
      population,
      sessions,
    ),
  };
}

function countWeightedSessionsWith(
  result: SimulationResult,
  population: LatentCustomerPopulation,
  eventType: PerfectObservableJourneyEvent["eventType"],
): number {
  const weights = populationWeightMap(population);
  const sessions = new Map<string, string>();
  for (const event of result.observableEvents) {
    if (
      event.sessionId !== undefined &&
      event.eventType === eventType
    ) {
      sessions.set(
        event.sessionId,
        event.anonymousSubjectId,
      );
    }
  }
  return [...sessions.values()].reduce(
    (sum, customerId) =>
      sum + (weights.get(customerId) ?? 1),
    0,
  );
}

function deltaFor(
  factual: SimulationResult,
  counterfactual: SimulationResult,
  population: LatentCustomerPopulation,
): CroCounterfactualDelta {
  return {
    sessionsProgressing:
      countWeightedSessionsWith(
        counterfactual,
        population,
        "product_view",
      ) -
      countWeightedSessionsWith(
        factual,
        population,
        "product_view",
      ),
    addToCarts:
      countWeightedSessionsWith(
        counterfactual,
        population,
        "add_to_cart",
      ) -
      countWeightedSessionsWith(
        factual,
        population,
        "add_to_cart",
      ),
    checkoutStarts:
      countWeightedSessionsWith(
        counterfactual,
        population,
        "checkout_start",
      ) -
      countWeightedSessionsWith(
        factual,
        population,
        "checkout_start",
      ),
    representedOrders:
      counterfactual.totals.representedOrders -
      factual.totals.representedOrders,
    representedRevenueMinor:
      counterfactual.totals.representedRevenueMinor -
      factual.totals.representedRevenueMinor,
    representedContributionProfitMinor:
      counterfactual.totals
        .representedContributionProfitMinor -
      factual.totals
        .representedContributionProfitMinor,
  };
}

function withWebsiteIntervention(
  scenario: WebsiteScenario,
  intervention: Intervention,
): WebsiteScenario {
  return {
    ...scenario,
    interventions: [
      ...(scenario.interventions ?? []),
      intervention,
    ],
  };
}

export function replayCroIntervention(
  request: CroEvaluationRequest,
): CroCounterfactualResult {
  const common = {
    merchantWorld: request.merchantWorld,
    latentPopulation: request.latentPopulation,
    simulationSeed: request.simulationSeed,
    startTime: request.startTime,
    endTime: request.endTime,
    interventions: request.interventions ?? [],
    ...(request.config === undefined
      ? {}
      : { config: request.config }),
  } as const;

  const factual = simulateWorld({
    ...common,
    commercePolicy: {
      ...(request.commercePolicy ?? {}),
      websiteScenario: request.websiteScenario,
    },
  });
  const counterfactual = simulateWorld({
    ...common,
    commercePolicy: {
      ...(request.commercePolicy ?? {}),
      websiteScenario: withWebsiteIntervention(
        request.websiteScenario,
        request.intervention,
      ),
    },
  });

  return {
    factual,
    counterfactual,
    delta: deltaFor(
      factual,
      counterfactual,
      request.latentPopulation,
    ),
  };
}

export function croOpportunityValue(
  replay: CroCounterfactualResult,
  interventionVariable: string,
): CroOpportunityValue {
  return {
    interventionVariable,
    incrementalContributionProfitMinor:
      replay.delta.representedContributionProfitMinor,
    incrementalRevenueMinor:
      replay.delta.representedRevenueMinor,
    incrementalOrders:
      replay.delta.representedOrders,
  };
}

export interface TrafficVsCroRequest
  extends Omit<CroEvaluationRequest, "intervention"> {
  readonly croIntervention: Intervention;
  readonly trafficIntervention: Intervention;
}

export interface TrafficVsCroResult {
  readonly baseline: SimulationResult;
  readonly cro: SimulationResult;
  readonly traffic: SimulationResult;
  readonly croDelta: CroCounterfactualDelta;
  /**
   * Traffic contribution is net of the incremental paid-media allocation
   * represented by a full-period marketing.<channel>.spend set intervention.
   * This prevents "more traffic" from being credited with revenue while
   * silently ignoring the extra acquisition spend that caused it.
   */
  readonly trafficDelta: CroCounterfactualDelta;
  readonly incrementalTrafficSpendMinor: number;
}

function incrementalTrafficSpendMinor(
  request: TrafficVsCroRequest,
): number {
  const match =
    /^marketing\.([a-z0-9_]+)\.spend$/.exec(
      request.trafficIntervention.variable,
    );
  if (
    match === null ||
    request.trafficIntervention.operation !== "set" ||
    request.trafficIntervention.value.kind !== "number" ||
    request.trafficIntervention.value.unit !== "money_minor"
  ) {
    return 0;
  }
  if (
    request.trafficIntervention.effectiveAt !== undefined ||
    request.trafficIntervention.durationSeconds !== undefined
  ) {
    throw new RangeError(
      "traffic-vs-CRO economic comparison requires a full-period spend intervention",
    );
  }

  const channel = match[1]!;
  const baseline = defaultAdvertisingAllocation(
    request.merchantWorld,
    request.startTime,
    request.endTime,
  ).spendMinorByChannel as Readonly<
    Record<string, number | undefined>
  >;
  const baselineSpend = baseline[channel];
  if (baselineSpend === undefined) {
    throw new RangeError(
      `traffic-vs-CRO spend target references inactive or unsupported channel ${channel}`,
    );
  }
  return (
    Math.max(
      0,
      request.trafficIntervention.value.value,
    ) - baselineSpend
  );
}

export function compareTrafficToCro(
  request: TrafficVsCroRequest,
): TrafficVsCroResult {
  const common = {
    merchantWorld: request.merchantWorld,
    latentPopulation: request.latentPopulation,
    simulationSeed: request.simulationSeed,
    startTime: request.startTime,
    endTime: request.endTime,
    interventions: request.interventions ?? [],
    ...(request.config === undefined
      ? {}
      : { config: request.config }),
  } as const;
  const baselinePolicy = {
    ...(request.commercePolicy ?? {}),
    websiteScenario: request.websiteScenario,
  };

  const baseline = simulateWorld({
    ...common,
    commercePolicy: baselinePolicy,
  });
  const cro = simulateWorld({
    ...common,
    commercePolicy: {
      ...(request.commercePolicy ?? {}),
      websiteScenario: withWebsiteIntervention(
        request.websiteScenario,
        request.croIntervention,
      ),
    },
  });
  const traffic = simulateWorld({
    ...common,
    interventions: [
      ...(request.interventions ?? []),
      request.trafficIntervention,
    ],
    commercePolicy: baselinePolicy,
  });

  const rawTrafficDelta = deltaFor(
    baseline,
    traffic,
    request.latentPopulation,
  );
  const incrementalSpend =
    incrementalTrafficSpendMinor(request);

  return {
    baseline,
    cro,
    traffic,
    croDelta: deltaFor(
      baseline,
      cro,
      request.latentPopulation,
    ),
    trafficDelta: {
      ...rawTrafficDelta,
      representedContributionProfitMinor:
        rawTrafficDelta.representedContributionProfitMinor -
        incrementalSpend,
    },
    incrementalTrafficSpendMinor:
      incrementalSpend,
  };
}
