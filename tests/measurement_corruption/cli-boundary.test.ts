import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { parseSimulationArgs, measurementControl } from "../../src/evaluation/simulate-cli.js";

interface Module { source: string; dependencies: { resolved: string }[] }
const hidden = /^src\/(ground_truth|generation|customer_population|simulation|advertising_economics|cross_channel|ecommerce_economics|product_economics|inventory_dynamics|pricing_promotions|retention_ltv|website_cro|external_reality|measurement_corruption|evaluation|oracle|god_mode)(\/|$)/;
const entry = /^(src\/(core|observation|operator|operator_safe)(\/|$)|src\/index\.ts$)/;
function hiddenReachability(modules: readonly Module[]): string[] {
  const graph = new Map(modules.map(m => [m.source, m.dependencies.map(d => d.resolved)]));
  const violations: string[] = [];
  for (const root of graph.keys()) {
    if (!entry.test(root)) continue;
    const visited = new Set<string>();
    const pending = [root];
    while (pending.length > 0) {
      const target = pending.pop()!;
      if (visited.has(target)) continue;
      visited.add(target);
      if (hidden.test(target)) violations.push(`${root} reaches ${target}`);
      pending.push(...(graph.get(target) ?? []));
    }
  }
  return violations;
}

describe("observed-only CLI", () => {
  it("requires explicit scenario/seed or an exclusive manifest replay", () => {
    expect(parseSimulationArgs(["--scenario", "9274", "--seed", "88213"])).toEqual({ mode: "generate", scenario: "measurement-control", seed: 88213 });
    expect(parseSimulationArgs(["--scenario", "measurement-control", "--seed", "1", "--manifest", "/private/run.json"])).toEqual({ mode: "generate", scenario: "measurement-control", seed: 1, manifestPath: "/private/run.json" });
    expect(parseSimulationArgs(["--replay", "/private/run.json"])).toEqual({ mode: "replay", path: "/private/run.json" });
    expect(parseSimulationArgs(["--help"])).toEqual({ mode: "help" });
  });
  it("rejects unknown scenarios, extra arguments, seed coercion and mixed modes", () => {
    for (const args of [[], ["--seed", "1"], ["--scenario", "unbuilt-trap", "--seed", "1"],
      ["--scenario", "9274", "--seed", "1.5"], ["--scenario", "9274", "--seed", "NaN"],
      ["--scenario", "9274", "--seed", "4294967294"], ["--seed", "1", "--seed", "2"],
      ["--replay", "file.json", "--seed", "1"], ["--truth", "stdout"]]) {
      expect(() => parseSimulationArgs(args)).toThrow();
    }
  });
  it("builds the same pinned control inputs without pretending it is an adversarial library", () => {
    const first = measurementControl(88213), second = measurementControl(88213);
    expect(second).toEqual(first);
    expect(first.options.platformSpend).toEqual([]);
    expect(first.options.scope).toBe("explicit_simulated_agents");
    expect(first.request.interventions?.every(i => i.value.kind === "number" && i.value.value === 0)).toBe(true);
  });
});

describe("transitive Operator boundary", () => {
  it("detects hidden truth reached through an apparently safe helper", () => {
    expect(hiddenReachability([
      { source: "src/observation/input.ts", dependencies: [{ resolved: "src/helpers/bridge.ts" }] },
      { source: "src/helpers/bridge.ts", dependencies: [{ resolved: "src/evaluation/oracle.ts" }] },
      { source: "src/evaluation/oracle.ts", dependencies: [] },
    ])).toEqual(["src/observation/input.ts reaches src/evaluation/oracle.ts"]);
  });
  it("no current Operator-safe entrypoint can transitively reach truth, corruption or oracle code", () => {
    const output = execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", ["--no-install", "depcruise", "--config", ".dependency-cruiser.cjs", "--output-type", "json", "src"],
      { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    const graph = JSON.parse(output) as { modules: Module[] };
    expect(Array.isArray(graph.modules)).toBe(true);
    expect(graph.modules.some(m => m.source === "src/observation/corrupted-world.ts")).toBe(true);
    expect(graph.modules.some(m => m.source === "src/evaluation/finite-decision-oracle.ts")).toBe(true);
    expect(hiddenReachability(graph.modules)).toEqual([]);
  }, 30000);
});
