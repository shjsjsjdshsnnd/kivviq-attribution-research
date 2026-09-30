import { actionOutcomeContractsSchema, type ActionOutcomeContracts } from "./schema.js";

export const OUTCOME_MEASUREMENT_PLAN_VERSION = "1.0.0" as const;

export interface OutcomeMeasurementPlanEntry {
  readonly outcomeId: string;
  readonly role: "PRIMARY" | "SECONDARY" | "GUARDRAIL";
  readonly metricRef: string;
  readonly horizon: ActionOutcomeContracts[number]["horizon"];
  readonly evidencePolicyRef: string;
  readonly decisionLedgerOutcomeKey: string;
  readonly decisionLedgerEvidenceSlotRef: string;
  readonly learningSignalRef: string;
  readonly learningUpdateRuleRef: string;
}

export interface OutcomeMeasurementPlan {
  readonly schemaVersion: typeof OUTCOME_MEASUREMENT_PLAN_VERSION;
  readonly actionId: string;
  readonly actionFingerprint: string;
  readonly entries: readonly OutcomeMeasurementPlanEntry[];
}

export function buildOutcomeMeasurementPlan(
  actionId: string,
  actionFingerprint: string,
  contractsInput: ActionOutcomeContracts,
): OutcomeMeasurementPlan {
  const contracts = actionOutcomeContractsSchema.parse(contractsInput);
  return {
    schemaVersion: OUTCOME_MEASUREMENT_PLAN_VERSION,
    actionId,
    actionFingerprint,
    entries: [...contracts]
      .sort((left, right) => left.outcomeId.localeCompare(right.outcomeId))
      .map((contract) => ({
        outcomeId: contract.outcomeId,
        role: contract.role,
        metricRef: contract.metricRef,
        horizon: contract.horizon,
        evidencePolicyRef: contract.evidencePolicyRef,
        decisionLedgerOutcomeKey: contract.decisionLedger.outcomeKey,
        decisionLedgerEvidenceSlotRef: contract.decisionLedger.evidenceSlotRef,
        learningSignalRef: contract.learning.signalRef,
        learningUpdateRuleRef: contract.learning.updateRuleRef,
      })),
  };
}
