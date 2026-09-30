import { describe, expect, it } from "vitest";
import { BUSINESS_STATE_VERSION } from "../../src/business_state/schema.js";
import { metricRegistry } from "../../src/business_state/metric-registry.js";
import { CANONICAL_DEFINITION_VERSION, METRIC_IDS } from "../../src/diagnosis/contract.js";
import { AUTHORITY } from "../../src/diagnosis/engine.js";
import { EXPECTED_UNIT } from "../../src/diagnosis/validate.js";

describe("diagnosis definition revision compatibility", () => {
  it("pins the core definition namespace to the actual Business State schema revision", () => {
    expect(CANONICAL_DEFINITION_VERSION).toBe(BUSINESS_STATE_VERSION);
  });
  it.each(METRIC_IDS)("keeps %s bound to its canonical identity, unit and authority", id => {
    expect(metricRegistry[id].id).toBe(id);
    expect(metricRegistry[id].unit).toBe(EXPECTED_UNIT[id]);
    expect(metricRegistry[id].authoritativeSources).toEqual([AUTHORITY[id]]);
  });
});
