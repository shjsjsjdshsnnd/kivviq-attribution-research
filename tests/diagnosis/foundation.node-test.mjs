import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { fixture, metric } from "./fixture.mjs";
const build = process.env.KIVVIQ_DIAGNOSIS_BUILD_URL ?? new URL("../../.diagnosis-build/", import.meta.url).href;
const { diagnose, serializeDiagnosis, allocateProductChange, roundEffects, decomposeRateMix, DiagnosisInputError } = await import(new URL("index.js", build));
const change = (report, id) => report.changes.find(row => row.metricId === id);
const effect = (report, id) => report.revenue.drivers.find(row => row.metricId === id)?.effectMinorUnits;
const almost = (a, b, tolerance = 1e-7) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);

// Deterministic known-driver scenarios. The expected answer is held by the test,
// not passed to diagnose(). These are arithmetic oracles, not causal benchmarks.
test("pure AOV growth is identified without invented order growth", () => {
  const report = diagnose(fixture());
  assert.equal(report.status, "diagnosed");
  assert.equal(change(report, "revenue_net").delta, 250000);
  assert.equal(effect(report, "aov"), 250000);
  assert.equal(effect(report, "orders"), 0);
  assert.equal(report.revenue.arithmeticResidualMinorUnits, 0);
});
test("pure order growth is allocated to order volume", () => {
  const report = diagnose(fixture({ orders1: 120, aov1: 10000 }));
  assert.equal(effect(report, "orders"), 200000);
  assert.equal(effect(report, "aov"), 0);
});
test("orders and AOV interactions are allocated once", () => {
  const report = diagnose(fixture({ orders1: 110, aov1: 12000 }));
  assert.equal(effect(report, "orders"), 110000);
  assert.equal(effect(report, "aov"), 210000);
  assert.equal(report.revenue.drivers.reduce((s, d) => s + d.effectMinorUnits, 0), 320000);
});
test("traffic down, CVR up and AOV up form a single disjoint partition", () => {
  const report = diagnose(fixture({ orders1: 160, aov1: 12000, sessions1: 8000, traffic: true }));
  assert.equal(report.revenue.partitionId, "sessions_x_cvr_x_aov");
  assert.equal(report.revenue.drivers.length, 3);
  assert.ok(effect(report, "sessions") < 0);
  assert.ok(effect(report, "cvr") > 0);
  assert.ok(effect(report, "aov") > 0);
  assert.equal(effect(report, "orders"), undefined);
  assert.equal(report.revenue.allocatedDeltaMinorUnits, 920000);
  assert.equal(report.revenue.arithmeticResidualMinorUnits, 0);
});
test("offsetting factors at zero net change have no infinite percentage shares", () => {
  const report = diagnose(fixture({ orders1: 125, aov1: 8000 }));
  assert.equal(report.revenue.observedDeltaMinorUnits, 0);
  assert.ok(report.revenue.drivers.every(row => row.signedShareOfNetChange === null));
  assert.equal(effect(report, "orders"), -effect(report, "aov"));
});
test("signed effects can exceed the net movement without double counting", () => {
  const report = diagnose(fixture({ orders1: 200, aov1: 5500 }));
  assert.ok(report.revenue.drivers.some(row => row.signedShareOfNetChange > 1));
  assert.ok(report.revenue.drivers.some(row => row.signedShareOfNetChange < 0));
  almost(report.revenue.drivers.reduce((sum, row) => sum + row.signedShareOfNetChange, 0), 1);
});
test("pure revenue decline has negative allocated effects", () => {
  const report = diagnose(fixture({ aov1: 8000 }));
  assert.equal(effect(report, "aov"), -200000);
  assert.match(report.explanation, /decreased/);
});
test("negative reference revenue is not called percentage growth", () => {
  const report = diagnose(fixture({ aov0: -1000, aov1: 2000 }));
  assert.equal(change(report, "revenue_net").delta, 300000);
  assert.match(report.explanation, /not reported for a zero or negative reference/);
});
test("zero-reference percentage is unknown rather than infinity", () => {
  const report = diagnose(fixture({ aov0: 0, aov1: 2000 }));
  assert.equal(change(report, "revenue_net").relativeDelta, null);
  assert.match(report.explanation, /zero or negative reference/);
});
test("zero orders keep revenue known but AOV and its allocation unknown", () => {
  const report = diagnose(fixture({ orders0: 0, aov0: 0 }));
  assert.notEqual(change(report, "revenue_net").delta, null);
  assert.equal(change(report, "aov").status, "unknown");
  assert.equal(report.revenue.status, "unknown");
  assert.equal(report.revenue.arithmeticResidualMinorUnits, report.revenue.observedDeltaMinorUnits);
});
test("zero sessions cannot produce a conversion diagnosis", () => {
  const report = diagnose(fixture({ sessions0: 0, traffic: true }));
  assert.equal(change(report, "cvr").status, "unknown");
  assert.equal(report.revenue.partitionId, "orders_x_aov");
});
test("small commercial movements are retained but marked immaterial", () => {
  const report = diagnose(fixture({ aov1: 10010 }));
  assert.equal(change(report, "revenue_net").status, "immaterial");
  assert.equal(change(report, "revenue_net").delta, 1000);
  assert.match(report.explanation, /below the configured/);
});
test("zero delta is immaterial even when both policy floors are zero", () => {
  const input = fixture({ aov1: 10000 });
  input.policy.materiality.revenue_net = { absolute: 0, relative: 0 };
  assert.equal(change(diagnose(input), "revenue_net").status, "immaterial");
});
test("materiality requires BOTH absolute and relative thresholds", () => {
  const input = fixture();
  input.policy.materiality.revenue_net.absolute = 300000;
  assert.equal(change(diagnose(input), "revenue_net").status, "immaterial");
  input.policy.materiality.revenue_net = { absolute: 0, relative: 0.5 };
  assert.equal(change(diagnose(input), "revenue_net").status, "immaterial");
});

