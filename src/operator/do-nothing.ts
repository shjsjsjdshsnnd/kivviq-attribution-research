import { ACTION_SCHEMA_VERSION } from "../action_ontology/types.js";
import {
  deepFreezeOperator,
  operatorFingerprint,
} from "./identity.js";
import {
  OPERATOR_INTERFACE_VERSION,
  type CanonicalOperator,
  type CanonicalOperatorMetadata,
  type OperatorDecisionInput,
  type OperatorDecisionOutput,
} from "./types.js";

export const DO_NOTHING_OPERATOR_ID = "baseline.do_nothing" as const;
export const DO_NOTHING_OPERATOR_VERSION = "1.0.0" as const;
export const DO_NOTHING_FROZEN_STEP_3_1_COMMIT =
  "c74e9a4ba32f16aa016f06782cbb60e07e765af6" as const;
export const DO_NOTHING_SUPPORTED_CONTRACT_FINGERPRINT =
  "fnv1a64:b1cc22917a3e566b" as const;

export const DO_NOTHING_CONFIGURATION = deepFreezeOperator({
  policy: "always_return_empty_action_array",
  discretionaryActionLimit: 0,
  usesPolicyRandomness: false,
  readsBusinessConditionsToChooseIntervention: false,
  discretionaryInterventionsEnabled: false,
} as const);

const IMPLEMENTATION_SEMANTICS = deepFreezeOperator({
  operatorInterfaceVersion: OPERATOR_INTERFACE_VERSION,
  operatorId: DO_NOTHING_OPERATOR_ID,
  operatorVersion: DO_NOTHING_OPERATOR_VERSION,
  supportedEvaluationContract: {
    contractId: "kivviq.baseline-evaluation",
    contractVersion: "1.0.0",
    contractFingerprint: DO_NOTHING_SUPPORTED_CONTRACT_FINGERPRINT,
    frozenCommit: DO_NOTHING_FROZEN_STEP_3_1_COMMIT,
  },
  supportedActionOntologyVersion: ACTION_SCHEMA_VERSION,
  deterministicConfiguration: DO_NOTHING_CONFIGURATION,
  decisionAlgorithm:
    "for every valid operator invocation return exactly {actions: []}; never synthesize a no-op Action",
} as const);

export const DO_NOTHING_IMPLEMENTATION_FINGERPRINT =
  operatorFingerprint(IMPLEMENTATION_SEMANTICS);

export const DO_NOTHING_METADATA: CanonicalOperatorMetadata =
  deepFreezeOperator({
    interfaceVersion: OPERATOR_INTERFACE_VERSION,
    operatorId: DO_NOTHING_OPERATOR_ID,
    operatorType: "baseline",
    operatorVersion: DO_NOTHING_OPERATOR_VERSION,
    description:
      "Canonical zero-discretionary-intervention baseline. Participates in every evaluation opportunity and always proposes Action[] = [].",
    supportedEvaluationContract: {
      contractId: "kivviq.baseline-evaluation",
      contractVersion: "1.0.0",
      contractFingerprint: DO_NOTHING_SUPPORTED_CONTRACT_FINGERPRINT,
      frozenCommit: DO_NOTHING_FROZEN_STEP_3_1_COMMIT,
    },
    supportedActionOntologyVersion: ACTION_SCHEMA_VERSION,
    deterministicConfiguration: DO_NOTHING_CONFIGURATION,
    implementationFingerprint: DO_NOTHING_IMPLEMENTATION_FINGERPRINT,
  });

const EMPTY_DECISION: OperatorDecisionOutput = deepFreezeOperator({
  actions: [],
});

export const DO_NOTHING_OPERATOR: CanonicalOperator =
  deepFreezeOperator({
    metadata: DO_NOTHING_METADATA,
    decide(
      _input: Readonly<OperatorDecisionInput>,
    ): OperatorDecisionOutput {
      return EMPTY_DECISION;
    },
  });
