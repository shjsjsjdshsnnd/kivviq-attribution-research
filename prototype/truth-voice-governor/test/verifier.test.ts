import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ADVERSARIAL_FIXTURES,
  makeValidDraft,
  materializeFixture,
  verifyDraft,
  type DraftAnswer,
  type ViolationCode,
} from '../src/index.js'

function expectViolation(draft: DraftAnswer, fixtureIndex: number, code: ViolationCode): void {
  const spec = materializeFixture(ADVERSARIAL_FIXTURES[fixtureIndex]!)
  const result = verifyDraft(spec, draft)
  assert.equal(result.status, 'FAIL')
  assert.ok(result.violations.some((item) => item.code === code), code)
}

test('valid governed drafts pass across all adversarial fixtures', () => {
  for (const fixture of ADVERSARIAL_FIXTURES) {
    const spec = materializeFixture(fixture)
    const result = verifyDraft(spec, makeValidDraft(spec))
    assert.equal(result.status, 'PASS', fixture.id + ': ' + JSON.stringify(result.violations))
  }
})

test('altered and fabricated numbers are rejected', () => {
  const spec = materializeFixture(ADVERSARIAL_FIXTURES[10]!)
  const valid = makeValidDraft(spec)
  expectViolation(
    {
      ...valid,
      text: 'Observed ROAS was 8.912x.',
      numericMentions: [{ claimId: 'roas', value: 8.912 }],
    },
    10,
    'ALTERED_NUMBER',
  )
  expectViolation({ ...valid, text: 'An unrelated metric was 9999.' }, 10, 'FABRICATED_NUMBER')
})

test('unsupported causal escalation is rejected', () => {
  const spec = materializeFixture(ADVERSARIAL_FIXTURES[8]!)
  const valid = makeValidDraft(spec)
  expectViolation(
    {
      ...valid,
      text: 'Higher spend caused higher revenue.',
      claimLanguage: [{ claimId: 'correlation', strength: 'CAUSAL' }],
    },
    8,
    'UNSUPPORTED_CAUSAL_LANGUAGE',
  )
})

test('material contradictions cannot be omitted', () => {
  const spec = materializeFixture(ADVERSARIAL_FIXTURES[0]!)
  const valid = makeValidDraft(spec)
  expectViolation({ ...valid, acknowledgedContradictionIds: [] }, 0, 'MATERIAL_CONTRADICTION_OMITTED')
})

test('UNKNOWN cannot become an assertion and cannot be silently omitted', () => {
  const spec = materializeFixture(ADVERSARIAL_FIXTURES[4]!)
  const valid = makeValidDraft(spec)
  expectViolation(
    {
      ...valid,
      usedClaimIds: ['revenue-unknown'],
      claimLanguage: [{ claimId: 'revenue-unknown', strength: 'ASSERTIVE' }],
    },
    4,
    'UNKNOWN_AS_ASSERTION',
  )
  expectViolation({ ...valid, acknowledgedUnknownClaimIds: [] }, 4, 'REQUIRED_UNKNOWN_OMITTED')
})

test('recommendation must match the Decision Engine exactly', () => {
  const spec = materializeFixture(ADVERSARIAL_FIXTURES[2]!)
  const valid = makeValidDraft(spec)
  expectViolation(
    { ...valid, recommendation: { state: 'SCALE', target: spec.decision.target } },
    2,
    'UNAUTHORIZED_RECOMMENDATION',
  )
})

test('wrong source attribution and unsupported merchant thresholds are rejected', () => {
  const spec = materializeFixture(ADVERSARIAL_FIXTURES[10]!)
  const valid = makeValidDraft(spec)
  expectViolation(
    { ...valid, sourceAttributions: [{ claimId: 'roas', sourceId: 'shopify' }] },
    10,
    'INCORRECT_SOURCE_ATTRIBUTION',
  )

  const noEconomicsSpec = materializeFixture(ADVERSARIAL_FIXTURES[1]!)
  const noEconomicsValid = makeValidDraft(noEconomicsSpec)
  expectViolation(
    { ...noEconomicsValid, merchantThresholdMentions: [{ key: 'breakEvenRoas', value: 2.7 }] },
    1,
    'UNSUPPORTED_MERCHANT_THRESHOLD',
  )
})

test('positive spin, excessive hedging, hidden low confidence, and false-premise agreement are rejected', () => {
  const negativeSpec = materializeFixture(ADVERSARIAL_FIXTURES[2]!)
  const negativeValid = makeValidDraft(negativeSpec)
  expectViolation({ ...negativeValid, text: 'Performance is encouraging.' }, 2, 'POSITIVE_SPIN_CONTRADICTS_CONCLUSION')

  const strongSpec = materializeFixture(ADVERSARIAL_FIXTURES[1]!)
  const strongValid = makeValidDraft(strongSpec)
  expectViolation({ ...strongValid, text: 'Maybe the governed evidence supports the stated decision.' }, 1, 'EXCESSIVE_HEDGING')

  const lowSpec = materializeFixture(ADVERSARIAL_FIXTURES[11]!)
  const lowValid = makeValidDraft(lowSpec)
  expectViolation(
    { ...lowValid, acknowledgedDisclosureIds: lowValid.acknowledgedDisclosureIds.filter((id) => id !== 'LOW_CONFIDENCE') },
    11,
    'LOW_CONFIDENCE_HIDDEN',
  )

  const premiseSpec = materializeFixture(ADVERSARIAL_FIXTURES[9]!)
  const premiseValid = makeValidDraft(premiseSpec)
  expectViolation({ ...premiseValid, premiseCorrected: false }, 9, 'FALSE_PREMISE_NOT_CORRECTED')
})