for (const [field, value, reason] of [
  ["value", null, "value_missing"], ["merchantId", "other-merchant", "merchant_mismatch"],
  ["source", "META_ADS", "non_authoritative_source"], ["evidenceId", null, "evidence_reference_missing"],
  ["complete", false, "period_incomplete"], ["sourceScanComplete", false, "source_scan_incomplete"],
  ["coverage", null, "coverage_unknown"], ["coverage", 0.6, "coverage_below_threshold"],
  ["currency", "USD", "currency_mismatch"], ["observedAt", null, "observation_timestamp_missing"],
  ["observedAt", "2026-09-16T00:00:00Z", "future_evidence"],
  ["observedAt", "2026-09-10T00:00:00Z", "stale_evidence"],
  ["dataThrough", null, "data_latency_unknown"], ["dataThrough", "2026-09-14T00:00:00Z", "data_not_mature"],
  ["dataThrough", "2026-09-16T00:00:00Z", "data_through_after_observation"],
  ["scopeId", "pos-plus-web", "scopeId_changed"], ["populationId", "consenting-only", "populationId_changed"],
  ["definitionId", "gross-sales-not-net", "definitionId_changed"], ["measurementId", "new-attribution-window", "measurementId_changed"],
]) {
  test(`unusable revenue evidence abstains: ${field}=${String(value)}`, () => {
    const input = fixture(); metric(input, "revenue_net").current[field] = value;
    const report = diagnose(input), observed = change(report, "revenue_net");
    assert.equal(observed.status, "unknown"); assert.equal(observed.delta, null);
    assert.ok(observed.reasons.includes(reason));
    assert.equal(report.revenue.drivers.length, 0);
    assert.ok(report.unknowns.some(row => row.evidenceNeeded.length > 0));
  });
}
test("a period beyond asOf is unavailable even when marked complete", () => {
  const input = fixture(); input.asOf = "2026-09-14T00:00:00Z";
  assert.ok(change(diagnose(input), "revenue_net").reasons.includes("period_not_closed_at_as_of"));
});
test("unequal period duration is not silently annualized or normalized", () => {
  const input = fixture(); metric(input, "revenue_net").reference.window.start = "2026-09-02T00:00:00Z";
  assert.ok(change(diagnose(input), "revenue_net").reasons.includes("period_durations_differ"));
});
test("overlapping comparison windows are rejected", () => {
  const input = fixture(); metric(input, "revenue_net").reference.window = { start: "2026-09-02T00:00:00Z", end: "2026-09-09T00:00:00Z" };
  assert.ok(change(diagnose(input), "revenue_net").reasons.includes("reference_overlaps_or_follows_current"));
});
test("mismatched scopes do not become a valid AOV merely by matching numerically", () => {
  const input = fixture();
  for (const period of ["current", "reference"]) metric(input, "orders")[period].scopeId = "store-plus-pos";
  const report = diagnose(input);
  assert.equal(change(report, "aov").status, "unknown");
  assert.equal(report.revenue.status, "unknown");
});
test("tracking loss in sessions does not contaminate known Shopify revenue", () => {
  const input = fixture({ traffic: true }); metric(input, "sessions").current.coverage = 0.5;
  const report = diagnose(input);
  assert.notEqual(change(report, "revenue_net").status, "unknown");
  assert.equal(change(report, "cvr").status, "unknown");
  assert.equal(report.revenue.partitionId, "orders_x_aov");
});
test("storewide orders cannot be combined with storefront sessions", () => {
  const input = fixture({ traffic: true });
  for (const period of ["reference", "current"]) metric(input, "sessions")[period].scopeId = "consented-storefront";
  const report = diagnose(input);
  assert.equal(report.revenue.partitionId, "orders_x_aov");
  assert.ok(report.unknowns.some(row => row.id === "unknown:traffic_partition"));
});
test("fabricated DERIVED AOV fails arithmetic lineage verification", () => {
  const input = fixture(); metric(input, "aov").current.value += 1000;
  const report = diagnose(input);
  assert.ok(change(report, "aov").reasons.includes("derived_identity_failed"));
  assert.equal(report.revenue.drivers.length, 0);
});
test("fabricated DERIVED CVR fails arithmetic lineage verification", () => {
  const input = fixture({ traffic: true }); metric(input, "cvr").current.value += 0.02;
  const report = diagnose(input);
  assert.ok(change(report, "cvr").reasons.includes("derived_identity_failed"));
  assert.equal(report.revenue.partitionId, "orders_x_aov");
});
test("derived metrics without operands remain unknown", () => {
  const input = fixture(); input.metrics = [metric(input, "aov")];
  assert.equal(change(diagnose(input), "aov").status, "unknown");
});
test("missing metrics preserve the known amount of unallocated change", () => {
  const input = fixture(); input.metrics = [metric(input, "revenue_net")];
  const report = diagnose(input);
  assert.equal(report.revenue.arithmeticResidualMinorUnits, 250000);
  assert.equal(report.revenue.allocatedDeltaMinorUnits, 0);
  assert.equal(report.revenue.causallyExplainedMinorUnits, null);
});
test("empty evidence gives an explicit unknown answer", () => {
  const input = fixture(); input.metrics = [];
  assert.equal(diagnose(input).status, "unknown");
});
test("confidence is constrained by dependency coverage, not by the DERIVED label", () => {
  const input = fixture(); metric(input, "revenue_net").current.coverage = 0.97;
  const report = diagnose(input);
  assert.equal(change(report, "aov").confidence.level, "MEDIUM");
  assert.equal(report.revenue.confidence.level, "MEDIUM");
  assert.ok(report.changes.every(row => row.confidence.statisticalSignificance === "not_assessed"));
});
test("rounding residuals are retained, not relabeled as explained", () => {
  const input = fixture(); metric(input, "revenue_net").current.value += 1;
  const report = diagnose(input);
  assert.equal(report.revenue.status, "partial");
  assert.equal(report.revenue.arithmeticResidualMinorUnits, 1);
  assert.equal(report.revenue.observedDeltaMinorUnits, report.revenue.allocatedDeltaMinorUnits + 1);
});
test("quarterly or yearly labels do not become unseen comparison data", () => {
  for (const [kind, text] of [["YOY", "year-over-year"], ["SEASONAL_BASELINE", "seasonal baseline"]]) {
    const input = fixture(); input.comparisonKind = kind;
    if (kind === "YOY") for (const row of input.metrics) { row.reference.window = { start: "2025-09-08T00:00:00Z", end: "2025-09-15T00:00:00Z" }; }
    const report = diagnose(input);
    assert.equal(report.comparisonKind, kind); assert.match(report.explanation, new RegExp(text));
  }
});

