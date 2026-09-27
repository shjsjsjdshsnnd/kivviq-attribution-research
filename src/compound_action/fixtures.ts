import { adaptLegacyAction } from "../canonical_action/legacy.js";
import { createCanonicalFixtures } from "../canonical_action/fixtures.js";
import type { CanonicalAction } from "../canonical_action/schema.js";
import {
  metaToGoogle2000PerWeek,
  increaseGoogleShoppingBudget20,
  decreaseMetaProspectingBudget500PerDay,
} from "../paid_media/fixtures.js";
import { startAutomaticCollectionX15FourDays } from "../promotion/fixtures.js";
import {
  featureCollectionXHomepageSlot1,
  deprioritizeProductBCollectionY,
} from "../merchandising/fixtures.js";
import { protectSkuAAt20, clearanceSkuA } from "../inventory/fixtures.js";
import {
  temporarySkuA799SevenDays,
  rollbackTemporarySkuAToPreActionPrice,
} from "../pricing/fixtures.js";
import { currencyCode, utcTimestamp } from "../core/units.js";
import { compoundActionSchema, type CompoundAction } from "./schema.js";
import type { CompoundReadinessContext } from "./readiness.js";
import type { CompoundRollbackContext } from "./rollback.js";
export interface CompoundFixture {
  number: number;
  label: string;
  action: CompoundAction;
  valid: boolean;
  readinessContext?: CompoundReadinessContext;
  rollbackContext?: CompoundRollbackContext;
}
export function createCompoundFixtures(): CompoundFixture[] {
  const send = createCanonicalFixtures().find(
    (f) => f.action?.what.actionType === "lifecycle.send",
  )!.action!;
  const promotion = adaptLegacyAction(startAutomaticCollectionX15FourDays),
    paid = adaptLegacyAction(increaseGoogleShoppingBudget20),
    feature = adaptLegacyAction(featureCollectionXHomepageSlot1),
    price = adaptLegacyAction(temporarySkuA799SevenDays);
  const make = (n: number, actions: CanonicalAction[]): CompoundAction => ({
    schemaVersion: 1,
    kind: "compound_action",
    compoundActionId: "compound_fixture_" + n,
    components: actions.map((action, i) => ({
      componentId: "component_" + i,
      role: "ROLE_" + i,
      action,
    })),
    ordering: "UNORDERED",
    concurrency: "INDEPENDENT_TIMING",
    dependencies: [],
    atomicity: "BEST_EFFORT",
    failurePolicy: "STOP_REMAINING",
    rollbackPolicy: "ROLLBACK_ALL_REVERSIBLE_COMPONENTS",
    constraints: [],
    populationRelationships: [],
    measurementHorizon: { amount: 14, unit: "DAY" },
    provenance: ["evidence_compound_fixture"],
  });
  const one = make(
    1,
    metaToGoogle2000PerWeek.components.map((c) => adaptLegacyAction(c)),
  );
  one.atomicity = "ALL_OR_NOTHING";
  one.constraints = [
    {
      constraintId: "budget_neutral",
      kind: "BUDGET_NEUTRAL",
      componentIds: one.components.map((c) => c.componentId),
      currency: "CAD",
    },
  ];
  const six = make(6, [promotion, send]);
  six.ordering = "ORDERED";
  six.dependencies = [
    {
      componentId: "component_1",
      dependsOn: "component_0",
      kind: "START_AFTER",
    },
  ];
  six.components[1]!.action = {
    ...send,
    timing: {
      ...send.timing,
      requestedStart: {
        state: "SPECIFIED",
        value: {
          kind: "ACTION_RELATIVE",
          relation: "START_AFTER_ACTION_EFFECTIVE",
          actionId: promotion.actionId,
        },
      },
      effectiveStart: {
        state: "SPECIFIED",
        value: { kind: "DERIVE_FROM_REQUESTED_START" },
      },
    },
  };
  const seven = make(7, [
    send,
    {
      ...send,
      actionId: "action_second_population",
      population: { ...send.population!, populationId: "population_other" },
    },
  ]);
  seven.populationRelationships = [
    { kind: "DIFFERENT", componentIds: ["component_0", "component_1"] },
  ];
  const eight = make(8, [paid, feature]),
    nine = make(9, [paid, feature]);
  nine.atomicity = "ALL_OR_NOTHING";
  const ten = make(10, [price, send]),
    eleven = make(11, [price, send]);
  const rollback = (conflict: boolean): CompoundRollbackContext => ({
    components: {
      component_0: {
        actionId: price.actionId,
        executionState: "COMPLETED",
        domain: {
          kind: "PRICING",
          rollbackAction: rollbackTemporarySkuAToPreActionPrice,
          context: {
            currentPrice: {
              kind: "money",
              currency: currencyCode("CAD"),
              amountMinor: conflict ? 500 : 79900,
            },
          },
        },
      },
      component_1: {
        actionId: send.actionId,
        executionState: "COMPLETED",
        delivery: "SENT",
      },
    },
  });
  const twelve = make(12, [paid, feature]);
  twelve.dependencies = [
    {
      componentId: "component_0",
      dependsOn: "component_1",
      kind: "START_AFTER",
    },
    {
      componentId: "component_1",
      dependsOn: "component_0",
      kind: "START_AFTER",
    },
  ];
  const unsupported: CompoundReadinessContext = {
    timing: { approvedClock: utcTimestamp("2026-09-27T00:00:00Z") },
    components: {
      component_0: { status: "READY", evidenceRefs: ["paid_media_supported"] },
      component_1: {
        status: "UNSUPPORTED_SIMULATOR_CAPABILITY",
        evidenceRefs: ["merchandising_unsupported"],
      },
    },
  };
  const fixtures: CompoundFixture[] = [
    {
      number: 1,
      label: "Meta -$2,000/week and Google +$2,000/week",
      action: one,
      valid: true,
    },
    {
      number: 2,
      label: "15% promotion, email, Google Shopping +20%",
      action: make(2, [promotion, send, paid]),
      valid: true,
    },
    {
      number: 3,
      label: "Promotion, email, paid media, homepage feature",
      action: make(3, [promotion, send, paid, feature]),
      valid: true,
    },
    {
      number: 4,
      label:
        "Inventory protection, paid-media reduction, merchandising deprioritization",
      action: make(4, [
        adaptLegacyAction(protectSkuAAt20),
        adaptLegacyAction(decreaseMetaProspectingBudget500PerDay),
        adaptLegacyAction(deprioritizeProductBCollectionY),
      ]),
      valid: true,
    },
    {
      number: 5,
      label:
        "Clearance, price reduction, merchandising feature, paid-media increase",
      action: make(5, [adaptLegacyAction(clearanceSkuA), price, feature, paid]),
      valid: true,
    },
    {
      number: 6,
      label: "Promotion effective before email",
      action: six,
      valid: true,
    },
    {
      number: 7,
      label: "Different component populations",
      action: seven,
      valid: true,
    },
    {
      number: 8,
      label: "One unsupported component",
      action: eight,
      valid: true,
      readinessContext: unsupported,
    },
    {
      number: 9,
      label: "All-or-nothing blocked by unsupported component",
      action: nine,
      valid: true,
      readinessContext: unsupported,
    },
    {
      number: 10,
      label: "Reversible pricing and irreversible sent email",
      action: ten,
      valid: true,
      rollbackContext: rollback(false),
    },
    {
      number: 11,
      label: "Rollback conflict",
      action: eleven,
      valid: true,
      rollbackContext: rollback(true),
    },
    {
      number: 12,
      label: "Invalid circular dependency",
      action: twelve,
      valid: false,
    },
  ];
  for (const fixture of fixtures)
    if (fixture.valid) compoundActionSchema.parse(fixture.action);
  return fixtures;
}
