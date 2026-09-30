import {
  evidenceRefSchema,
  type AuthoritativeSource,
  type BusinessStateCollectionRequest,
  type BusinessStateEvidenceProvider,
  type BusinessStateSnapshot,
  type CanonicalMetricId,
  type EvidenceRef,
  type EvidenceRequest,
} from "./schema.js";
import { collectBusinessState } from "./collector.js";
import {
  defaultBusinessConstraintDefinitions,
  withBusinessConstraints,
  type BusinessConstraintDefinition,
} from "./constraints.js";
import { withDerivedStateSignals } from "./signals.js";

export type SourceEvidenceFetcher = (
  request: EvidenceRequest & { readonly source: AuthoritativeSource },
) => Promise<EvidenceRef | null>;

export class GovernedProviderAdapter
  implements BusinessStateEvidenceProvider
{
  readonly #fetchers: Readonly<
    Partial<Record<AuthoritativeSource, SourceEvidenceFetcher>>
  >;

  constructor(
    fetchers: Readonly<
      Partial<Record<AuthoritativeSource, SourceEvidenceFetcher>>
    >,
  ) {
    this.#fetchers = fetchers;
  }

  async getEvidence(request: EvidenceRequest): Promise<EvidenceRef | null> {
    for (const source of request.sourceCandidates) {
      const fetcher = this.#fetchers[source];
      if (fetcher === undefined) continue;
      const result = await fetcher({ ...request, source });
      if (result === null) continue;
      const parsed = evidenceRefSchema.parse(result);
      if (
        parsed.metricId !== request.metricId ||
        parsed.periodKind !== request.periodKind ||
        parsed.source !== source
      ) {
        throw new RangeError(
          "Provider returned evidence bound to the wrong metric, period or source",
        );
      }
      return parsed;
    }
    return null;
  }
}

export interface GovernedStateAssertion {
  readonly metricId: CanonicalMetricId;
  readonly expectedValue: number | null;
  readonly tolerance: number;
  readonly provenance: string;
}

export interface ShadowMetricComparison {
  readonly metricId: CanonicalMetricId;
  readonly expectedValue: number | null;
  readonly representedValue: number | null;
  readonly tolerance: number;
  readonly matched: boolean;
  readonly provenance: string;
}

export interface BusinessStateShadowResult {
  readonly snapshot: BusinessStateSnapshot;
  readonly comparisons: readonly ShadowMetricComparison[];
  readonly matchedCount: number;
  readonly mismatchCount: number;
  readonly shadowPassed: boolean;
  readonly automaticDecisionAllowed: false;
  readonly productionMutationAllowed: false;
}

function withinTolerance(
  expected: number | null,
  actual: number | null,
  tolerance: number,
): boolean {
  if (expected === null || actual === null) return expected === actual;
  return Math.abs(expected - actual) <= tolerance;
}

export async function runBusinessStateShadowMode(
  request: BusinessStateCollectionRequest,
  provider: BusinessStateEvidenceProvider,
  assertions: readonly GovernedStateAssertion[],
  constraintDefinitions?: readonly BusinessConstraintDefinition[],
): Promise<BusinessStateShadowResult> {
  const collected = await collectBusinessState(request, provider);
  const signaled = withDerivedStateSignals(collected);
  const constrained = withBusinessConstraints(
    signaled,
    constraintDefinitions ?? defaultBusinessConstraintDefinitions(signaled),
  );

  const comparisons = assertions.map((assertion) => {
    if (assertion.tolerance < 0 || !Number.isFinite(assertion.tolerance)) {
      throw new RangeError("Shadow comparison tolerance must be non-negative");
    }
    const representedValue =
      constrained.metrics.find(
        (metric) => metric.metricId === assertion.metricId,
      )?.current ?? null;
    return {
      metricId: assertion.metricId,
      expectedValue: assertion.expectedValue,
      representedValue,
      tolerance: assertion.tolerance,
      matched: withinTolerance(
        assertion.expectedValue,
        representedValue,
        assertion.tolerance,
      ),
      provenance: assertion.provenance,
    };
  });

  const matchedCount = comparisons.filter(
    (comparison) => comparison.matched,
  ).length;
  const mismatchCount = comparisons.length - matchedCount;

  return {
    snapshot: constrained,
    comparisons,
    matchedCount,
    mismatchCount,
    shadowPassed: mismatchCount === 0,
    automaticDecisionAllowed: false,
    productionMutationAllowed: false,
  };
}