// Strict boundary and anti-God-mode tests.
for (const [name, mutate] of [
  ["root truth", x => { x.trueWorld = { causalProfit: 999 }; }],
  ["metric truth", x => { x.metrics[0].groundTruth = 999; }],
  ["observation oracle", x => { x.metrics[0].current.oracle = 999; }],
  ["window future shock", x => { x.metrics[0].current.window.externalShock = 999; }],
  ["policy answer", x => { x.policy.bestDriver = "aov"; }],
  ["materiality hidden answer", x => { x.policy.materiality.revenue_net.trueEffect = 999; }],
  ["causal self-label", x => { x.metrics[0].current.evidenceClass = "causal_evidence"; }],
  ["array metadata", x => { x.metrics.groundTruth = 1; }],
  ["symbol metadata", x => { x[Symbol("truth")] = 1; }],
  ["platform ROAS substitution", x => { x.metrics[0].metricId = "platform_roas"; }],
  ["unit substitution", x => { x.metrics[0].unit = "RATIO"; }],
  ["missing materiality", x => { delete x.policy.materiality.revenue_net; }],
  ["negative policy floor", x => { x.policy.materiality.revenue_net.absolute = -1; }],
  ["unsafe tolerance", x => { x.policy.identityToleranceMinorUnits = 1e6; }],
  ["NaN", x => { x.metrics[0].current.value = NaN; }],
  ["infinity", x => { x.metrics[0].current.value = Infinity; }],
  ["fractional revenue cents", x => { x.metrics[0].current.value = 1.5; }],
  ["negative order count", x => { metric(x, "orders").current.value = -1; }],
  ["unsafe monetary range", x => { x.metrics[0].current.value = Number.MAX_SAFE_INTEGER; }],
  ["duplicate metric", x => { x.metrics.push(structuredClone(x.metrics[0])); }],
  ["reused atomic evidence ID", x => { x.metrics[0].current.evidenceId = x.metrics[0].reference.evidenceId; }],
  ["invalid calendar date", x => { x.asOf = "2026-02-30T00:00:00Z"; }],
  ["no UTC timezone", x => { x.asOf = "2026-09-15T12:00:00"; }],
  ["unknown version", x => { x.version = "diagnosis-input/999"; }],
  ["reversed window", x => { x.metrics[0].current.window.start = "2026-09-20T00:00:00Z"; }],
  ["getter masquerading as data", x => { Object.defineProperty(x, "asOf", { get: () => "2026-09-15T12:00:00Z" }); }],
]) test(`strict input rejects ${name}`, () => { const input = fixture(); mutate(input); assert.throws(() => diagnose(input), DiagnosisInputError); });

