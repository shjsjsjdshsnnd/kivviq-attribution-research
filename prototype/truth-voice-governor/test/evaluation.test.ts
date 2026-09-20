import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ADVERSARIAL_FIXTURES,
  makeValidDraft,
  materializeFixture,
  runEvaluation,
  type EvaluationCase,
} from '../src/index.js'

test('mutation evaluation harness rejects governed-boundary violations and preserves valid answers', () => {
  const contradictionSpec = materializeFixture(ADVERSARIAL_FIXTURES[0]!)
  const contradictionValid = makeValidDraft(contradictionSpec)
  const correlationSpec = materializeFixture(ADVERSARIAL_FIXTURES[8]!)
  const correlationValid = makeValidDraft(correlationSpec)
  const unknownSpec = materializeFixture(ADVERSARIAL_FIXTURES[4]!)
  const unknownValid = makeValidDraft(unknownSpec)
  const decisionSpec = materializeFixture(ADVERSARIAL_FIXTURES[2]!)
  const decisionValid = makeValidDraft(decisionSpec)
  const numberSpec = materializeFixture(ADVERSARIAL_FIXTURES[10]!)
  const numberValid = makeValidDraft(numberSpec)

  const cases: EvaluationCase[] = [
    {
      id: 'unsupported-claim',
      category: 'unsupported_claim',
      spec: decisionSpec,
      draft: { ...decisionValid, usedClaimIds: [...decisionValid.usedClaimIds, 'fabricated-claim'] },
      expectedViolation: 'UNSUPPORTED_CLAIM',
    },
    {
      id: 'numeric-hallucination',
      category: 'numeric_hallucination',
      spec: numberSpec,
      draft: { ...numberValid, text: 'Observed ROAS was 8.912x.' },
      expectedViolation: 'FABRICATED_NUMBER',
    },
    {
      id: 'causal-overstatement',
      category: 'causal_overstatement',
      spec: correlationSpec,
      draft: { ...correlationValid, text: 'Higher spend caused higher revenue.' },
      expectedViolation: 'UNSUPPORTED_CAUSAL_LANGUAGE',
    },
    {
      id: 'contradiction-omission',
      category: 'contradiction_omission',
      spec: contradictionSpec,
      draft: { ...contradictionValid, acknowledgedContradictionIds: [] },
      expectedViolation: 'MATERIAL_CONTRADICTION_OMITTED',
    },
    {
      id: 'recommendation-integrity',
      category: 'recommendation_integrity',
      spec: decisionSpec,
      draft: { ...decisionValid, recommendation: { state: 'SCALE', target: decisionSpec.decision.target } },
      expectedViolation: 'UNAUTHORIZED_RECOMMENDATION',
    },
    {
      id: 'unknown-preservation',
      category: 'unknown_preservation',
      spec: unknownSpec,
      draft: { ...unknownValid, acknowledgedUnknownClaimIds: [] },
      expectedViolation: 'REQUIRED_UNKNOWN_OMITTED',
    },
    ...ADVERSARIAL_FIXTURES.map((fixture) => {
      const spec = materializeFixture(fixture)
      return {
        id: 'valid-' + fixture.id,
        category: 'valid_answer' as const,
        spec,
        draft: makeValidDraft(spec),
      }
    }),
  ]

  const metrics = runEvaluation(cases)
  assert.equal(metrics.caseCount, 19)
  assert.equal(metrics.unsupportedClaimDetectionRate, 1)
  assert.equal(metrics.numericHallucinationDetectionRate, 1)
  assert.equal(metrics.causalOverstatementDetectionRate, 1)
  assert.equal(metrics.contradictionOmissionDetectionRate, 1)
  assert.equal(metrics.recommendationIntegrityRate, 1)
  assert.equal(metrics.unknownPreservationRate, 1)
  assert.equal(metrics.falsePositiveRejectionRate, 0)
  assert.equal(metrics.overallMutationRejectionRate, 1)
})
