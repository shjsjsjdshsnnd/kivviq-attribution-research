import { actionRiskMeasurementContractsSchema, type ActionRiskMeasurementContracts } from "./schema.js";

export interface LegacyRiskAdapterInput {
  registeredContracts: readonly { legacyRef: string; contract: unknown }[];
  legacyRefs: readonly string[];
  downsideDefinitions?: readonly string[];
  informationGaps?: readonly string[];
}

/** Exact registered references only. Narrative risk text is deliberately ignored. */
export function adaptLegacyRiskDimensions(input: LegacyRiskAdapterInput): { riskDimensions: { state: "ABSENT" } | { state: "PRESENT"; value: ActionRiskMeasurementContracts }; unmappedRefs: string[] } {
  const accepted: ActionRiskMeasurementContracts[] = [], unmappedRefs: string[] = [];
  for (const ref of input.legacyRefs) {
    const matches = input.registeredContracts.filter((entry) => entry.legacyRef === ref);
    const parsed = matches.length === 1 ? actionRiskMeasurementContractsSchema.safeParse(matches[0]!.contract) : undefined;
    if (parsed?.success) accepted.push(parsed.data);
    else unmappedRefs.push(ref);
  }
  const uniqueRequested = new Set(input.legacyRefs);
  if (accepted.length !== 1 || uniqueRequested.size !== input.legacyRefs.length || input.legacyRefs.length !== 1) {
    unmappedRefs.push(...input.legacyRefs);
    accepted.length = 0;
  }
  return {
    riskDimensions: accepted.length === 1
      ? { state: "PRESENT", value: accepted[0]! }
      : { state: "ABSENT" },
    unmappedRefs: [...new Set(unmappedRefs)].sort(),
  };
}
