#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { generateMerchantWorldRecord } from "../generation/generator.js";
import { generateCustomerPopulation } from "../customer_population/generator.js";
import { zeroPaidSpendInterventions } from "../simulation/counterfactual.js";
import { MEASUREMENT_VERSION } from "../measurement_corruption/index.js";
import { createMeasuredManifest, replayMeasuredManifest, canonicalJson } from "./replay-manifest.js";
import { operatorPayload, type MeasurementRunOptions } from "./measured-world.js";
import type { SimulateWorldRequest } from "../simulation/types.js";
import { buildMeasurementScenario, MEASUREMENT_SCENARIO_IDS, SCENARIO_LIBRARY_VERSION, type MeasurementScenarioId } from "./scenario-library.js";

export type SimulationCliOptions =
  | { readonly mode: "help" }
  | { readonly mode: "replay"; readonly path: string }
  | { readonly mode: "generate"; readonly scenario: "measurement-control" | MeasurementScenarioId; readonly seed: number; readonly manifestPath?: string };

export function parseSimulationArgs(args: readonly string[]): SimulationCliOptions {
  if (args.length === 1 && args[0] === "--help") return { mode: "help" };
  const allowed = new Set(["--scenario", "--seed", "--manifest", "--replay"]);
  const options = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i], value = args[i + 1];
    if (name === undefined || !allowed.has(name) || value === undefined || value.startsWith("--") || options.has(name)) {
      throw new RangeError("invalid, repeated or incomplete CLI argument");
    }
    options.set(name, value);
  }
  const replay = options.get("--replay");
  if (replay !== undefined) {
    if (options.size !== 1 || !replay.trim()) throw new RangeError("--replay cannot be combined with generation options");
    return { mode: "replay", path: replay };
  }
  const scenario = options.get("--scenario"), seedText = options.get("--seed");
  // 9274 is an alias for ONE integration-control scenario, not an extra adversarial case.
  if (scenario !== "measurement-control" && scenario !== "9274" && !(MEASUREMENT_SCENARIO_IDS as readonly (string | undefined)[]).includes(scenario)) throw new RangeError("unregistered scenario");
  if (seedText === undefined || !/^\d+$/.test(seedText)) throw new RangeError("--seed requires an integer");
  const seed = Number(seedText);
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 4294967293) throw new RangeError("seed must be in [0,4294967293]");
  const manifestPath = options.get("--manifest");
  if (manifestPath !== undefined && !manifestPath.trim()) throw new RangeError("empty manifest path");
  return { mode: "generate", scenario: scenario === "9274" || scenario === "measurement-control" ? "measurement-control" : scenario as MeasurementScenarioId, seed,
    ...(manifestPath === undefined ? {} : { manifestPath }) };
}

/** Pipeline control only: not a verified trap, realistic merchant calibration or Phase 1 pass. */
export function measurementControl(seed: number): { request: SimulateWorldRequest; options: MeasurementRunOptions } {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 4294967293) throw new RangeError("invalid control seed");
  const merchantWorld = generateMerchantWorldRecord({ seed, archetype: "fashion_apparel",
    scale: "growth", complexity: "normal", currency: "CAD" });
  const request: SimulateWorldRequest = {
    merchantWorld,
    latentPopulation: generateCustomerPopulation({ merchantWorld, populationSeed: seed + 1,
      populationConfig: { maxExplicitAgents: 48, complexity: "normal", maxCategoryPreferences: 4, maxProductPreferences: 6 } }),
    simulationSeed: seed + 2, startTime: "2026-01-01T00:00:00.000Z", endTime: "2026-02-01T00:00:00.000Z",
    // The control declares zero paid budgets so an empty actual-spend ledger is explicit.
    // Budget optimization requires the separate true-spend adapter, not this fixture.
    interventions: zeroPaidSpendInterventions(merchantWorld),
    config: { maxEvents: 120000, maxSessionsPerCustomer: 12 },
  };
  return { request, options: {
    corruption: { version: MEASUREMENT_VERSION, seed,
      identitySalt: `synthetic-control-${seed}-measurement-v1`,
      missingUtmRate: 0.2, cookieLossRate: 0.15, consentExclusionRate: 0.1,
      blockedPixelRate: 0.1, duplicateEventRate: 0.02, crossDeviceIdentityRate: 0.25,
      delayedEventRate: 0.1, maxEventDelayMs: 86400000, incompleteCustomerIdentityRate: 0.1,
      directFallbackRate: 0.15, unknownTrafficRate: 0.05, incorrectChannelRate: 0.03 },
    asOf: request.endTime, platformSpend: [], scope: "explicit_simulated_agents",
  } };
}

function codeRevision(): string {
  const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (!/^[a-f0-9]{40}$/.test(head)) throw new RangeError("cannot identify code revision");
  const changed = execFileSync("git", ["diff", "--name-only", "HEAD", "--", "src", "package.json", "tsconfig.json", "tsconfig.build.json"], { encoding: "utf8" }).trim();
  if (changed) throw new RangeError("commit implementation changes before producing a revision-pinned manifest");
  return head;
}

export function simulationMain(args: readonly string[]): void {
  const options = parseSimulationArgs(args);
  if (options.mode === "help") {
    process.stdout.write("Generate: node dist/evaluation/simulate-cli.js --scenario measurement-control --seed 88213 [--manifest PRIVATE_FILE]\nReplay: node dist/evaluation/simulate-cli.js --replay PRIVATE_FILE\nMeasurement mechanism scenarios: adv-008, adv-009, adv-010, adv-012, adv-013, adv-014, adv-015, adv-016, identity-001. These are not Phase 1 acceptance certificates.\nDefault stdout is corrupted observations only. Manifests are evaluator-only and must not be shared with an Operator.\n");
    return;
  }
  const revision = codeRevision();
  if (options.mode === "replay") {
    const bundle = replayMeasuredManifest(JSON.parse(readFileSync(options.path, "utf8")) as unknown, revision);
    process.stdout.write(`${operatorPayload(bundle)}\n`);
    return;
  }
  const input = options.scenario === "measurement-control" ? measurementControl(options.seed) : buildMeasurementScenario(options.scenario, options.seed);
  const { manifest, bundle } = createMeasuredManifest({ ...input,
    scenarioId: options.scenario, scenarioVersion: options.scenario === "measurement-control" ? "control/1" : SCENARIO_LIBRARY_VERSION, codeRevision: revision });
  if (options.manifestPath !== undefined) {
    // Never overwrite a previous experiment and never print a manifest to stdout.
    writeFileSync(options.manifestPath, `${canonicalJson(manifest)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  }
  process.stdout.write(`${operatorPayload(bundle)}\n`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { simulationMain(process.argv.slice(2)); }
  catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "simulation failed"}\n`);
    process.exitCode = 1;
  }
}
