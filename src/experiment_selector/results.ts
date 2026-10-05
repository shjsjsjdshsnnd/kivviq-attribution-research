import { fingerprint, SELECTOR_VERSION, type CausalRecord, type CheckStatus, type Context, type ExperimentSpec, type ReasonCode } from './core.js'

export interface ArmSummary { assigned: number; measured: number; sum: number; sumSquares: number }
export interface MetricObservation { metricRef: string; definitionRef: string; control: ArmSummary; treatment: ArmSummary }
export interface ExperimentResultInput {
  workspaceId: string; snapshotId: string; experimentId: string; specificationFingerprint: string;
  resultRef: string; revision: number; completedAt: string; validUntil: string;
  elapsedCompleteDays: number; preregisteredBeforeExposure: boolean;
  integrity: { assignment: CheckStatus; exposure: CheckStatus; contamination: CheckStatus; outcomeMaturity: CheckStatus; stoppingRule: CheckStatus };
  primary: MetricObservation; guardrails: readonly MetricObservation[]
}
export interface ExperimentResultAssessment {
  method: 'independent-arm-normal/1'; validity: 'VALID' | 'UNRESOLVED' | 'INVALID';
  statisticalOutcome: 'POSITIVE' | 'NEGATIVE' | 'INCONCLUSIVE' | 'UNAVAILABLE';
  economicDecision: 'ADOPT' | 'REJECT' | 'INCONCLUSIVE' | 'UNAVAILABLE';
  reasonCodes: readonly ReasonCode[]; estimate: { value: number; low: number; high: number; level: .95 } | null;
  causalEvidence: CausalRecord | null;
  learningEvent: { id: string; version: typeof SELECTOR_VERSION; experimentId: string; resultRef: string; revision: number; workspaceId: string; actionFingerprint: string; metricRef: string; populationRef: string; evidence: CausalRecord; economicDecision: ExperimentResultAssessment['economicDecision']; executionAuthorization: 'NOT_AUTHORIZED' } | null
}
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1e15
const integer = (n: unknown): n is number => finite(n) && Number.isSafeInteger(n) && n >= 0
function validArm(a: ArmSummary, binary: boolean): boolean {
  if (!a || !integer(a.assigned) || a.assigned < 2 || a.measured !== a.assigned || !finite(a.sum) || !finite(a.sumSquares) || a.sumSquares < 0) return false
  if (binary && (!integer(a.sum) || a.sum > a.measured || a.sumSquares !== a.sum)) return false
  return a.sumSquares + 1e-8 * Math.max(1, a.sumSquares) >= a.sum * a.sum / a.measured
}
function estimate(m: MetricObservation, binary: boolean) {
  if (!validArm(m.control, binary) || !validArm(m.treatment, binary)) return null
  const c = m.control, t = m.treatment
  if (binary && Math.min(c.sum, c.measured - c.sum, t.sum, t.measured - t.sum) < 10) return null
  if (!binary && Math.min(c.measured, t.measured) < 100) return null
  const cv = Math.max(0, (c.sumSquares - c.sum * c.sum / c.measured) / (c.measured - 1))
  const tv = Math.max(0, (t.sumSquares - t.sum * t.sum / t.measured) / (t.measured - 1))
  const se = Math.sqrt(cv / c.measured + tv / t.measured)
  if (!(se > 0) || !finite(se)) return null
  const value = t.sum / t.measured - c.sum / c.measured
  return { value, low: value - 1.959963984540054 * se, high: value + 1.959963984540054 * se, level: .95 as const }
}
/** Two-arm Pearson SRM diagnostic, alpha .001, 1 df. Not an efficacy test. */
export function sampleRatioMismatch(control: number, treatment: number, controlFraction: number): boolean {
  if (!integer(control) || !integer(treatment) || !(controlFraction > 0 && controlFraction < 1)) return true
  const total = control + treatment, ec = total * controlFraction, et = total - ec
  if (Math.min(ec, et) < 5) return true
  return (control - ec) ** 2 / ec + (treatment - et) ** 2 / et > 10.827566170662733
}
/**
 * Validate imported sufficient statistics; never ingest platform-attributed sales
 * as randomized arm outcomes. Persistence and provenance verification belong to
 * the trusted production adapter. Returns an append-only learning event, no I/O.
 */
