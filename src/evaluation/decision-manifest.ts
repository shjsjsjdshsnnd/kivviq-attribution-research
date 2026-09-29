import { currentRuntimeIdentity, runtimeIdentitySchema } from "./execution-identity.js";
import { z } from "zod";
import { canonicalJson, sha256 } from "./replay-manifest.js";
import { evaluateScheduledDecisionSet, type ScheduledDecisionInput } from "./scheduled-decision-oracle.js";
import { decisionRegret } from "./finite-decision-oracle.js";

const revision = z.string().regex(/^[a-f0-9]{40}$/), hash = z.string().regex(/^[a-f0-9]{64}$/);
export const DECISION_MANIFEST_VERSION = "scheduled-decision-manifest/1.0.0" as const;
const schema = z.object({ payload: z.object({
  version: z.literal(DECISION_MANIFEST_VERSION), access: z.literal("evaluator_only"),
  codeRevision: revision, scenarioId: z.string().min(1), scenarioVersion: z.string().min(1),
  runtime: runtimeIdentitySchema,
  input: z.unknown(), selectedActionId: z.string().min(1), choiceCommitment: hash,
  result: z.unknown(), resultHash: hash,
}).strict(), sha256: hash }).strict();
export type ScheduledDecisionManifest = z.infer<typeof schema>;
const runtime = currentRuntimeIdentity;
/** Captures all inputs, not just a scenario name/seed that can drift with defaults. */
export async function createScheduledDecisionManifest(raw: {
  readonly codeRevision: string; readonly scenarioId: string; readonly scenarioVersion: string;
  readonly input: ScheduledDecisionInput; readonly selectedActionId: string;
}) {
  const input = structuredClone(raw.input), selectedActionId = raw.selectedActionId;
  revision.parse(raw.codeRevision); canonicalJson(input);
  if (!input.candidates.some(c => c.actionId === selectedActionId)) throw new RangeError("choice must precede replay and belong to the registered universe");
  const choiceCommitment = sha256({ input, selectedActionId });
  // Capture metadata before awaiting a callback-driven evaluation.
  const metadata = { codeRevision: raw.codeRevision, scenarioId: raw.scenarioId, scenarioVersion: raw.scenarioVersion };
  const result = await evaluateScheduledDecisionSet(input);
  const payload = { version: DECISION_MANIFEST_VERSION, access: "evaluator_only" as const,
    ...metadata, runtime: runtime(), input, selectedActionId, choiceCommitment, result, resultHash: sha256(result) };
  return { manifest: schema.parse({ payload, sha256: sha256(payload) }),
    regret: decisionRegret(result.oracle, selectedActionId), result };
}
/** Integrity and exact replay, not authenticity or proof that an outside agent was blinded. */
export async function replayScheduledDecisionManifest(value: unknown, codeRevision: string) {
  const manifest = schema.parse(value), p = manifest.payload;
  if (p.codeRevision !== revision.parse(codeRevision) || manifest.sha256 !== sha256(p) ||
      p.resultHash !== sha256(p.result) || canonicalJson(p.runtime) !== canonicalJson(runtime()) ||
      p.choiceCommitment !== sha256({ input: p.input, selectedActionId: p.selectedActionId })) {
    throw new RangeError("decision manifest revision/runtime/integrity mismatch");
  }
  const result = await evaluateScheduledDecisionSet(p.input as ScheduledDecisionInput);
  if (sha256(result) !== p.resultHash) throw new RangeError("decision oracle replay mismatch");
  return { access: "evaluator_only" as const, result, regret: decisionRegret(result.oracle, p.selectedActionId) };
}
