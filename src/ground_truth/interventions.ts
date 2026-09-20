import type { DurationSeconds, UtcTimestamp } from "../core/units.js";
import type { CausalGraph, CausalNode } from "./causal-graph.js";
import type {
  CausalVariableId,
  PopulationSelector,
  WorldId,
} from "./ontology.js";
import {
  counterfactualRequestRuntimeSchema,
  formatRuntimeSchemaIssues,
  interventionRuntimeSchema,
} from "./runtime-schema.js";

export type InterventionValue =
  | {
      readonly kind: "number";
      readonly value: number;
      readonly unit: CausalNode["unit"];
    }
  | { readonly kind: "boolean"; readonly value: boolean }
  | { readonly kind: "category"; readonly value: string };

export interface Intervention {
  readonly variable: CausalVariableId;
  readonly operation: "set";
  readonly value: InterventionValue;
  readonly effectiveAt?: UtcTimestamp;
  readonly durationSeconds?: DurationSeconds;
  readonly population?: PopulationSelector;
}

export interface InterventionDefinition {
  readonly variable: CausalVariableId;
  readonly allowedOperation: "set";
  readonly description: string;
}

export interface CounterfactualRequest {
  readonly factualWorldId: WorldId;
  readonly interventions: readonly Intervention[];
  readonly randomSeedPolicy: "shared";
}

export class InterventionError extends Error {}

export function validateIntervention(
  graph: CausalGraph,
  intervention: Intervention,
): void {
  const runtime = interventionRuntimeSchema.safeParse(intervention);
  if (!runtime.success) {
    throw new InterventionError(
      `invalid intervention: ${formatRuntimeSchemaIssues(runtime.error)}`,
    );
  }

  const node = graph.nodes.find(
    (candidate) => candidate.id === intervention.variable,
  );

  if (!node) {
    throw new InterventionError(
      `unknown intervention variable: ${intervention.variable}`,
    );
  }

  if (!node.intervenable) {
    throw new InterventionError(
      `variable is not intervenable: ${intervention.variable}`,
    );
  }

  if (intervention.value.kind !== node.valueType) {
    throw new InterventionError(
      `intervention value kind ${intervention.value.kind} does not match node type ${node.valueType}`,
    );
  }

  if (intervention.value.kind === "number") {
    if (intervention.value.unit !== node.unit) {
      throw new InterventionError(
        `intervention unit ${intervention.value.unit} does not match node unit ${node.unit}`,
      );
    }
  }
}

export function validateCounterfactualRequest(
  graph: CausalGraph,
  request: CounterfactualRequest,
): void {
  const runtime = counterfactualRequestRuntimeSchema.safeParse(request);
  if (!runtime.success) {
    throw new InterventionError(
      `invalid counterfactual request: ${formatRuntimeSchemaIssues(runtime.error)}`,
    );
  }

  for (const intervention of request.interventions) {
    validateIntervention(graph, intervention);
  }
}
