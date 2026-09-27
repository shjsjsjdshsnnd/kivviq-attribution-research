import { resolveActionTiming } from "../action_timing/resolution.js";
import type {
  ActionTiming,
  ActionTimingResolutionContext,
  TimingValidationStatus,
} from "../action_timing/types.js";
import type { InvestigationWhat } from "./index.js";
export interface InvestigationHorizonValidation {
  readonly status: TimingValidationStatus;
  readonly code: string;
  readonly executionEnd?: string;
  readonly maximumEnd?: string;
}
/** Compare actual execution with a separately resolved cap using shared calendar semantics. */
export function validateInvestigationExecutionHorizon(
  what: InvestigationWhat,
  timing: ActionTiming,
  context: ActionTimingResolutionContext,
): InvestigationHorizonValidation {
  const execution = resolveActionTiming(timing, context);
  if (execution.status !== "VALID")
    return {
      status: execution.status,
      code: "INVESTIGATION_EXECUTION_TIMING_NOT_RESOLVED",
    };
  if (
    timing.duration.state === "SPECIFIED" &&
    timing.duration.value.kind === "PERSISTENT"
  )
    return {
      status: "INVALID",
      code: "INVESTIGATION_EXECUTION_MUST_BE_FINITE",
    };
  if (!execution.resolvedEnd)
    return {
      status: "UNRESOLVED",
      code: "INVESTIGATION_EXECUTION_END_REQUIRED",
    };
  const maximum = resolveActionTiming(
    {
      ...timing,
      duration: { state: "SPECIFIED", value: what.maximumInvestigationHorizon },
      end: { state: "ABSENT" },
    },
    context,
  );
  if (maximum.status !== "VALID" || !maximum.resolvedEnd)
    return {
      status: maximum.status === "INVALID" ? "INVALID" : "UNRESOLVED",
      code: "INVESTIGATION_MAXIMUM_HORIZON_NOT_RESOLVED",
    };
  const exceeds =
    Date.parse(execution.resolvedEnd) > Date.parse(maximum.resolvedEnd);
  return {
    status: exceeds ? "INVALID" : "VALID",
    code: exceeds
      ? "INVESTIGATION_MAXIMUM_HORIZON_EXCEEDED"
      : "INVESTIGATION_WITHIN_MAXIMUM_HORIZON",
    executionEnd: execution.resolvedEnd,
    maximumEnd: maximum.resolvedEnd,
  };
}
