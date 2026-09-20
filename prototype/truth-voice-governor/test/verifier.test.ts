import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ADVERSARIAL_FIXTURES,
  makeValidDraft,
  materializeFixture,
  verifyDraft,
  verifyUnknownDraft,
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

test('runtime DraftAnswer schema rejects malformed model output', () => {
  const spec = materializeFixture(ADVERSARIAL_FIXTURES[1]!)
  const result = verifyUnknownDraft(spec, { text: 'missing required envelope fields' })
  assert.equal(result.status, 'FAIL')
  assert.ok(result.violations.some((item) => item.code === 'INVALID_DRAFT_SCHEMA'))
})

test('missing data cannot be converted into zero even when another governed metric is zero', () => {
  const spec = materializeFixture(ADVERSARIAL_FIXTURES[5]!)
  const valid = makeValidDraft(spec)
  expectViolation({ ...valid, text: 'Revenue was 0.' }, 5, 'MISSING_AS_ZERO')
})

test('platform attribution cannot be relabeled as incrementality', () => {
  const spec = materializeFixture(ADVERSARIAL_FIXTURES[6]!)
  const valid = makeValidDraft(spec)
  expectViolation(
    { ...valid, text: 'Meta generated 10000 in incremental revenue.' },
    6,
    'ATTRIBUTION_AS_INCREMENTALITY',
  )
})

test('generic consultant language is rejected by the voice contract', () => {
  const spec = materializeFixture(ADVERSARIAL_FIXTURES[1]!)
  const valid = makeValidDraft(spec)
  expectViolation(
    { ...valid, text: 'This strategic opportunity can unlock growth.' },
    1,
    'GENERIC_CONSULTANT_LANGUAGE',
  )
})
