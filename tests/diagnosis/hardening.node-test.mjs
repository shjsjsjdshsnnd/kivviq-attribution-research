import assert from "node:assert/strict";
import { test } from "node:test";
import { fixture, metric } from "./fixture.mjs";
const build = process.env.KIVVIQ_DIAGNOSIS_BUILD_URL ?? new URL("../../.diagnosis-build/", import.meta.url).href;
const { diagnose, serializeDiagnosis } = await import(new URL("engine.js", build));
const { parseDiagnosisInput, DiagnosisInputError } = await import(new URL("validate.js", build));
const { METRIC_IDS } = await import(new URL("contract.js", build));
const change = (report, id) => report.changes.find(row => row.metricId === id);

for (const id of METRIC_IDS) {
  test(`same wrong definition in both periods cannot masquerade as ${id}`, () => {
    const input = fixture({ traffic: true });
    for (const period of ["reference", "current"]) metric(input, id)[period].definitionId = "gross_sales@business-state/1.0.0";
    const report = diagnose(input), finding = change(report, id);
    assert.equal(finding.status, "unknown");
    assert.equal(finding.current, null);
    assert.equal(finding.reference, null);
    assert.ok(finding.reasons.includes("canonical_definition_mismatch"));
    assert.ok(!report.evidenceGraph.nodes.some(node => node.kind === "source" && node.metricId === id));
    assert.ok(!report.revenue.drivers.some(driver => driver.metricId === id));
  });
  test(`unsupported definition revision is rejected for ${id}`, () => {
    const input = fixture({ traffic: true });
    for (const period of ["reference", "current"]) metric(input, id)[period].definitionId = `${id}@business-state/999.0.0`;
    assert.equal(change(diagnose(input), id).delta, null);
  });
}
test("a rejected reference definition does not erase a valid current direct observation", () => {
  const input = fixture(); metric(input, "revenue_net").reference.definitionId = "gross_sales@business-state/1.0.0";
  const report = diagnose(input);
  assert.equal(change(report, "revenue_net").reference, null);
  assert.equal(change(report, "revenue_net").current, 1250000);
  assert.equal(change(report, "revenue_net").delta, null);
  assert.equal(change(report, "aov").current, null);
  assert.ok(!report.evidenceGraph.nodes.some(node => node.id === "source:aov:current"));
});
test("wrong session definitions cannot corrupt verified Shopify revenue and orders/AOV", () => {
  const input = fixture({ traffic: true });
  for (const period of ["reference", "current"]) metric(input, "sessions")[period].definitionId = "pageviews@business-state/1.0.0";
  const report = diagnose(input);
  assert.equal(report.revenue.partitionId, "orders_x_aov");
  assert.equal(report.revenue.observedDeltaMinorUnits, 250000);
  assert.equal(change(report, "cvr").status, "unknown");
});
test("canonical definitions retain the original arithmetic answer", () => {
  const report = diagnose(fixture({ traffic: true }));
  assert.equal(report.revenue.status, "explained_arithmetically");
  assert.equal(report.revenue.observedDeltaMinorUnits, 250000);
  assert.equal(report.revenue.arithmeticResidualMinorUnits, 0);
  assert.equal(report.revenue.drivers.find(row => row.metricId === "aov").effectMinorUnits, 250000);
});

