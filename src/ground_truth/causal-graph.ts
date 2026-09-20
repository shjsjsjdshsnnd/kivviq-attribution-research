import type { CausalUnit, DurationSeconds } from "../core/units.js";
import type { CausalVariableId, MechanismId } from "./ontology.js";

export type CausalDomain =
  | "customer"
  | "demand"
  | "marketing"
  | "pricing"
  | "promotion"
  | "inventory"
  | "funnel"
  | "commerce"
  | "economics"
  | "external";

export type InformationVisibility =
  | "latent"
  | "perfect_observation"
  | "merchant_observation";

export interface CausalNode {
  readonly id: CausalVariableId;
  readonly domain: CausalDomain;
  readonly temporalScope: "static" | "time_indexed";
  readonly valueType: "number" | "boolean" | "category";
  readonly unit: CausalUnit;
  readonly intervenable: boolean;
  readonly visibility: InformationVisibility;
}

export interface CausalEdge {
  readonly parent: CausalVariableId;
  readonly child: CausalVariableId;
  readonly relationship: "direct" | "mediated" | "interaction" | "constraint";
  readonly mechanismId: MechanismId;
  readonly lagSeconds?: DurationSeconds;
}

export interface CausalGraph {
  readonly nodes: readonly CausalNode[];
  readonly edges: readonly CausalEdge[];
}

export class CausalGraphError extends Error {}

export function validateCausalGraph(graph: CausalGraph): void {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node] as const));

  if (nodeById.size !== graph.nodes.length) {
    throw new CausalGraphError("causal graph contains duplicate node ids");
  }

  for (const edge of graph.edges) {
    const parent = nodeById.get(edge.parent);
    const child = nodeById.get(edge.child);

    if (!parent || !child) {
      throw new CausalGraphError(
        `causal edge references unknown node: ${edge.parent} -> ${edge.child}`,
      );
    }

    const lag = Number(edge.lagSeconds ?? 0);
    if (!Number.isFinite(lag) || lag < 0) {
      throw new CausalGraphError("causal edge lag must be finite and non-negative");
    }

    if (edge.parent === edge.child && lag === 0) {
      throw new CausalGraphError("instantaneous self-cycles are forbidden");
    }

    if (
      lag > 0 &&
      (parent.temporalScope !== "time_indexed" ||
        child.temporalScope !== "time_indexed")
    ) {
      throw new CausalGraphError(
        "lagged causal edges require time-indexed parent and child nodes",
      );
    }
  }

  // Zero-lag relationships must form a DAG. Positive-lag feedback may exist,
  // but only through explicitly time-indexed nodes.
  const adjacency = new Map<CausalVariableId, CausalVariableId[]>();
  for (const node of graph.nodes) adjacency.set(node.id, []);
  for (const edge of graph.edges) {
    if (Number(edge.lagSeconds ?? 0) === 0) {
      adjacency.get(edge.parent)?.push(edge.child);
    }
  }

  const visiting = new Set<CausalVariableId>();
  const visited = new Set<CausalVariableId>();

  const visit = (id: CausalVariableId): void => {
    if (visiting.has(id)) {
      throw new CausalGraphError("instantaneous causal graph must be acyclic");
    }
    if (visited.has(id)) return;

    visiting.add(id);
    for (const child of adjacency.get(id) ?? []) visit(child);
    visiting.delete(id);
    visited.add(id);
  };

  for (const node of graph.nodes) visit(node.id);
}

export function descendantsOf(
  graph: CausalGraph,
  variable: CausalVariableId,
): ReadonlySet<CausalVariableId> {
  const adjacency = new Map<CausalVariableId, CausalVariableId[]>();
  for (const node of graph.nodes) adjacency.set(node.id, []);
  for (const edge of graph.edges) adjacency.get(edge.parent)?.push(edge.child);

  const descendants = new Set<CausalVariableId>();
  const stack = [...(adjacency.get(variable) ?? [])];

  while (stack.length > 0) {
    const next = stack.pop();
    if (!next || descendants.has(next)) continue;
    descendants.add(next);
    stack.push(...(adjacency.get(next) ?? []));
  }

  return descendants;
}
