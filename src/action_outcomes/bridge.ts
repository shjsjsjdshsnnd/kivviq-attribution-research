import { z } from "zod";
import {
  canonicalizeActionOutcomePlan,
  type ActionOutcomePlan,
  type ActionOutcomeMeasurement,
} from "./schema.js";

export const OUTCOME_LEDGER_LEARNING_BRIDGE_VERSION = "1.0.0" as const;

const fingerprintSchema = z.string().regex(/^fnv1a64:[0-9a-f]{16}$/);

export const outcomeBridgeOwnerSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("ACTION"),
      actionId: z.string().regex(/^action_[A-Za-z0-9._:-]+$/),
      actionFingerprint: fingerprintSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("COMPOUND"),
      compoundActionId: z.string().regex(/^compound_[A-Za-z0-9._:-]+$/),
      compoundFingerprint: fingerprintSchema,
    })
    .strict(),
]);

export type OutcomeBridgeOwner = z.infer<typeof outcomeBridgeOwnerSchema>;

export interface DecisionLedgerOutcomeBinding {
  readonly decisionKey: string;
  readonly outcomeKey: string;
  readonly evidencePolicyRef: string;
}

export interface LearningOutcomeBinding {
  readonly signalKey: string;
  readonly outcomeKey: string;
  readonly metricRef: string;
}

export interface OutcomeMeasurementBridgeEntry {
  readonly outcomeId: string;
  readonly metricRef: string;
  readonly role: ActionOutcomeMeasurement["role"];
  readonly measurementScope: ActionOutcomeMeasurement["measurementScope"];
  readonly valueType: ActionOutcomeMeasurement["valueType"];
  readonly comparison: ActionOutcomeMeasurement["comparison"];
  readonly successCriterion: ActionOutcomeMeasurement["successCriterion"];
  readonly measurementWindow: ActionOutcomeMeasurement["measurementWindow"];
  readonly sourceDefinitionRef: ActionOutcomeMeasurement["sourceDefinitionRef"];
  readonly decisionLedger: DecisionLedgerOutcomeBinding;
  readonly learning: LearningOutcomeBinding;
}

export interface OutcomeMeasurementBridge {
  readonly schemaVersion: typeof OUTCOME_LEDGER_LEARNING_BRIDGE_VERSION;
  readonly owner: OutcomeBridgeOwner;
  readonly entries: readonly OutcomeMeasurementBridgeEntry[];
}

function ownerIdentity(owner: OutcomeBridgeOwner): {
  readonly kind: "ACTION" | "COMPOUND";
  readonly id: string;
  readonly fingerprint: string;
} {
  return owner.kind === "ACTION"
    ? {
        kind: "ACTION",
        id: owner.actionId,
        fingerprint: owner.actionFingerprint,
      }
    : {
        kind: "COMPOUND",
        id: owner.compoundActionId,
        fingerprint: owner.compoundFingerprint,
      };
}

/**
 * Creates deterministic join keys for future Decision Ledger and Learning systems.
 *
 * This remains a pure projection of the measurable outcome contract. It does not
 * import either future system, record observed results, score an Action, or add
 * execution semantics.
 */
export function buildOutcomeMeasurementBridge(
  ownerInput: OutcomeBridgeOwner,
  planInput: ActionOutcomePlan,
): OutcomeMeasurementBridge {
  const owner = outcomeBridgeOwnerSchema.parse(ownerInput);
  const plan = canonicalizeActionOutcomePlan(planInput);
  const identity = ownerIdentity(owner);
  const decisionKey =
    `decision:${identity.kind}:${identity.id}:${identity.fingerprint}`;

  return {
    schemaVersion: OUTCOME_LEDGER_LEARNING_BRIDGE_VERSION,
    owner,
    entries: plan.outcomes.map((outcome) => {
      const outcomeKey =
        `outcome:${identity.kind}:${identity.id}:${identity.fingerprint}:${outcome.outcomeId}`;
      return {
        outcomeId: outcome.outcomeId,
        metricRef: outcome.metricRef,
        role: outcome.role,
        measurementScope: outcome.measurementScope,
        valueType: outcome.valueType,
        comparison: outcome.comparison,
        successCriterion: outcome.successCriterion,
        measurementWindow: outcome.measurementWindow,
        sourceDefinitionRef: outcome.sourceDefinitionRef,
        decisionLedger: {
          decisionKey,
          outcomeKey,
          evidencePolicyRef: outcome.evidencePolicyRef,
        },
        learning: {
          signalKey:
            `learning:${identity.kind}:${identity.id}:${identity.fingerprint}:${outcome.outcomeId}:${outcome.metricRef}`,
          outcomeKey,
          metricRef: outcome.metricRef,
        },
      };
    }),
  };
}