for (const [name, locate, key] of [
  ["root", x => x, "asOf"],
  ["metric array", x => x.metrics, "0"],
  ["series", x => x.metrics[0], "metricId"],
  ["observation", x => x.metrics[0].current, "value"],
  ["window", x => x.metrics[0].current.window, "end"],
  ["policy", x => x.policy, "maxAgeSeconds"],
  ["materiality", x => x.policy.materiality, "revenue_net"],
  ["materiality rule", x => x.policy.materiality.revenue_net, "absolute"],
]) test(`non-enumerable ${name} input cannot bypass validation or JSON replay`, () => {
  const input = fixture(); Object.defineProperty(locate(input), key, { enumerable: false });
  assert.throws(() => diagnose(input), DiagnosisInputError);
});
test("a hidden materiality rule cannot execute an accessor after validation", () => {
  const input = fixture(); let calls = 0;
  Object.defineProperty(input.policy.materiality, "revenue_net", {
    enumerable: false, value: { get absolute() { calls++; return 0; }, relative: 0 },
  });
  assert.throws(() => diagnose(input), DiagnosisInputError);
  assert.equal(calls, 0);
});
test("a hidden unused materiality rule is also rejected", () => {
  const input = fixture();
  Object.defineProperty(input.policy.materiality, "sessions", { value: { absolute: -1, relative: -1 }, enumerable: false });
  assert.throws(() => parseDiagnosisInput(input), DiagnosisInputError);
});
test("required materiality must be an own property, not inherited from Object.prototype", () => {
  const input = fixture(); delete input.policy.materiality.revenue_net;
  const before = Object.getOwnPropertyDescriptor(Object.prototype, "revenue_net");
  try {
    Object.defineProperty(Object.prototype, "revenue_net", { value: { absolute: 0, relative: 0 }, configurable: true });
    assert.throws(() => parseDiagnosisInput(input), DiagnosisInputError);
  } finally {
    if (before) Object.defineProperty(Object.prototype, "revenue_net", before);
    else delete Object.prototype.revenue_net;
  }
});
test("plain null-prototype input is still accepted and replayable", () => {
  function plain(value) {
    if (Array.isArray(value)) return value.map(plain);
    if (!value || typeof value !== "object") return value;
    return Object.assign(Object.create(null), Object.fromEntries(Object.entries(value).map(([key, item]) => [key, plain(item)])));
  }
  const input = plain(fixture());
  assert.equal(serializeDiagnosis(input), serializeDiagnosis(JSON.parse(JSON.stringify(input))));
});
test("materiality can remain partial when only one metric is supplied", () => {
  const input = fixture(); input.metrics = [metric(input, "revenue_net")];
  input.policy.materiality = { revenue_net: { absolute: 10000, relative: 0.03 } };
  assert.equal(change(diagnose(input), "revenue_net").delta, 250000);
});

