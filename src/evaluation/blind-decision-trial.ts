import { DECISION_PROTOCOL_VERSION, decisionChoiceSchema, parseDecisionOffer, type DecisionOffer } from "../observation/decision-protocol.js";
import { sha256, canonicalJson } from "./replay-manifest.js";
import { decisionRegret, type FiniteOracleResult } from "./finite-decision-oracle.js";
import { exactDecisionRegret, type ExactOracleResult } from "./exact-decision-oracle.js";
import { runMeasuredWorld } from "./measured-world.js";
import { requestWithScheduledSpend, scheduledMeasurementSpend } from "./scheduled-spend.js";
import { evaluateScheduledDecisionSet, type ScheduledDecisionInput } from "./scheduled-decision-oracle.js";

type TrialOracle = FiniteOracleResult | ExactOracleResult;
/**
 * Evaluator-owned commit-before-score lifecycle. The only operator capability is
 * handleJson(); do not pass this object, evaluate callback or process to an agent.
 * It is NOT an execution sandbox. Host it across an isolated transport.
 */
export function createBlindDecisionTrial<Oracle extends TrialOracle>(input: {
  readonly offer: DecisionOffer;
  readonly candidateSetHash: string;
  readonly experimentHash: string;
  readonly scope: string;
  readonly evaluate: () => Promise<Oracle>;
}) {
  const offer = parseDecisionOffer(input.offer), offerJson = canonicalJson(offer), offerHash = sha256(offer);
  const candidateSetHash = input.candidateSetHash, experimentHash = input.experimentHash, scope = input.scope, evaluate = input.evaluate;
  if (!scope.trim()) throw new RangeError("trial economic scope required");
  if (![candidateSetHash, experimentHash].every(h => /^[a-f0-9]{64}$/.test(h))) throw new RangeError("trial input hashes required");
  let chosen: string | undefined;
  let score: Promise<{ access: "evaluator_only"; choiceCommitment: string; selectedActionId: string; offerHash: string;
    experimentHash: string; oracle: Oracle; regret: ReturnType<typeof decisionRegret> | ReturnType<typeof exactDecisionRegret> }> | undefined;
  const ack = () => canonicalJson({ version: DECISION_PROTOCOL_VERSION, decisionId: offer.decisionId, status: "CHOICE_LOCKED" });
  const commit = (wire: unknown) => {
    if (typeof wire !== "string" || wire.length > 4096) throw new RangeError("INVALID_CHOICE");
    const choice = decisionChoiceSchema.parse(JSON.parse(wire));
    if (choice.decisionId !== offer.decisionId || !offer.actions.some(a => a.actionId === choice.actionId)) throw new RangeError("INVALID_CHOICE");
    if (chosen !== undefined && chosen !== choice.actionId) throw new RangeError("CHOICE_ALREADY_LOCKED");
    chosen = choice.actionId;
    return ack();
  };
  return Object.freeze({
    /** String-only restricted transport, no evaluation or reveal operation. */
    handleJson(operation: string, wire?: unknown): string {
      try {
        if (operation === "offer" && wire === undefined) return offerJson;
        if (operation === "choose") return commit(wire);
        return canonicalJson({ error: "INVALID_OPERATION" });
      } catch { return canonicalJson({ error: chosen === undefined ? "INVALID_CHOICE" : "CHOICE_ALREADY_LOCKED" }); }
    },
    /** Evaluation begins only after a valid choice, once even with concurrent calls. */
    async revealForEvaluator() {
      if (chosen === undefined) throw new RangeError("choice must be committed before evaluating alternatives");
      const selectedActionId = chosen;
      if (score === undefined) {
        score = Promise.resolve().then(async () => {
          const oracle = structuredClone(await evaluate());
          if (oracle.scope !== scope || oracle.candidateSetHash !== candidateSetHash ||
              canonicalJson(oracle.ranking.map(r => r.actionId).sort()) !== canonicalJson(offer.actions.map(a => a.actionId).sort()) ||
              oracle.currency !== offer.currency || oracle.horizon.start !== offer.decisionAt || oracle.horizon.end !== offer.evaluationEnd) {
            throw new RangeError("oracle does not match the committed decision problem");
          }
          const regret = "probabilityDenominator" in oracle ? exactDecisionRegret(oracle, selectedActionId) : decisionRegret(oracle, selectedActionId);
          return { access: "evaluator_only" as const, selectedActionId, offerHash, experimentHash,
            choiceCommitment: sha256({ offerHash, candidateSetHash, experimentHash, selectedActionId }), oracle, regret };
        });
      }
      return structuredClone(await score);
    },
  });
}

/** Actual simulator adapter; single-seed realized regret, NOT a conditional expected optimum. */
export function createScheduledBlindTrial(raw: ScheduledDecisionInput & {
  readonly decisionId: string;
  readonly descriptions: Readonly<Record<string, string>>;
}) {
  const input = structuredClone(raw);
  if (input.seeds.length !== 1 || input.maximumEvaluations < input.candidates.length + 2) {
    throw new RangeError("a single decision world and a budget including the initial offer execution are required");
  }
  const seed = input.seeds[0]!;
  const request = requestWithScheduledSpend({ ...input.initial, simulationSeed: seed }, input.spendPlan);
  const warmup = runMeasuredWorld(request, { ...input.measurement, platformSpend: scheduledMeasurementSpend(input.spendPlan), asOf: input.decisionAt });
  const offer: DecisionOffer = { version: DECISION_PROTOCOL_VERSION, decisionId: input.decisionId,
    decisionAt: input.decisionAt, evaluationEnd: input.initial.endTime, currency: input.initial.merchantWorld.manifest.merchant.currency,
    objective: "future_booked_contribution", observation: warmup.corruptedObservation,
    actions: input.candidates.map(c => ({ actionId: c.actionId, description: input.descriptions[c.actionId] ?? "" })) };
  const candidateSetHash = sha256([...input.candidates].sort((a, b) => a.actionId < b.actionId ? -1 : a.actionId > b.actionId ? 1 : 0));
  return createBlindDecisionTrial({ offer, candidateSetHash, experimentHash: sha256(input), scope: "explicit_agents_future_booked_contribution_no_returns_no_clv_no_overhead", evaluate: async () => {
    const result = await evaluateScheduledDecisionSet({ ...input, maximumEvaluations: input.maximumEvaluations - 1 });
    if (result.observationBySeed.length !== 1 || sha256(JSON.parse(result.observationBySeed[0]!.payload)) !== sha256(offer.observation)) {
      throw new RangeError("oracle changed the committed predecision observation");
    }
    return result.oracle;
  } });
}