test("canonical rendering uses explicit currency scale", () => {
  const input = fixture(); input.minorUnitsPerMajor = 1000;
  assert.match(diagnose(input).explanation, /CAD 250\.000/);
});
test("every graph edge resolves, and source facts include provenance and calculations", () => {
  const report = diagnose(fixture({ traffic: true }));
  const ids = new Set(report.evidenceGraph.nodes.map(row => row.id));
  assert.equal(ids.size, report.evidenceGraph.nodes.length);
  assert.ok(report.evidenceGraph.edges.every(edge => ids.has(edge.from) && ids.has(edge.to)));
  assert.ok(report.evidenceGraph.nodes.filter(row => row.kind === "source").every(row => row.evidenceId && row.window && row.definitionId && row.scopeId));
  assert.ok(report.evidenceGraph.edges.some(edge => edge.to === "source:aov:current" && edge.from === "source:revenue_net:current"));
});
test("the graph is acyclic", () => {
  const { nodes, edges } = diagnose(fixture({ traffic: true })).evidenceGraph;
  const done = new Set(), active = new Set();
  function visit(id) { if (done.has(id)) return; assert.ok(!active.has(id)); active.add(id); for (const edge of edges.filter(row => row.from === id)) visit(edge.to); active.delete(id); done.add(id); }
  nodes.forEach(row => visit(row.id));
});
test("no calculated allocation is promoted to causal evidence", () => {
  const report = diagnose(fixture({ traffic: true }));
  assert.ok(report.changes.every(row => row.evidenceClass === "observed_change"));
  assert.ok(report.revenue.drivers.every(row => row.evidenceClass === "associated_driver"));
  assert.equal(report.revenue.causalExplanation, "not_established");
  assert.equal(report.revenue.causallyExplainedMinorUnits, null);
  assert.doesNotMatch(report.explanation, /caused|statistically significant/);
});
test("deterministic replay, input order invariance, and no input mutation", () => {
  const input = fixture({ traffic: true }); const before = structuredClone(input);
  const first = serializeDiagnosis(input);
  assert.equal(first, serializeDiagnosis(input));
  assert.deepEqual(input, before);
  input.metrics.reverse(); assert.equal(first, serializeDiagnosis(input));
});
test("serialized report contains no nonfinite numbers", () => {
  const input = fixture({ orders1: 125, aov1: 8000, traffic: true });
  function inspect(value) { if (typeof value === "number") assert.ok(Number.isFinite(value)); else if (value && typeof value === "object") Object.values(value).forEach(inspect); }
  inspect(diagnose(input)); assert.doesNotMatch(serializeDiagnosis(input), /Infinity|NaN/);
});
test("the diagnosis runtime imports no evaluator, ground truth or simulator modules", () => {
  const dir = new URL("../../src/diagnosis/", import.meta.url);
  for (const name of readdirSync(dir).filter(name => name.endsWith(".ts"))) {
    const text = readFileSync(new URL(name, dir), "utf8");
    const imports = [...text.matchAll(/\b(?:from\s+|import\s*\()["']([^"']+)["']/g)].map(match => match[1]);
    assert.ok(imports.every(path => /^\.\/(?:contract|math|validate|engine)\.js$/.test(path)), `${name}: ${imports}`);
  }
});

// Property checks use a fixed local PRNG; no Math.random, no evaluator inputs.
function random(seed) { let state = seed >>> 0; return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 2 ** 32; }; }
test("2,000 seeded product allocations reconcile and respect feature permutation", () => {
  const rand = random(50127);
  for (let index = 0; index < 2000; index++) {
    const n = index % 2 + 2;
    const before = Array.from({ length: n }, () => Math.floor(rand() * 100) + 1);
    const after = Array.from({ length: n }, () => Math.floor(rand() * 100) + 1);
    const effects = allocateProductChange(before, after);
    const delta = after.reduce((a, b) => a * b, 1) - before.reduce((a, b) => a * b, 1);
    almost(effects.reduce((a, b) => a + b, 0), delta);
    assert.equal(roundEffects(effects).reduce((a, b) => a + b, 0), delta);
    const permuted = allocateProductChange([...before].reverse(), [...after].reverse()).reverse();
    effects.forEach((value, i) => almost(value, permuted[i]));
  }
});
test("1,000 seeded full diagnoses preserve money and produce replayable output", () => {
  const rand = random(51921);
  for (let index = 0; index < 1000; index++) {
    const input = fixture({ orders0: 10 + Math.floor(rand() * 300), orders1: 10 + Math.floor(rand() * 300),
      aov0: 100 + Math.floor(rand() * 100000), aov1: 100 + Math.floor(rand() * 100000),
      sessions0: 10000, sessions1: 20000, traffic: true });
    const report = diagnose(input);
    assert.equal(report.revenue.status, "explained_arithmetically");
    assert.equal(report.revenue.arithmeticResidualMinorUnits, 0);
    assert.equal(report.revenue.drivers.reduce((sum, row) => sum + row.effectMinorUnits, 0), change(report, "revenue_net").delta);
    assert.deepEqual(report, diagnose(input));
  }
});
test("signed rounding handles negative half units and deterministic ties", () => {
  assert.deepEqual(roundEffects([0.5, 0.5]), [1, 0]);
  assert.deepEqual(roundEffects([-0.5, -0.5]), [0, -1]);
  assert.equal(roundEffects([-2.2, 4.7, -0.5]).reduce((a, b) => a + b, 0), 2);
});
test("arithmetic rejects unsupported dimensions and nonfinite inputs", () => {
  assert.throws(() => allocateProductChange([1], [2]), RangeError);
  assert.throws(() => allocateProductChange([1, 2], [1, 2, 3]), RangeError);
  assert.throws(() => allocateProductChange([Infinity, 1], [1, 2]), RangeError);
});
const simpson = [
  { id: "higher-rate", referenceNumerator: 720, referenceDenominator: 900, currentNumerator: 90, currentDenominator: 100 },
  { id: "lower-rate", referenceNumerator: 20, referenceDenominator: 100, currentNumerator: 270, currentDenominator: 900 },
];
test("Simpson trap: both segments improve but aggregate conversion falls", () => {
  const result = decomposeRateMix(simpson);
  almost(result.referenceRate, 0.74); almost(result.currentRate, 0.36);
  assert.equal(result.simpsonReversal, true);
  assert.ok(result.withinSegmentEffect > 0); assert.ok(result.mixEffect < 0);
  almost(result.withinSegmentEffect + result.mixEffect, result.delta);
});
test("reverse Simpson trap is also detected", () => {
  const result = decomposeRateMix(simpson.map(row => ({ id: row.id, referenceNumerator: row.currentNumerator, referenceDenominator: row.currentDenominator,
    currentNumerator: row.referenceNumerator, currentDenominator: row.referenceDenominator })));
  assert.equal(result.simpsonReversal, true); assert.ok(result.delta > 0); assert.ok(result.withinSegmentEffect < 0);
});
test("unchanged mix attributes aggregate movement to within-segment changes", () => {
  const rows = simpson.map(row => ({ ...row, currentDenominator: row.referenceDenominator, currentNumerator: row.referenceNumerator + 10 }));
  const result = decomposeRateMix(rows);
  almost(result.mixEffect, 0); assert.equal(result.simpsonReversal, false);
});
test("1,000 seeded mix partitions reconcile exactly within numerical tolerance", () => {
  const rand = random(512);
  for (let index = 0; index < 1000; index++) {
    const rows = Array.from({ length: 4 }, (_, id) => {
      const d0 = 1 + Math.floor(rand() * 10000), d1 = 1 + Math.floor(rand() * 10000);
      return { id: String(id), referenceDenominator: d0, currentDenominator: d1, referenceNumerator: Math.floor(rand() * d0), currentNumerator: Math.floor(rand() * d1) };
    });
    const result = decomposeRateMix(rows); almost(result.residual, 0, 1e-12);
  }
});
test("mix helper refuses undefined segment rates and duplicate IDs", () => {
  assert.throws(() => decomposeRateMix([simpson[0], { ...simpson[1], currentDenominator: 0 }]), RangeError);
  assert.throws(() => decomposeRateMix([simpson[0], simpson[0]]), RangeError);
  assert.throws(() => decomposeRateMix([simpson[0], { ...simpson[1], currentNumerator: 901 }]), RangeError);
});