test("extreme but valid orders/AOV inputs abstain instead of crashing", () => {
  const input = fixture({ orders0: 1, orders1: 1e14, aov0: 1e14, aov1: 2 });
  assert.equal(parseDiagnosisInput(input), input);
  const report = diagnose(input);
  assert.equal(change(report, "revenue_net").delta, 1e14);
  assert.equal(report.status, "partial");
  assert.equal(report.revenue.status, "unknown");
  assert.equal(report.revenue.observedDeltaMinorUnits, 1e14);
  assert.equal(report.revenue.arithmeticResidualMinorUnits, 1e14);
  assert.equal(report.revenue.allocatedDeltaMinorUnits, 0);
  assert.deepEqual(report.revenue.drivers, []);
  assert.ok(report.revenue.reasons.includes("arithmetic_allocation_out_of_range"));
  assert.ok(report.unknowns.some(row => row.evidenceNeeded.some(text => text.includes("higher-precision"))));
});
test("unsafe traffic/CVR interactions fall back to the safe orders/AOV partition", () => {
  const input = fixture({ orders0: 1e6, orders1: 1e6, aov0: 1e6, aov1: 2e6, sessions0: 1, sessions1: 1e14, traffic: true });
  const report = diagnose(input);
  assert.equal(report.revenue.status, "explained_arithmetically");
  assert.equal(report.revenue.partitionId, "orders_x_aov");
  assert.equal(report.revenue.observedDeltaMinorUnits, 1e12);
  assert.equal(report.revenue.drivers.find(row => row.metricId === "aov").effectMinorUnits, 1e12);
  assert.ok(report.revenue.reasons.includes("traffic_conversion_partition_numeric_range_exceeded"));
  assert.ok(report.unknowns.some(row => row.id === "unknown:traffic_partition"));
  assert.ok(report.revenue.drivers.every(row => row.metricId !== "sessions" && row.metricId !== "cvr"));
});
test("zero total movement does not hide unsafe offsetting effects", () => {
  const report = diagnose(fixture({ orders0: 1, orders1: 1e14, aov0: 1e14, aov1: 1 }));
  assert.equal(report.revenue.status, "unknown");
  assert.equal(report.revenue.observedDeltaMinorUnits, 0);
  assert.equal(report.revenue.arithmeticResidualMinorUnits, 0);
  assert.equal(report.revenue.causallyExplainedMinorUnits, null);
});
test("a small legitimate arithmetic residual is retained", () => {
  const input = fixture(); metric(input, "revenue_net").current.value += 1;
  const report = diagnose(input);
  assert.equal(report.revenue.status, "partial");
  assert.equal(report.revenue.arithmeticResidualMinorUnits, 1);
  assert.equal(report.revenue.observedDeltaMinorUnits, report.revenue.allocatedDeltaMinorUnits + 1);
});
test("out-of-input-range and malformed numbers are still rejected, not swallowed", () => {
  const input = fixture(); metric(input, "revenue_net").current.value = Infinity;
  assert.throws(() => diagnose(input), DiagnosisInputError);
  metric(input, "revenue_net").current.value = Number.MAX_SAFE_INTEGER;
  assert.throws(() => diagnose(input), DiagnosisInputError);
});
test("numeric fallback is deterministic under input order and JSON round-trip", () => {
  const input = fixture({ orders0: 1e6, orders1: 1e6, aov0: 1e6, aov1: 2e6, sessions0: 1, sessions1: 1e14, traffic: true });
  const original = structuredClone(input), first = serializeDiagnosis(input);
  input.metrics.reverse();
  assert.equal(serializeDiagnosis(input), first);
  assert.equal(serializeDiagnosis(JSON.parse(JSON.stringify(input))), first);
  input.metrics.reverse(); assert.deepEqual(input, original);
});
test("1,000 fixed-seed ordinary diagnoses still reconcile exactly", () => {
  let state = 5192026;
  const draw = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 2 ** 32; };
  for (let i = 0; i < 1000; i++) {
    const input = fixture({ orders0: 1 + Math.floor(draw() * 1000), orders1: 1 + Math.floor(draw() * 1000),
      aov0: 1 + Math.floor(draw() * 100000), aov1: 1 + Math.floor(draw() * 100000),
      sessions0: 10000, sessions1: 20000, traffic: true });
    const report = diagnose(input);
    assert.equal(report.revenue.status, "explained_arithmetically");
    assert.equal(report.revenue.allocatedDeltaMinorUnits, report.revenue.observedDeltaMinorUnits);
    assert.equal(report.revenue.arithmeticResidualMinorUnits, 0);
  }
});
test("280 disproportionate-factor cases return finite reports, never uncaught range errors", () => {
  const finite = value => {
    if (typeof value === "number") assert.ok(Number.isFinite(value));
    else if (value && typeof value !== "object") return;
    else if (value && typeof value === "object") Object.values(value).forEach(finite);
  };
  for (let power = 1; power <= 14; power++) for (let n = 0; n < 20; n++) {
    const magnitude = 10 ** power;
    const input = fixture({ orders0: 1, orders1: magnitude, aov0: magnitude, aov1: n % 2 ? 1 : 2, traffic: n % 2 === 0 });
    const report = diagnose(input); finite(report);
    assert.equal(report.revenue.observedDeltaMinorUnits, change(report, "revenue_net").delta);
    assert.equal(report.revenue.allocatedDeltaMinorUnits + report.revenue.arithmeticResidualMinorUnits, report.revenue.observedDeltaMinorUnits);
    assert.ok(report.revenue.drivers.every(row => row.evidenceClass === "associated_driver"));
  }
});
