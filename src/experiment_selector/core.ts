export * from './contracts.js'
import { SELECTOR_VERSION, type SelectionStatus, type CheckStatus, type Domain, type Unit, type DesignId, type MetricKind, type ReasonCode, type Check, type Context, type Action, type Guardrail, type Metric, type CausalRecord, type Economics, type Sample, type InformationModel, type DesignOption, type InvestigationOption, type SelectionInput, type PowerPlan, type ValueOfInformation, type ExperimentSpec, type Alternative, type Selection, type ReadinessGateway } from './contracts.js'

const DESIGNS: Readonly<Record<DesignId, { domains: readonly Domain[]; units: readonly Unit[]; implemented: boolean }>> = Object.freeze({
  customer_ab: { domains: ['checkout', 'pricing', 'promotion', 'shipping', 'merchandising'], units: ['CUSTOMER'], implemented: true },
  audience_holdout: { domains: ['email', 'promotion', 'paid_media'], units: ['CUSTOMER'], implemented: true },
  platform_lift: { domains: ['paid_media'], units: ['CUSTOMER'], implemented: false },
  geo_randomized: { domains: ['paid_media', 'promotion', 'pricing', 'shipping'], units: ['GEO'], implemented: false },
  switchback: { domains: ['checkout', 'shipping', 'merchandising'], units: ['TIME_BLOCK'], implemented: false },
  randomized_rollout: { domains: ['checkout', 'merchandising', 'pricing'], units: ['GEO'], implemented: false },
})
export function designRegistry() { return clone(DESIGNS) }
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) <= 1e12
const nonnegative = (x: unknown): x is number => finite(x) && x >= 0
const text = (x: unknown): x is string => typeof x === 'string' && x.trim().length > 0 && x.length <= 4000
const refs = (x: unknown): x is readonly string[] => Array.isArray(x) && x.length > 0 && x.every(text)
const date = (x: unknown): x is string => text(x) && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(x) && Number.isFinite(Date.parse(x)) && new Date(x).toISOString().slice(0, 19) === x.slice(0, 19)
const member = (x: unknown, options: readonly unknown[]) => options.includes(x)
const check = (code: ReasonCode, status: CheckStatus, detail: string, evidenceRefs: readonly string[] = []): Check => ({ code, status, detail, evidenceRefs })
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T }
function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']'
  return '{' + Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => JSON.stringify(k) + ':' + stable(v)).join(',') + '}'
}
/** Reproducibility identifier only; not a signature or an authorization token. */
export function fingerprint(value: unknown): string {
  let n = 0xcbf29ce484222325n
  for (const c of stable(value)) n = ((n ^ BigInt(c.codePointAt(0)!)) * 0x100000001b3n) & 0xffffffffffffffffn
  return 'fnv1a64:' + n.toString(16).padStart(16, '0')
}
function exact(value: unknown, names: string): void {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw Error('plain object required')
  const fields = names.split(' ')
  if (Object.keys(value).some(k => !fields.includes(k)) || fields.some(k => !Object.hasOwn(value, k))) throw Error('unexpected or missing fields')
}
function checkJson(value: unknown, depth = 0, seen = new Set<object>()): void {
  if (depth > 20) throw Error('input nesting limit')
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number') { if (!finite(value)) throw Error('nonfinite or unbounded number'); return }
  if (!value || typeof value !== 'object' || seen.has(value)) throw Error('not finite JSON')
  seen.add(value)
  const descriptors = Object.getOwnPropertyDescriptors(value)
  for (const [key, d] of Object.entries(descriptors)) {
    if (Array.isArray(value) && key === 'length') continue
    if (d.get || d.set || !d.enumerable) throw Error('accessor or hidden field')
    checkJson(d.value, depth + 1, seen)
  }
  seen.delete(value)
}
function assertInformation(m: InformationModel): void {
  exact(m, Object.hasOwn(m, 'planFingerprint') ? 'context actionFingerprint evidenceRefs scenarios planFingerprint' : 'context actionFingerprint evidenceRefs scenarios')
  exact(m.context, 'workspaceId snapshotId currency horizonDays')
  if (!Array.isArray(m.scenarios)) throw Error('scenarios')
  for (const w of m.scenarios) exact(w, 'id probability actionNetValue signals')
}
function assertInput(raw: SelectionInput): void {
  checkJson(raw)
  exact(raw, 'question context action objective evidence economics sample designs investigation exemption')
  const { context: c, action: a, objective: o, evidence: e } = raw
  exact(c, 'workspaceId snapshotId asOf timeZone currency horizonDays evidenceRefs')
  exact(a, 'id fingerprint domain targetRef populationRef controlActionRef controlFingerprint reversibility constraints')
  exact(o, 'ref kind direction unit minimumWorthwhileEffect definitionRef outcomeHorizonDays isContribution contributionGuardrailRef secondaryRefs guardrails')
  exact(e, 'retrieval measurement refs causal confounders')
  if (!text(raw.question) || ![c.workspaceId, c.snapshotId, c.timeZone, c.currency, a.id, a.fingerprint, a.targetRef, a.populationRef, a.controlActionRef, a.controlFingerprint, o.ref, o.unit, o.definitionRef].every(text)) throw Error('identity')
  if (a.fingerprint === a.controlFingerprint || a.id === a.controlActionRef) throw Error('identical treatment and control')
  if (!date(c.asOf) || !Number.isInteger(c.horizonDays) || c.horizonDays < 1 || c.horizonDays > 730 || !refs(c.evidenceRefs) || !/^[A-Z]{3}$/.test(c.currency)) throw Error('context')
  new Intl.DateTimeFormat('en', { timeZone: c.timeZone })
  if (!member(a.domain, ['paid_media', 'checkout', 'pricing', 'promotion', 'shipping', 'email', 'merchandising', 'remediation']) || !member(a.reversibility, ['FULL', 'PARTIAL', 'NONE', 'UNKNOWN']) || !member(a.constraints, ['PASS', 'FAIL', 'UNKNOWN'])) throw Error('action')
  if (!member(o.kind, ['binary', 'continuous']) || !member(o.direction, ['MAXIMIZE', 'MINIMIZE']) || !finite(o.minimumWorthwhileEffect) || o.minimumWorthwhileEffect <= 0 || typeof o.isContribution !== 'boolean') throw Error('objective')
  if (!Number.isInteger(o.outcomeHorizonDays) || o.outcomeHorizonDays < 1 || o.outcomeHorizonDays >= c.horizonDays) throw Error('outcome horizon')
  if (o.contributionGuardrailRef !== null && !text(o.contributionGuardrailRef)) throw Error('contribution guardrail')
  if (!Array.isArray(o.secondaryRefs) || !o.secondaryRefs.every(text) || !Array.isArray(o.guardrails)) throw Error('metrics')
  for (const g of o.guardrails) {
    exact(g, 'ref operator threshold unit definitionRef')
    if (![g.ref, g.unit, g.definitionRef].every(text) || !member(g.operator, ['AT_LEAST', 'AT_MOST']) || !finite(g.threshold)) throw Error('guardrail')
  }
  if (new Set(o.guardrails.map(g => g.ref)).size !== o.guardrails.length || o.guardrails.some(g => g.ref === o.ref)) throw Error('duplicate guardrails')
  if (o.contributionGuardrailRef && !o.guardrails.some(g => g.ref === o.contributionGuardrailRef)) throw Error('missing contribution rule')
  if (!member(e.retrieval, ['OK', 'UNAVAILABLE']) || !member(e.measurement, ['PASS', 'FAIL', 'UNKNOWN']) || !Array.isArray(e.refs) || !e.refs.every(text) || !Array.isArray(e.causal) || e.causal.length > 200 || !Array.isArray(e.confounders) || !e.confounders.every(text)) throw Error('evidence')
  for (const record of e.causal) exact(record, 'workspaceId actionFingerprint populationRef metricRef horizonDays currency completedAt validUntil evidenceRef metricDefinitionRef methodology validity economicGuardrails causalClaimPermitted low high level')
  if (!Array.isArray(raw.designs) || raw.designs.length > 32) throw Error('designs')
  const b = raw.economics
  if (b) {
    exact(b, 'plausibleUpside worstCaseActionLoss maxActionLoss maxTestLoss implementationCost materialityThreshold fullyCosted evidenceRefs')
    if (![b.plausibleUpside, b.worstCaseActionLoss, b.maxActionLoss, b.maxTestLoss, b.implementationCost, b.materialityThreshold].every(nonnegative) || typeof b.fullyCosted !== 'boolean' || !refs(b.evidenceRefs)) throw Error('economics')
  }
  const s = raw.sample
  if (s) {
    exact(s, 'populationRef unit eligibleUnits unitsPerDay enrollment outcomeLagDays minimumExposureDays baseline variance expectedEffect independentUnits distributionValidated observedAt validUntil evidenceRefs')
    if (!text(s.populationRef) || !member(s.unit, ['CUSTOMER', 'SESSION', 'GEO', 'TIME_BLOCK']) || typeof s.independentUnits !== 'boolean' || typeof s.distributionValidated !== 'boolean' || !refs(s.evidenceRefs)) throw Error('sample')
    if (s.expectedEffect !== null && !finite(s.expectedEffect)) throw Error('expected effect')
  }
  const models: InformationModel[] = []
  for (const d of raw.designs) {
    exact(d, 'id design unit populationRef capability capabilityExpiresAt assignment contamination instrumentation controlFraction maxEnrollmentDays washoutDays setupCost exposureCost delayCost worstCaseLoss operationalCheck evidenceRefs information')
    if (!text(d.id) || !Object.hasOwn(DESIGNS, d.design) || !member(d.unit, ['CUSTOMER', 'SESSION', 'GEO', 'TIME_BLOCK']) || !text(d.populationRef) || !member(d.capability, ['AVAILABLE', 'UNAVAILABLE', 'UNKNOWN']) || !date(d.capabilityExpiresAt)) throw Error('design identity')
    if (![d.assignment, d.contamination, d.instrumentation, d.operationalCheck].every(x => member(x, ['PASS', 'FAIL', 'UNKNOWN'])) || !refs(d.evidenceRefs)) throw Error('design checks')
    if (!finite(d.controlFraction) || d.controlFraction <= 0 || d.controlFraction >= 1 || !Number.isInteger(d.controlFraction * 10000) || !Number.isInteger(d.maxEnrollmentDays) || d.maxEnrollmentDays <= 0 || !Number.isInteger(d.washoutDays) || d.washoutDays < 0) throw Error('design allocation/time')
    if ([d.setupCost, d.exposureCost, d.delayCost, d.worstCaseLoss].some(x => x !== null && !nonnegative(x))) throw Error('design costs')
    if (d.information) { assertInformation(d.information); models.push(d.information) }
  }
  if (new Set(raw.designs.map(d => d.id)).size !== raw.designs.length) throw Error('duplicate design ids')
  const q = raw.investigation
  if (q) { exact(q, 'id question evidenceRequest cost delayCost durationDays information'); assertInformation(q.information); models.push(q.information) }
  const priors = models.map(m => stable([...m.scenarios].map(w => ({ id: w.id, probability: w.probability, actionNetValue: w.actionNetValue })).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)))
  if (new Set(priors).size > 1) throw Error('learning options require the same prior/scenario economics')
  if (raw.exemption) {
    exact(raw.exemption, 'kind verified proofRef replacementActionRef')
    if (!member(raw.exemption.kind, ['REMEDIATION', 'DOMINATED']) || typeof raw.exemption.verified !== 'boolean') throw Error('exemption')
  }
}
function matchingCausal(i: SelectionInput): CausalRecord[] {
  return i.evidence.causal.filter(e => e && e.workspaceId === i.context.workspaceId && e.actionFingerprint === i.action.fingerprint && e.populationRef === i.action.populationRef && e.metricRef === i.objective.ref && e.horizonDays === i.objective.outcomeHorizonDays && e.metricDefinitionRef === i.objective.definitionRef && date(e.completedAt) && Date.parse(e.completedAt) <= Date.parse(i.context.asOf) && e.currency === i.context.currency && date(e.validUntil) && Date.parse(e.validUntil) >= Date.parse(i.context.asOf) && text(e.evidenceRef) && e.validity === 'PASS' && e.causalClaimPermitted === true && member(e.methodology, ['randomized', 'qualified_quasi']) && finite(e.low) && finite(e.high) && e.low <= e.high && finite(e.level) && e.level >= .95 && e.level < 1)
}
/** Fixed alpha/power in v0.1; power is against zero, not the adoption threshold. */
export function calculatePower(i: SelectionInput, d: DesignOption): PowerPlan | null {
  const s = i.sample, delta = i.objective.minimumWorthwhileEffect, f = d.controlFraction
  if (!s || !finite(s.baseline) || !finite(delta) || delta <= 0 || !(f > 0 && f < 1) || s.independentUnits !== true || !refs(s.evidenceRefs)) return null
  const zA = 1.959963984540054, zB = .8416212335729143
  let n: number, method: PowerPlan['method']
  if (i.objective.kind === 'binary') {
    const p0 = s.baseline, p1 = p0 + (i.objective.direction === 'MAXIMIZE' ? delta : -delta)
    if (!(p0 > 0 && p0 < 1 && p1 > 0 && p1 < 1)) return null
    const pooled = f * p0 + (1 - f) * p1
    const nullVar = pooled * (1 - pooled) * (1 / f + 1 / (1 - f))
    const altVar = p0 * (1 - p0) / f + p1 * (1 - p1) / (1 - f)
    n = (zA * Math.sqrt(nullVar) + zB * Math.sqrt(altVar)) ** 2 / delta ** 2
    method = 'normal-two-proportions/1'
  } else {
    if (s.distributionValidated !== true || !finite(s.variance) || s.variance <= 0) return null
    n = (zA + zB) ** 2 * s.variance * (1 / f + 1 / (1 - f)) / delta ** 2
    method = 'normal-independent-means/1'
  }
  if (!finite(n) || n > 1e9) return null
  const control = Math.ceil(n * f), treatment = Math.ceil(n * (1 - f)), total = control + treatment
  if (i.objective.kind === 'binary') {
    const p1 = s.baseline + (i.objective.direction === 'MAXIMIZE' ? delta : -delta)
    if (Math.min(control * s.baseline, control * (1 - s.baseline), treatment * p1, treatment * (1 - p1)) < 10) return null
  } else if (Math.min(control, treatment) < 100) return null
  if (!member(s.enrollment, ['FIXED_POOL', 'ARRIVING']) || !Number.isInteger(s.eligibleUnits) || s.eligibleUnits < 0 || !Number.isInteger(s.minimumExposureDays) || s.minimumExposureDays < 1 || !Number.isInteger(s.outcomeLagDays) || s.outcomeLagDays < 0) return null
  if (s.enrollment === 'ARRIVING' && (!finite(s.unitsPerDay) || s.unitsPerDay <= 0)) return null
  const enrollmentDays = s.enrollment === 'FIXED_POOL' ? 0 : Math.ceil(Math.max(control / f, treatment / (1 - f)) / s.unitsPerDay!)
  if (s.minimumExposureDays + s.outcomeLagDays !== i.objective.outcomeHorizonDays) return null
  const durationDays = enrollmentDays + s.minimumExposureDays + s.outcomeLagDays + d.washoutDays
  const plan = { method, alpha: .05 as const, power: .8 as const, control, treatment, total, mdeAbsolute: delta, enrollmentDays, durationDays,
    limitations: ['Normal approximation at independent randomization-unit level.', '80% power to detect the minimum worthwhile effect versus zero; not 80% probability of meeting economic adoption criteria.', 'Fixed-horizon analysis; no efficacy peeking.'] }
  return { ...plan, fingerprint: fingerprint({ context: i.context, action: i.action, metric: i.objective, sample: s, designId: d.id, design: d.design, fraction: f, plan }) }
}
export function informationValue(model: InformationModel, cost: number): ValueOfInformation | null {
  if (!model || !nonnegative(cost) || !refs(model.evidenceRefs) || !Array.isArray(model.scenarios) || model.scenarios.length < 2 || model.scenarios.length > 128) return null
  const worlds: InformationModel['scenarios'] = model.scenarios
  if (new Set(worlds.map(w => w.id)).size !== worlds.length) return null
  const keys = Object.keys(worlds[0]?.signals ?? {}).sort()
  if (!keys.length || keys.length > 128 || keys.some(k => !text(k))) return null
  if (worlds.some(w => !text(w.id) || !finite(w.probability) || w.probability <= 0 || w.probability > 1 || !finite(w.actionNetValue) || !w.signals || JSON.stringify(Object.keys(w.signals).sort()) !== JSON.stringify(keys) || Object.values(w.signals).some(p => !finite(p) || p < 0 || p > 1) || Math.abs(Object.values(w.signals).reduce((a, b) => a + b, 0) - 1) > 1e-9)) return null
  if (Math.abs(worlds.reduce((a, w) => a + w.probability, 0) - 1) > 1e-9) return null
  const expectedActValue = worlds.reduce((a, w) => a + w.probability * w.actionNetValue, 0)
  const currentBestValue = Math.max(0, expectedActValue)
  const evpi = worlds.reduce((a, w) => a + w.probability * Math.max(0, w.actionNetValue), 0) - currentBestValue
  const afterLearning = keys.reduce((a, signal) => a + Math.max(0, worlds.reduce((sum, w) => sum + w.probability * w.signals[signal]! * w.actionNetValue, 0)), 0)
  const evsi = Math.max(0, Math.min(evpi, afterLearning - currentBestValue))
  return { method: 'finite-signal-evsi/1', expectedActValue, currentBestValue, evpi, evsi, cost, netLearningValue: evsi - cost, candidateValue: afterLearning - cost, evidenceRefs: model.evidenceRefs }
}
function modelMatches(i: SelectionInput, m: InformationModel | null): m is InformationModel {
  return !!m && !!m.context && m.context.workspaceId === i.context.workspaceId && m.context.snapshotId === i.context.snapshotId && m.context.currency === i.context.currency && m.context.horizonDays === i.context.horizonDays && m.actionFingerprint === i.action.fingerprint
}
function assessDesign(i: SelectionInput, d: DesignOption, gateway?: ReadinessGateway): Alternative {
  const checks: Check[] = [], definition = DESIGNS[d.design]
  const add = (code: ReasonCode, status: CheckStatus, detail: string) => checks.push(check(code, status, detail, d.evidenceRefs))
  if (!definition.domains.includes(i.action.domain) || !definition.units.includes(d.unit)) add('DESIGN_NOT_APPLICABLE', 'FAIL', 'Intervention or randomization unit is not registered for this design.')
  if (i.action.constraints !== 'PASS') add('CANONICAL_READINESS_BLOCKED', i.action.constraints, 'The proposed intervention does not have satisfied action constraints.')
  if (!definition.implemented) add('METHOD_NOT_IMPLEMENTED', 'FAIL', 'A design-specific power and result-validation adapter is required. Do not use independent-unit math for clusters or platform lift.')
  if (d.capability !== 'AVAILABLE') add(d.capability === 'UNKNOWN' ? 'CAPABILITY_UNKNOWN' : 'CAPABILITY_UNAVAILABLE', d.capability === 'UNKNOWN' ? 'UNKNOWN' : 'FAIL', 'Account-specific capability must be verified.')
  if (Date.parse(d.capabilityExpiresAt) < Date.parse(i.context.asOf)) add('STALE_CAPABILITY', 'UNKNOWN', 'Refresh capability evidence.')
  if (d.assignment !== 'PASS') add(d.assignment === 'FAIL' ? 'ASSIGNMENT_INVALID' : 'ASSIGNMENT_UNKNOWN', d.assignment, 'Persistent, uncontaminated assignment is required.')
  if (d.contamination !== 'PASS') add(d.contamination === 'FAIL' ? 'CONTAMINATION_UNCONTROLLED' : 'CONTAMINATION_UNKNOWN', d.contamination, 'Check identity leakage, concurrent interventions, calendar and carryover.')
  if (d.instrumentation !== 'PASS' || d.operationalCheck !== 'PASS') add('INSTRUMENTATION_REQUIRED', d.instrumentation === 'FAIL' || d.operationalCheck === 'FAIL' ? 'FAIL' : 'UNKNOWN', 'Outcome, contribution and guardrail measurement plus operational approval are required.')
  const s = i.sample
  if (!s) add('POWER_INPUTS_REQUIRED', 'UNKNOWN', 'Collect eligible volume, baseline, variance and outcome lag.')
  else if (s.populationRef !== i.action.populationRef || d.populationRef !== i.action.populationRef || s.unit !== d.unit) add('POPULATION_MISMATCH', 'FAIL', 'Sample, action and assignment population/unit must match.')
  if (s && s.expectedEffect !== null && Math.abs(s.expectedEffect) < i.objective.minimumWorthwhileEffect) add('EFFECT_NOT_WORTH_IMPLEMENTING', 'FAIL', 'The planning effect is below the minimum worthwhile effect; do not inflate it to make the test feasible.')
  if (s && (!date(s.observedAt) || !date(s.validUntil) || Date.parse(s.observedAt) > Date.parse(i.context.asOf) || Date.parse(s.validUntil) < Date.parse(i.context.asOf))) add('POWER_INPUTS_REQUIRED', 'UNKNOWN', 'Sample evidence is stale, future-dated or missing its validity window.')
  const power = definition.implemented ? calculatePower(i, d) : null
  if (definition.implemented && s && !power) add('POWER_APPROXIMATION_UNSAFE', 'UNKNOWN', 'A supported, validated power calculation is unavailable; use a variance pilot or specialized method.')
  if (power && s) {
    if (Math.floor(s.eligibleUnits * d.controlFraction) < power.control || Math.floor(s.eligibleUnits * (1 - d.controlFraction)) < power.treatment) add('INSUFFICIENT_SAMPLE', 'FAIL', 'Eligible independent units cannot fill both arms at this allocation.')
    if (power.enrollmentDays > d.maxEnrollmentDays || power.durationDays >= i.context.horizonDays) add('WINDOW_TOO_SHORT', 'FAIL', 'Enrollment or outcome maturity leaves no useful decision horizon.')
  }
  if ([d.setupCost, d.exposureCost, d.delayCost, d.worstCaseLoss].some(x => x === null)) add('COSTS_REQUIRED', 'UNKNOWN', 'Setup, incremental exposure, delay and worst-case cost require explicit estimates.')
  if (i.economics && d.worstCaseLoss !== null && d.worstCaseLoss + (d.setupCost ?? 0) > i.economics.maxTestLoss) add('FINANCIAL_RISK_EXCEEDED', 'FAIL', 'Maximum test-loss budget exceeded.')
  if (power) {
    try {
      const r = gateway?.assess(clone(i), clone(d), clone(power))
      if (!r || !refs(r.evidenceRefs) || r.status === 'UNKNOWN') add('CANONICAL_READINESS_UNKNOWN', 'UNKNOWN', 'Canonical action/population/portfolio readiness has not been established.')
      else if (r.status !== 'READY') add('CANONICAL_READINESS_BLOCKED', 'FAIL', r.reasons.join('; ') || 'Canonical readiness rejected the design.')
      else checks.push(check('CANONICAL_READINESS_PASSED', 'PASS', 'Canonical action/population/portfolio readiness passed.', r.evidenceRefs))
    } catch { add('CANONICAL_READINESS_UNKNOWN', 'UNKNOWN', 'Canonical readiness could not be evaluated.') }
  }
  const cost = d.setupCost !== null && d.exposureCost !== null && d.delayCost !== null ? d.setupCost + d.exposureCost + d.delayCost : null
  const information = power && cost !== null && modelMatches(i, d.information) && d.information.planFingerprint === power.fingerprint ? informationValue(d.information, cost) : null
  if (!information) add('INFORMATION_VALUE_UNKNOWN', 'UNKNOWN', 'Supply a same-horizon noisy-result model bound to this exact power plan; no invented information value.')
  else if (information.netLearningValue <= 0) add('NONPOSITIVE_INFORMATION_VALUE', 'FAIL', 'Learning benefit does not exceed setup, exposure and delay costs.')
  const admissible = !checks.some(c => c.status !== 'PASS') && !!power && !!information
  return { id: d.id, kind: 'EXPERIMENT', admissible, checks, value: information?.candidateValue ?? null, power, information }
}
export function selectExperiment(raw: SelectionInput, gateway?: ReadinessGateway): Selection {
  const alternatives: Alternative[] = [{ id: 'baseline', kind: 'BASELINE', admissible: true, checks: [], value: 0, power: null, information: null }]
  let i: SelectionInput, inputFingerprint = 'invalid'
  const finish = (status: SelectionStatus, reasons: readonly ReasonCode[], strategy: string, selected: string | null = null, disposition: Selection['proposedActionDisposition'] = 'DEFER', causal: Selection['causalStatus'] = 'NOT_IDENTIFIED', experiment: ExperimentSpec | null = null): Selection => ({
    version: SELECTOR_VERSION, status, reasonCodes: [...new Set(reasons)], proposedActionDisposition: disposition, causalStatus: causal,
    selectedActionRef: selected, alternatives, experiment, nextEvidenceStrategy: strategy,
    reviewTrigger: 'Reassess when the evidence snapshot, capabilities, risk limits or decision horizon change.', inputFingerprint, executionAuthorization: 'NOT_AUTHORIZED',
  })
  try { assertInput(raw); i = clone(raw); inputFingerprint = fingerprint(i) } catch { return finish('INVESTIGATE_MORE', ['INVALID_INPUT'], 'Repair the selection input contract; do not authorize the proposed action.') }
  const x = i.exemption
  if (x?.verified && text(x.proofRef) && text(x.replacementActionRef) && (x.kind === 'DOMINATED' || (x.kind === 'REMEDIATION' && i.action.domain === 'remediation'))) {
    return finish('ACT_NOW', [x.kind === 'DOMINATED' ? 'DOMINATED_OPTION' : 'VERIFIED_REMEDIATION'], 'Apply only the verified mechanical remedy or non-dominated alternative; do not claim behavioral lift.', x.replacementActionRef, x.kind === 'DOMINATED' ? 'REJECT' : 'ALLOW')
  }
  if (i.evidence.retrieval !== 'OK') return finish('INVESTIGATE_MORE', ['EVIDENCE_RETRIEVAL_FAILED'], 'Retrieve the missing evidence. A failed read is not an empty experiment history.', null, 'DEFER', 'UNAVAILABLE')
  if (i.evidence.measurement !== 'PASS') return finish('INVESTIGATE_MORE', [i.evidence.measurement === 'FAIL' ? 'MEASUREMENT_INVALID' : 'MEASUREMENT_UNKNOWN'], 'Repair or verify measurement before proposing a causal experiment.')
  if (!refs(i.evidence.refs)) return finish('INVESTIGATE_MORE', ['DECISION_CONTEXT_REQUIRED'], 'Retrieve traceable evidence for the business question.')
  const b = i.economics
  if (!b || !b.fullyCosted || (!i.objective.isContribution && !text(i.objective.contributionGuardrailRef))) return finish('INVESTIGATE_MORE', ['ECONOMIC_INPUTS_REQUIRED'], 'Define contribution economics, a loss limit, and measurable profit guardrails before selecting an action or experiment.')
  if (b.plausibleUpside <= b.implementationCost) return finish('MONITOR', ['EFFECT_NOT_WORTH_IMPLEMENTING'], 'Retain the baseline: implementation cost consumes the plausible upside.', 'baseline', 'REJECT')
  if (b.plausibleUpside < b.materialityThreshold && b.worstCaseActionLoss <= b.maxActionLoss) return finish('MONITOR', ['LOW_MATERIALITY'], 'Retain the baseline and revisit only if economic exposure becomes material.', 'baseline')
  const causal = matchingCausal(i)
  const direction = i.objective.direction === 'MAXIMIZE' ? 1 : -1
  const supported = causal.length > 0 && causal.every(e => e.economicGuardrails === 'PASS' && (direction === 1 ? e.low : -e.high) >= i.objective.minimumWorthwhileEffect)
  const actAllowed = supported && b.worstCaseActionLoss <= b.maxActionLoss && i.action.reversibility !== 'UNKNOWN' && i.action.constraints === 'PASS'
  alternatives.push({ id: i.action.id, kind: 'ACT', admissible: actAllowed, checks: actAllowed ? [] : [check(supported ? 'UNACCEPTABLE_ACTION_DOWNSIDE' : 'ATTRIBUTION_NOT_INCREMENTAL', 'FAIL', 'The action needs relevant causal support and acceptable downside.', i.evidence.refs)], value: null, power: null, information: null })
  // Never pool contradictory records or extrapolate an effect to another dose.
  if (actAllowed) return finish('ACT_NOW', ['CAUSAL_EVIDENCE_SUFFICIENT'], 'Use the scoped evidence-backed action with the existing approval and rollback controls.', i.action.id, 'ALLOW', 'IDENTIFIED')
  const assessed = i.designs.map(d => assessDesign(i, d, gateway))
  alternatives.push(...assessed)
  const q = i.investigation
  if (q && text(q.id) && text(q.question) && text(q.evidenceRequest) && nonnegative(q.cost) && nonnegative(q.delayCost) && Number.isInteger(q.durationDays) && q.durationDays >= 0 && q.durationDays < i.context.horizonDays && q.cost <= b.maxTestLoss && modelMatches(i, q.information)) {
    const info = informationValue(q.information, q.cost + q.delayCost)
    alternatives.push({ id: q.id, kind: 'INVESTIGATE', admissible: !!info && info.netLearningValue > 0, checks: [], value: info?.candidateValue ?? null, power: null, information: info })
  }
  const learning = alternatives.filter(a => a.admissible && (a.kind === 'EXPERIMENT' || a.kind === 'INVESTIGATE')).sort((a, b) => (b.information!.netLearningValue - a.information!.netLearningValue) || (a.information!.cost - b.information!.cost) || ((a.power?.durationDays ?? 0) - (b.power?.durationDays ?? 0)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const best = learning[0]
  if (best?.kind === 'INVESTIGATE') return finish('INVESTIGATE_MORE', ['GATHER_EVIDENCE_FIRST'], q!.evidenceRequest, best.id)
  if (best?.kind === 'EXPERIMENT') {
    const d = i.designs.find(d => d.id === best.id)!, power = best.power!, info = best.information!
    const spec: ExperimentSpec = {
      version: SELECTOR_VERSION, context: i.context, id: `experiment:${fingerprint({ inputFingerprint, design: d.id })}`, hypothesis: `Changing ${i.action.controlActionRef} to ${i.action.id} improves ${i.objective.ref} by at least ${i.objective.minimumWorthwhileEffect} ${i.objective.unit}.`, causalQuestion: i.question,
      design: d.design, control: { actionRef: i.action.controlActionRef, fingerprint: i.action.controlFingerprint, allocation: d.controlFraction }, treatment: { actionRef: i.action.id, fingerprint: i.action.fingerprint, allocation: 1 - d.controlFraction },
      populationRef: i.action.populationRef, randomizationUnit: d.unit, primaryKpi: i.objective, secondaryKpis: i.objective.secondaryRefs, guardrails: i.objective.guardrails, power,
      stopping: { kind: 'FIXED', sampleTarget: power.total, minimumDurationDays: power.durationDays, allowEfficacyPeeking: false },
      successCriteria: 'At the preregistered mature horizon: direction-adjusted 95% interval excludes zero, point estimate meets the minimum worthwhile effect, and all economic/operational guardrails pass.',
      failureCriteria: 'Reject adoption when contribution or another guardrail fails. Otherwise an unresolved interval or insufficient economic effect is inconclusive, not proof of no effect.',
      rollbackCondition: `Stop exposure on a preregistered safety breach or test loss above ${b.maxTestLoss} ${i.context.currency}; a safety stop is not an efficacy claim.`,
      contaminationRisks: i.evidence.confounders, expectedEconomicImpact: info, requiredInstrumentation: ['Persistent random assignment', 'Assignment and exposure logs', 'All eligible units, including non-buyers', i.objective.definitionRef, 'Contribution costs and mature returns', 'Guardrail and contamination events'], inputFingerprint, executionAuthorization: 'NOT_AUTHORIZED',
    }
    return finish('RUN_EXPERIMENT', ['ATTRIBUTION_NOT_INCREMENTAL', 'POSITIVE_NET_INFORMATION_VALUE'], 'We cannot determine this causally from the existing evidence. Run the specified experiment after launch revalidation and approval.', spec.id, 'DEFER', 'NOT_IDENTIFIED', spec)
  }
  const codes = assessed.flatMap(a => a.checks.filter(c => c.status !== 'PASS').map(c => c.code))
  const hard = assessed.filter(a => a.checks.some(c => c.status === 'FAIL' && c.code !== 'NONPOSITIVE_INFORMATION_VALUE'))
  if (assessed.length && hard.length === assessed.length) return finish('EXPERIMENT_NOT_FEASIBLE', codes, 'Retain the safe baseline. Resolve the listed sample, calendar, capability or risk constraints; do not run an underpowered test.', 'baseline')
  if (assessed.some(a => a.checks.some(c => c.status === 'UNKNOWN')) || !assessed.length) return finish('INVESTIGATE_MORE', codes.length ? codes : ['NO_ADMISSIBLE_DESIGN'], 'Obtain the missing design, capability, sample or economic evidence. Do not invent a test type, holdout allocation or duration.')
  return finish('MONITOR', codes.length ? codes : ['NONPOSITIVE_INFORMATION_VALUE'], 'Keep the baseline: no feasible experiment has positive net learning value.', 'baseline')
}
