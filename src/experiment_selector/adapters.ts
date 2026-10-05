import { assessExperimentReadiness, experimentWhatSchema, type ExperimentReadinessContext } from '../experiment/index.js'
import { canonicalActionSchema, type CanonicalAction } from '../canonical_action/schema.js'
import { fingerprintCanonicalAction } from '../canonical_action/serialization.js'
import type { CandidateGate, ActionOption } from '../decision_optimizer/types.js'
import { measurementWindowFits } from './timing.js'
import { fingerprint, selectExperiment, type DesignOption, type PowerPlan, type ReadinessGateway, type SelectionInput, type Selection } from './core.js'

/**
 * Bound canonical actions are supplied by the existing Action Space. This adapter
 * never invents action envelopes, population membership, clocks or evidence.
 */
export function canonicalReadinessGateway(resolve: (input: Readonly<SelectionInput>, design: Readonly<DesignOption>, power: Readonly<PowerPlan>) => { action: CanonicalAction; context: ExperimentReadinessContext } | null): ReadinessGateway {
  return { assess(input, design, power) {
    const binding = resolve(input, design, power)
    if (!binding) return { status: 'UNKNOWN', reasons: ['CANONICAL_BINDING_REQUIRED'], evidenceRefs: [] }
    const parsed = canonicalActionSchema.safeParse(binding.action)
    if (!parsed.success) return { status: 'BLOCKED', reasons: ['INVALID_CANONICAL_EXPERIMENT'], evidenceRefs: ['selector:contract'] }
    const w = experimentWhatSchema.safeParse(parsed.data.what)
    if (!w.success) return { status: 'BLOCKED', reasons: ['INVALID_EXPERIMENT_ACTION'], evidenceRefs: ['selector:contract'] }
    const what = w.data, control = what.arms.find(a => a.role === 'CONTROL'), treatment = what.arms.find(a => a.role === 'TREATMENT')
    const matches = what.arms.length === 2 && control?.entityKind !== 'COMPOUND' && treatment?.entityKind !== 'COMPOUND'
      && control?.actionId === input.action.controlActionRef && control.actionFingerprint === input.action.controlFingerprint
      && treatment?.actionId === input.action.id && treatment.actionFingerprint === input.action.fingerprint
      && control.allocationBasisPoints === Math.round(design.controlFraction * 10000)
      && what.primaryMetricRef === input.objective.ref && what.randomizationUnit === design.unit
      && parsed.data.population?.populationId === input.action.populationRef
      && what.stopping.sampleTarget === power.total
      && [...(what.guardrailMetricRefs ?? [])].sort().join('|') === input.objective.guardrails.map(g => g.ref).sort().join('|')
    if (!matches) return { status: 'BLOCKED', reasons: ['EXPERIMENT_SEMANTICS_MISMATCH'], evidenceRefs: ['selector:contract'] }
    if (!measurementWindowFits({ asOf: input.context.asOf, approvedClock: binding.context.timing.approvedClock, timeZone: input.context.timeZone, horizonDays: input.context.horizonDays, start: what.measurementWindow.start, end: what.measurementWindow.end, minimumDurationDays: power.durationDays })) return { status: 'BLOCKED', reasons: ['POWERED_MEASUREMENT_WINDOW_MISMATCH'], evidenceRefs: ['selector:timing'] }
    const r = assessExperimentReadiness(binding.action, binding.context)
    return { status: r.status, reasons: r.reasonCodes, evidenceRefs: r.evidenceRefs }
  } }
}

export interface GovernedOption {
  input: SelectionInput; selection: Selection;
  /** Only an experiment bound and verified by the Action Space may be admitted. */
  experimentAction: CanonicalAction | null; readinessContext: ExperimentReadinessContext | null
}
/** Hard gate composition: attractive Twin forecasts cannot overrule the selector. */
export function experimentSelectorGate(existing: CandidateGate, resolve: (option: Readonly<ActionOption>) => GovernedOption | null): CandidateGate {
  return { assess(candidate, options) {
    for (const option of options) {
      const record = resolve(option)
      if (!record) return { status: 'UNKNOWN', reasons: ['EXPERIMENT_SELECTION_REQUIRED'] }
      const { input, selection } = record
      const gateway = canonicalReadinessGateway(() => record.experimentAction && record.readinessContext ? { action: record.experimentAction, context: record.readinessContext } : null)
      const recomputed = selectExperiment(input, gateway)
      if (fingerprint(recomputed) !== fingerprint(selection)) return { status: 'INVALID', reasons: ['STALE_OR_MODIFIED_SELECTION'] }
      if (input.context.workspaceId !== option.merchantId || input.context.snapshotId !== option.snapshotId || selection.inputFingerprint !== fingerprint(input)) return { status: 'INVALID', reasons: ['EXPERIMENT_SELECTION_CONTEXT_MISMATCH'] }
      if (option.actionType === 'experiment.run') {
        if (selection.status !== 'RUN_EXPERIMENT' || !selection.experiment || !record.experimentAction) return { status: 'INVALID', reasons: ['EXPERIMENT_NOT_SELECTED'] }
        const parsed = canonicalActionSchema.safeParse(record.experimentAction)
        if (!parsed.success || parsed.data.actionId !== option.actionId || fingerprintCanonicalAction(parsed.data) !== option.actionFingerprint) return { status: 'INVALID', reasons: ['EXPERIMENT_ACTION_BINDING_MISMATCH'] }
        const what = experimentWhatSchema.safeParse(parsed.data.what)
        if (!what.success || what.data.stopping.sampleTarget !== selection.experiment.power.total || what.data.primaryMetricRef !== selection.experiment.primaryKpi.ref || parsed.data.population?.populationId !== selection.experiment.populationRef) return { status: 'INVALID', reasons: ['EXPERIMENT_SPECIFICATION_MISMATCH'] }
        const control = what.data.arms.find(a => a.role === 'CONTROL'), treatment = what.data.arms.find(a => a.role === 'TREATMENT')
        if (what.data.arms.length !== 2 || control?.entityKind === 'COMPOUND' || treatment?.entityKind === 'COMPOUND' || control?.actionId !== selection.experiment.control.actionRef || treatment?.actionId !== selection.experiment.treatment.actionRef || control?.actionFingerprint !== selection.experiment.control.fingerprint || treatment?.actionFingerprint !== selection.experiment.treatment.fingerprint || control?.allocationBasisPoints !== Math.round(selection.experiment.control.allocation * 10000) || what.data.randomizationUnit !== selection.experiment.randomizationUnit) return { status: 'INVALID', reasons: ['EXPERIMENT_ARM_MISMATCH'] }
      } else if (selection.status !== 'ACT_NOW' || selection.proposedActionDisposition !== 'ALLOW' || input.action.id !== option.actionId || input.action.fingerprint !== option.actionFingerprint) {
        return { status: 'INVALID', reasons: ['ACTION_REQUIRES_CAUSAL_EVIDENCE_OR_EXPERIMENT'] }
      }
    }
    return existing.assess(candidate, options)
  } }
}
