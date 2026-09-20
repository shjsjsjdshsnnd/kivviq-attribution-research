import { describe, expect, it } from "vitest";
import {
  CausalGraphError,
  descendantsOf,
  validateCausalGraph,
  type CausalGraph,
} from "../../src/ground_truth/causal-graph.js";

describe("causal graph", () => {
  it("rejects instantaneous cycles", () => {
    const graph: CausalGraph = {
      nodes: [
        {
          id: "a",
          domain: "demand",
          temporalScope: "time_indexed",
          valueType: "number",
          unit: "units",
          intervenable: false,
          visibility: "latent",
        },
        {
          id: "b",
          domain: "commerce",
          temporalScope: "time_indexed",
          valueType: "number",
          unit: "orders",
          intervenable: false,
          visibility: "perfect_observation",
        },
      ],
      edges: [
        { parent: "a", child: "b", relationship: "direct", mechanismId: "m1" },
        { parent: "b", child: "a", relationship: "direct", mechanismId: "m2" },
      ],
    };

    expect(() => validateCausalGraph(graph)).toThrow(CausalGraphError);
  });

  it("allows explicitly lagged feedback only on time-indexed nodes", () => {
    const graph: CausalGraph = {
      nodes: [
        {
          id: "awareness",
          domain: "customer",
          temporalScope: "time_indexed",
          valueType: "number",
          unit: "probability",
          intervenable: false,
          visibility: "latent",
        },
        {
          id: "search",
          domain: "marketing",
          temporalScope: "time_indexed",
          valueType: "number",
          unit: "probability",
          intervenable: false,
          visibility: "latent",
        },
      ],
      edges: [
        {
          parent: "awareness",
          child: "search",
          relationship: "direct",
          mechanismId: "m1",
        },
        {
          parent: "search",
          child: "awareness",
          relationship: "direct",
          mechanismId: "m2",
          lagSeconds: 3600 as never,
        },
      ],
    };

    expect(() => validateCausalGraph(graph)).not.toThrow();
  });

  it("computes causal descendants for counterfactual scope checks", () => {
    const graph: CausalGraph = {
      nodes: [
        {
          id: "spend",
          domain: "marketing",
          temporalScope: "time_indexed",
          valueType: "number",
          unit: "money_minor",
          intervenable: true,
          visibility: "merchant_observation",
        },
        {
          id: "exposure",
          domain: "marketing",
          temporalScope: "time_indexed",
          valueType: "number",
          unit: "impressions",
          intervenable: false,
          visibility: "perfect_observation",
        },
        {
          id: "orders",
          domain: "commerce",
          temporalScope: "time_indexed",
          valueType: "number",
          unit: "orders",
          intervenable: false,
          visibility: "perfect_observation",
        },
      ],
      edges: [
        {
          parent: "spend",
          child: "exposure",
          relationship: "direct",
          mechanismId: "curve",
        },
        {
          parent: "exposure",
          child: "orders",
          relationship: "direct",
          mechanismId: "effect",
        },
      ],
    };

    expect([...descendantsOf(graph, "spend")].sort()).toEqual(["exposure", "orders"]);
  });
});