export function assessExperimentResult(context: Context, spec: ExperimentSpec, raw: ExperimentResultInput): ExperimentResultAssessment {
  const empty = (reason: ReasonCode, validity: ExperimentResultAssessment['validity'] = 'INVALID'): ExperimentResultAssessment => ({ method: 'independent-arm-normal/1', validity, statisticalOutcome: 'UNAVAILABLE', economicDecision: 'UNAVAILABLE', reasonCodes: [reason], estimate: null, causalEvidence: null, learningEvent: null })
  try {
    if (!raw || !spec || !context || raw.workspaceId !== context.workspaceId || context.workspaceId !== spec.context.workspaceId || context.snapshotId !== spec.context.snapshotId || context.currency !== spec.context.currency || context.horizonDays !== spec.context.horizonDays || context.timeZone !== spec.context.timeZone || raw.snapshotId !== context.snapshotId || raw.experimentId !== spec.id || raw.specificationFingerprint !== fingerprint(spec) || !Number.isInteger(raw.revision) || raw.revision < 1 || !raw.resultRef?.trim()) return empty('RESULT_SCOPE_MISMATCH')
    if (!['customer_ab', 'audience_holdout'].includes(spec.design) || spec.randomizationUnit !== 'CUSTOMER') return empty('METHOD_NOT_IMPLEMENTED')
    const completed = Date.parse(raw.completedAt), validUntil = Date.parse(raw.validUntil)
    if (!Number.isFinite(completed) || !Number.isFinite(validUntil) || validUntil < completed || completed > Date.parse(context.asOf)) return empty('RESULT_SCOPE_MISMATCH')
    if (!raw.preregisteredBeforeExposure || !raw.integrity || ['assignment', 'exposure', 'contamination', 'stoppingRule'].some(k => raw.integrity[k as keyof typeof raw.integrity] !== 'PASS')) return empty('VALIDITY_CHECK_FAILED')
    if (raw.integrity.outcomeMaturity !== 'PASS' || !integer(raw.elapsedCompleteDays) || raw.elapsedCompleteDays < spec.power.durationDays) return empty('OUTCOMES_NOT_MATURE', 'UNRESOLVED')
    const m = raw.primary
    if (m.metricRef !== spec.primaryKpi.ref || m.definitionRef !== spec.primaryKpi.definitionRef) return empty('RESULT_SCOPE_MISMATCH')
    if (m.control.assigned < spec.power.control || m.treatment.assigned < spec.power.treatment) return empty('INSUFFICIENT_SAMPLE', 'UNRESOLVED')
    if (sampleRatioMismatch(m.control.assigned, m.treatment.assigned, spec.control.allocation)) return empty('SAMPLE_RATIO_MISMATCH')
    const effect = estimate(m, spec.primaryKpi.kind === 'binary')
    if (!effect) return empty('VALIDITY_CHECK_FAILED')
    // Guardrail estimates must cover the same assigned population; never condition
    // a profit check on only the customers who converted in each treatment arm.
    let guardrails: CheckStatus = 'PASS'
    const observed = Array.isArray(raw.guardrails) ? raw.guardrails : []
    if (observed.length !== spec.guardrails.length || new Set(observed.map(g => g.metricRef)).size !== observed.length) guardrails = 'UNKNOWN'
    for (const rule of spec.guardrails) {
      const g = observed.find(g => g.metricRef === rule.ref)
      if (!g || g.definitionRef !== rule.definitionRef || g.control.assigned !== m.control.assigned || g.treatment.assigned !== m.treatment.assigned) { if (guardrails !== 'FAIL') guardrails = 'UNKNOWN'; continue }
      // V0.1 guardrails use independent continuous outcomes. Other methods require
      // an explicit registered result adapter, not a guessed distribution.
      const ge = estimate(g, false)
      if (!ge) { if (guardrails !== 'FAIL') guardrails = 'UNKNOWN'; continue }
      const passes = rule.operator === 'AT_LEAST' ? ge.low >= rule.threshold : ge.high <= rule.threshold
      const fails = rule.operator === 'AT_LEAST' ? ge.high < rule.threshold : ge.low > rule.threshold
      if (fails) guardrails = 'FAIL'
      else if (!passes && guardrails !== 'FAIL') guardrails = 'UNKNOWN'
    }
    const sign = spec.primaryKpi.direction === 'MAXIMIZE' ? 1 : -1
    const low = sign === 1 ? effect.low : -effect.high, high = sign === 1 ? effect.high : -effect.low
    const statisticalOutcome = low > 0 ? 'POSITIVE' : high < 0 ? 'NEGATIVE' : 'INCONCLUSIVE'
    const economicDecision: ExperimentResultAssessment['economicDecision'] = guardrails === 'FAIL' || statisticalOutcome === 'NEGATIVE' ? 'REJECT' : guardrails === 'PASS' && statisticalOutcome === 'POSITIVE' && sign * effect.value >= spec.primaryKpi.minimumWorthwhileEffect ? 'ADOPT' : 'INCONCLUSIVE'
    const causalEvidence: CausalRecord = { workspaceId: context.workspaceId, actionFingerprint: spec.treatment.fingerprint, populationRef: spec.populationRef, metricRef: spec.primaryKpi.ref, horizonDays: spec.primaryKpi.outcomeHorizonDays, metricDefinitionRef: spec.primaryKpi.definitionRef, currency: context.currency, completedAt: raw.completedAt, validUntil: raw.validUntil, evidenceRef: raw.resultRef, methodology: 'randomized', validity: 'PASS', economicGuardrails: guardrails, causalClaimPermitted: true, low: effect.low, high: effect.high, level: .95 }
    const learningEvent = { id: fingerprint({ workspaceId: context.workspaceId, experimentId: spec.id, resultRef: raw.resultRef, revision: raw.revision }), version: SELECTOR_VERSION, experimentId: spec.id, resultRef: raw.resultRef, revision: raw.revision, workspaceId: context.workspaceId, actionFingerprint: spec.treatment.fingerprint, metricRef: spec.primaryKpi.ref, populationRef: spec.populationRef, evidence: causalEvidence, economicDecision, executionAuthorization: 'NOT_AUTHORIZED' as const }
    return { method: 'independent-arm-normal/1', validity: 'VALID', statisticalOutcome, economicDecision, reasonCodes: guardrails === 'FAIL' ? ['ECONOMIC_GUARDRAIL_FAILED'] : economicDecision === 'INCONCLUSIVE' ? ['RESULT_INCONCLUSIVE'] : [], estimate: effect, causalEvidence, learningEvent }
  } catch { return empty('VALIDITY_CHECK_FAILED') }
}
