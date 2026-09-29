#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { currentCodeRevision, verifyExecutionIdentity, executionIdentitySchema } from "./execution-identity.js";
import { runPhase1ValidationMatrix } from "./phase1-validation-suite.js";
import { evaluateExactActionSet, exactDecisionRegret } from "./exact-decision-oracle.js";
import { buildTractableCheckoutControl, TRACTABLE_CONTROL_VERSION } from "./tractable-checkout-control.js";
import { canonicalJson, sha256 } from "./replay-manifest.js";

const envelopeSchema = z.object({ payload: z.object({ version: z.literal("exact-control-evidence/1.0.0"), access: z.literal("evaluator_only"),
  codeRevision: z.string().regex(/^[a-f0-9]{40}$/), execution: executionIdentitySchema, input: z.unknown(),
  selectedActionId: z.string().min(1), choiceCommitment: z.string().regex(/^[a-f0-9]{64}$/), result: z.unknown(), resultHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict(), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
type EvidenceOptions =
  | { readonly mode: "help" }
  | { readonly mode: "validate"; readonly path: string; readonly runId: string }
  | { readonly mode: "exact-oracle"; readonly path: string; readonly selectedActionId: string }
  | { readonly mode: "replay-exact"; readonly path: string };
export function parseEvidenceArgs(args: readonly string[]): EvidenceOptions {
  const mode = args[0];
  if (mode === "--help" && args.length === 1) return { mode: "help" as const };
  if (mode !== "validate" && mode !== "exact-oracle" && mode !== "replay-exact") throw new RangeError("unknown research command");
  const options = new Map<string, string>();
  for (let i = 1; i < args.length; i += 2) {
    const key = args[i], value = args[i + 1];
    const allowed = mode === "validate" ? ["--out", "--run-id"] : mode === "exact-oracle" ? ["--out", "--selected"] : ["--input"];
    if (!key || !allowed.includes(key) || !value?.trim() || value.startsWith("--") || options.has(key)) throw new RangeError("invalid research arguments");
    options.set(key, value);
  }
  if (mode === "replay-exact") {
    if (!options.has("--input")) throw new RangeError("replay requires an evaluator artifact");
    return { mode, path: options.get("--input")! };
  }
  const path = options.get("--out");
  if (!path) throw new RangeError("evaluator-only output path required");
  if (mode === "validate") {
    if (!options.has("--run-id")) throw new RangeError("validation run ID required");
    return { mode, path, runId: options.get("--run-id")! };
  }
  if (!options.has("--selected")) throw new RangeError("record the selected action before evaluating alternatives");
  return { mode, path, selectedActionId: options.get("--selected")! };
}
export async function researchEvidenceMain(args: readonly string[]): Promise<number> {
  const options = parseEvidenceArgs(args);
  if (options.mode === "help") {
    process.stdout.write("validate --out PRIVATE.json --run-id ID\nexact-oracle --out PRIVATE.json --selected ACTION_ID\nreplay-exact --input PRIVATE.json\nValidation exits 2 while Phase 1 is incomplete or failing. Evaluator artifacts are never printed.\n");
    return 0;
  }
  const codeRevision = currentCodeRevision(), execution = verifyExecutionIdentity();
  if (options.mode === "validate") {
    const result = await runPhase1ValidationMatrix(codeRevision, options.runId);
    writeFileSync(options.path, `${canonicalJson({ execution, ...result })}\n`, { mode: 0o600, flag: "wx" });
    process.stdout.write(`${JSON.stringify({ phase1: result.acceptance.overall, passed: result.artifact.payload.results.filter(r => r.status === "PASS").length,
      registered: result.plan.cases.length, artifactSha256: result.artifact.sha256 })}\n`);
    return result.acceptance.overall === "PASS" ? 0 : 2;
  }
  const { evaluate, ...control } = buildTractableCheckoutControl();
  if (options.mode === "replay-exact") {
    const record = envelopeSchema.parse(JSON.parse(readFileSync(options.path, "utf8"))), p = record.payload;
    if (record.sha256 !== sha256(p) || p.codeRevision !== codeRevision || sha256(p.execution) !== sha256(execution) ||
        p.resultHash !== sha256(p.result) || p.choiceCommitment !== sha256({ input: p.input, selectedActionId: p.selectedActionId })) throw new RangeError("exact-control artifact mismatch");
    const input = p.input as typeof control;
    if (input.modelVersion !== TRACTABLE_CONTROL_VERSION) throw new RangeError("unsupported registered exact model");
    const result = await evaluateExactActionSet({ ...input, evaluate });
    if (sha256(result) !== p.resultHash) throw new RangeError("exact-control replay mismatch");
    exactDecisionRegret(result, p.selectedActionId);
    process.stdout.write('{"reproduced":true}\n'); return 0;
  }
  if (!control.candidates.some(c => c.actionId === options.selectedActionId)) throw new RangeError("selected action outside control universe");
  const choiceCommitment = sha256({ input: control, selectedActionId: options.selectedActionId });
  const result = await evaluateExactActionSet({ ...control, evaluate });
  exactDecisionRegret(result, options.selectedActionId);
  const payload = { version: "exact-control-evidence/1.0.0" as const, access: "evaluator_only" as const, codeRevision, execution,
    input: control, selectedActionId: options.selectedActionId, choiceCommitment, result, resultHash: sha256(result) };
  const record = envelopeSchema.parse({ payload, sha256: sha256(payload) });
  writeFileSync(options.path, `${canonicalJson(record)}\n`, { mode: 0o600, flag: "wx" });
  process.stdout.write(`${JSON.stringify({ recorded: true, actions: result.ranking.length, evaluations: result.evaluations, artifactSha256: record.sha256 })}\n`);
  return 0;
}
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  researchEvidenceMain(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(() => {
    process.stderr.write("RESEARCH_EVIDENCE_FAILED\n"); process.exitCode = 1;
  });
}