test("a previous-week reference cannot masquerade as YoY", () => {
  const input = fixture(); input.comparisonKind = "YOY";
  assert.ok(change(diagnose(input), "revenue_net").reasons.includes("yoy_period_alignment_unverified"));
});
test("previous-period gaps require explicit alignment rather than silent relabeling", () => {
  const input = fixture(); metric(input, "revenue_net").reference.window = { start: "2026-08-24T00:00:00Z", end: "2026-08-31T00:00:00Z" };
  assert.ok(change(diagnose(input), "revenue_net").reasons.includes("previous_period_not_adjacent"));
});
test("future observations are quarantined, not leaked through raw values or graph nodes", () => {
  const input = fixture(); const row = metric(input, "revenue_net").current;
  row.observedAt = "2026-09-16T00:00:00Z"; row.value = 987654321;
  const report = diagnose(input);
  assert.equal(change(report, "revenue_net").current, null);
  assert.ok(!report.evidenceGraph.nodes.some(node => node.id === "source:revenue_net:current"));
  assert.ok(!serializeDiagnosis(input).includes("987654321"));
});
test("other-merchant observations do not leak values into a report", () => {
  const input = fixture(); const row = metric(input, "revenue_net").current;
  row.merchantId = "wrong-merchant"; row.value = 987654321;
  assert.ok(!serializeDiagnosis(input).includes("987654321"));
});
