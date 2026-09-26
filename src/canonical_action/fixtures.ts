import { utcTimestamp } from "../core/units.js";
import type { ActionTiming, TimingValue } from "../action_timing/types.js";
import {
  immediatePersistentBudgetTiming,
  fridayTenAmTiming,
  weeklyEightWeekLifecycleTiming,
  recurringAcrossDstTiming,
  postPurchaseCareTiming,
  postPurchaseFourteenDaysTiming,
  productReplenishmentTiming,
} from "../action_timing/fixtures.js";
import {
  createPopulationFixtures,
  fingerprintPopulationDefinition,
  evaluatePopulation,
  createPopulationSnapshot,
  type PopulationDefinition,
} from "../population/index.js";
import { canonicalActionSchema, type CanonicalAction } from "./schema.js";
import type {
  LifecycleWhat,
  LifecycleFlowConfiguration,
} from "../lifecycle/canonical.js";

const specified = <T>(value: T): TimingValue<T> => ({
  state: "SPECIFIED",
  value,
});
const absent = { state: "ABSENT" } as const;
export interface CanonicalFixture {
  readonly number: number;
  readonly label: string;
  readonly action?: CanonicalAction;
  readonly populationFixture?: ReturnType<
    typeof createPopulationFixtures
  >[number];
  readonly snapshot?: ReturnType<typeof createPopulationSnapshot>;
  readonly beforeCadence?: {
    count: number;
    period: { amount: number; unit: "WEEK" };
  };
  readonly translationContext?: unknown;
}
export function createCanonicalFixtures(): CanonicalFixture[] {
  const instant: ActionTiming = {
    ...immediatePersistentBudgetTiming,
    duration: specified({ kind: "INSTANTANEOUS" }),
    end: absent,
    recurrence: absent,
  };
  const population: PopulationDefinition = {
    schemaVersion: 1,
    populationId: "population_a",
    version: 1,
    universe: "ALL_CUSTOMERS",
    inclusion: {
      kind: "AND",
      operands: [
        { kind: "COMPLETED_ORDER_COUNT", operator: "GTE", value: 1 },
        { kind: "DAYS_SINCE_LAST_COMPLETED_ORDER", operator: "GTE", value: 90 },
        { kind: "CONSENT", channel: "EMAIL", eligible: true },
      ],
    },
    exclusions: [],
    binding: "SEND_TIME",
    membershipMode: "DYNAMIC_MEMBERSHIP",
    provenance: ["evidence_fixture"],
  };
  const reference = (definition: PopulationDefinition) => ({
    populationId: definition.populationId,
    version: definition.version,
    definitionFingerprint: fingerprintPopulationDefinition(definition),
    binding: definition.binding,
    membershipMode: definition.membershipMode,
  });
  const action = (
    n: number,
    what: LifecycleWhat,
    timing = instant,
    definition = population,
  ) =>
    canonicalActionSchema.parse({
      schemaVersion: "2.0.0",
      actionId: "action_fixture_" + n,
      what,
      population: reference(definition),
      timing,
      provenance: ["evidence_fixture"],
    });
  const send = (
    purpose:
      | "GENERAL_CAMPAIGN"
      | "WINBACK"
      | "POST_PURCHASE"
      | "REPLENISHMENT"
      | "RETENTION",
    contentRef?: string,
  ): LifecycleWhat => ({
    actionType: "lifecycle.send",
    channel: "EMAIL",
    purpose,
    ...(contentRef ? { contentRef } : {}),
  });
  const dynamic = { ...population, binding: "TRIGGER_TIME" as const };
  const flow = (
    count: number,
    purpose: "WINBACK" | "RETENTION" = "WINBACK",
  ): LifecycleFlowConfiguration => ({
    flowId: "lifecycleflow_fixture",
    purpose,
    trigger: { kind: "DAYS_SINCE_LAST_COMPLETED_PURCHASE", days: 90 },
    steps: Array.from({ length: count }, (_, i) => ({
      stepId: "step_" + (i + 1),
      order: i + 1,
      channel: i === 2 ? "SMS" : "EMAIL",
      timing: {
        ...instant,
        requestedStart: specified({
          kind: "EVENT_RELATIVE",
          relation: "AFTER_EVENT",
          eventId: "FLOW_TRIGGER",
          offset: { kind: "CALENDAR", amount: i * 7, unit: "DAY" },
        }),
      },
      population: reference(dynamic),
      eligibility: ["consent", "valid_destination"],
      suppression: ["channel_suppressed", "contact_cap_reached"],
      exitConditions: ["COMPLETED_PURCHASE"],
    })),
  });
  const sms: PopulationDefinition = {
    ...population,
    populationId: "population_b",
    inclusion: { kind: "CONSENT", channel: "SMS", eligible: true },
  };
  const oneBuyer: PopulationDefinition = {
    ...dynamic,
    populationId: "population_one_buyer",
    inclusion: { kind: "COMPLETED_ORDER_COUNT", operator: "EQ", value: 1 },
  };
  const buyer: PopulationDefinition = {
    ...population,
    populationId: "population_purchasers",
    inclusion: { kind: "COMPLETED_ORDER_COUNT", operator: "GTE", value: 1 },
  };
  const productBuyer: PopulationDefinition = {
    ...buyer,
    populationId: "population_product_a",
    inclusion: {
      kind: "PURCHASED_PRODUCT",
      productId: "product_a",
      window: { kind: "LIFETIME" },
    },
  };
  const retentionFlow = {
    ...flow(2, "RETENTION"),
    trigger: { kind: "POPULATION_ENTRY" as const },
    steps: flow(2, "RETENTION").steps.map((s) => ({
      ...s,
      population: reference(oneBuyer),
    })),
  };
  const fixtures: CanonicalFixture[] = [
    {
      number: 1,
      label: "Email Population A Friday at 10:00 Toronto",
      action: action(1, send("WINBACK"), fridayTenAmTiming),
    },
    {
      number: 2,
      label: "SMS Population B",
      action: action(
        2,
        {
          actionType: "lifecycle.send",
          channel: "SMS",
          purpose: "GENERAL_CAMPAIGN",
        },
        instant,
        sms,
      ),
    },
    {
      number: 3,
      label: "Email cadence 2/week to 3/week",
      beforeCadence: { count: 2, period: { amount: 1, unit: "WEEK" } },
      action: action(
        3,
        {
          actionType: "lifecycle.adjust_frequency",
          channel: "EMAIL",
          operation: {
            kind: "SET",
            count: 3,
            period: { amount: 1, unit: "WEEK" },
          },
        },
        immediatePersistentBudgetTiming,
      ),
    },
    {
      number: 4,
      label: "Maximum 3 marketing emails/customer/7 days",
      action: action(
        4,
        {
          actionType: "lifecycle.adjust_contact_policy",
          policyId: "lifecyclepolicy_email",
          policy: {
            kind: "CONTACT_CAP",
            channels: ["EMAIL"],
            purpose: "MARKETING",
            maximum: 3,
            period: { amount: 7, unit: "DAY" },
          },
        },
        immediatePersistentBudgetTiming,
      ),
    },
    {
      number: 5,
      label: "Maximum 4 EMAIL plus SMS contacts/7 days",
      action: action(
        5,
        {
          actionType: "lifecycle.adjust_contact_policy",
          policyId: "lifecyclepolicy_all",
          policy: {
            kind: "CONTACT_CAP",
            channels: ["EMAIL", "SMS"],
            purpose: "PROMOTIONAL",
            maximum: 4,
            period: { amount: 7, unit: "DAY" },
          },
        },
        immediatePersistentBudgetTiming,
      ),
    },
    {
      number: 6,
      label: "90-day winback flow",
      action: action(
        6,
        { actionType: "lifecycle.start_flow", flow: flow(1) },
        immediatePersistentBudgetTiming,
        dynamic,
      ),
    },
    {
      number: 7,
      label: "Three-step EMAIL EMAIL SMS winback flow",
      action: action(
        7,
        { actionType: "lifecycle.start_flow", flow: flow(3) },
        immediatePersistentBudgetTiming,
        dynamic,
      ),
    },
    {
      number: 8,
      label: "Care email 2 days after fulfillment",
      action: action(
        8,
        send("POST_PURCHASE", "content_care"),
        postPurchaseCareTiming,
        buyer,
      ),
    },
    {
      number: 9,
      label: "Review request 14 days after delivery",
      action: action(
        9,
        send("POST_PURCHASE", "content_review"),
        postPurchaseFourteenDaysTiming,
        buyer,
      ),
    },
    {
      number: 10,
      label: "Replenishment reminder 60 days after Product A purchase",
      action: action(
        10,
        send("REPLENISHMENT", "content_replenishment"),
        productReplenishmentTiming,
        productBuyer,
      ),
    },
    {
      number: 11,
      label: "Retention education flow for one-time buyers",
      action: action(
        11,
        { actionType: "lifecycle.start_flow", flow: retentionFlow },
        immediatePersistentBudgetTiming,
        oneBuyer,
      ),
    },
  ];
  const labels = [
    "Exactly one completed order",
    "At least two orders and trailing-365-day revenue >= 500 CAD",
    "Product A purchase trailing 90 days",
    "Observed cart abandoner",
    "Exclude recent purchasers",
    "Missing SMS consent is UNKNOWN",
    "Frozen membership at DECISION_TIME",
    "Dynamic membership at TRIGGER_TIME",
    "Same definition evaluated at two times",
  ];
  createPopulationFixtures().forEach((f, i) =>
    fixtures.push({
      number: f.fixtureNumber,
      label: labels[i]!,
      populationFixture: f,
      ...(f.fixtureNumber === 18
        ? {
            snapshot: createPopulationSnapshot(f.definition, f.evaluation, {
              snapshotId: "snapshot_frozen",
            }),
          }
        : {}),
    }),
  );
  const future: ActionTiming = {
    ...instant,
    requestedStart: specified({
      kind: "ABSOLUTE",
      time: {
        kind: "LOCAL",
        at: {
          localDateTime: "2026-10-01T00:00:00",
          timeZone: "America/Toronto",
        },
      },
    }),
  };
  const bounded: ActionTiming = {
    ...immediatePersistentBudgetTiming,
    duration: specified({
      kind: "CALENDAR",
      amount: 7,
      unit: "DAY",
      anchor: "EFFECTIVE_START",
    }),
    end: specified({ kind: "DERIVE_FROM_DURATION" }),
  };
  const timingCases: [string, ActionTiming][] = [
    ["Immediate Action", instant],
    ["Future effective Action", future],
    [
      "Two-hour implementation delay",
      {
        ...future,
        implementationDelay: specified({
          kind: "ELAPSED",
          amount: 2,
          unit: "HOUR",
        }),
      },
    ],
    ["Event-relative Action", postPurchaseFourteenDaysTiming],
    ["Persistent policy", immediatePersistentBudgetTiming],
    ["Time-bounded policy", bounded],
    ["Eight Tuesday occurrences", weeklyEightWeekLifecycleTiming],
    ["Recurrence crossing DST", recurringAcrossDstTiming],
    ["Unresolved future ORDER_DELIVERED", postPurchaseFourteenDaysTiming],
  ];
  timingCases.forEach(([label, timing], i) =>
    fixtures.push({
      number: 21 + i,
      label,
      action: action(
        21 + i,
        i === 4 || i === 5
          ? {
              actionType: "lifecycle.adjust_frequency",
              channel: "EMAIL",
              operation: {
                kind: "SET",
                count: 3,
                period: { amount: 1, unit: "WEEK" },
              },
            }
          : send("GENERAL_CAMPAIGN"),
        timing,
      ),
      translationContext: {
        timing: { approvedClock: utcTimestamp("2026-09-26T12:00:00Z") },
      },
    }),
  );
  const evaluatedAt = "2026-09-26T12:00:00Z";
  fixtures.push({
    number: 30,
    label: "Unsupported simulator translation",
    action: action(30, send("WINBACK")),
    translationContext: {
      timing: { approvedClock: utcTimestamp(evaluatedAt) },
      populations: [population],
      evaluations: [
        evaluatePopulation(population, {
          evaluatedAt,
          customers: [
            {
              customerId: "customer_a",
              completedOrderCount: 1,
              lastCompletedOrderAt: "2026-01-01T00:00:00Z",
              emailEligible: true,
            },
          ],
        }),
      ],
      bindingTimes: { SEND_TIME: evaluatedAt },
    },
  });
  return fixtures;
}
