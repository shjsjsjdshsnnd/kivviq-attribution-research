import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ADVERSARIAL_FIXTURES,
  allowedLanguageFor,
  buildClaimLedger,
  buildMerchantEconomics,
  compareRoasToBreakEven,
  materializeFixture,
  serializeAnswerSpec,
  type ClaimInput,
} from '../src/index.js'

const baseClaim: ClaimInput = {
  id: 'causal-test',
  type: 'CAUSAL_INFERENCE',
  metric: { id: 'revenue', name: 'revenue' },
  dimensions: {},
  period: { start: '2026-01-01', end: '2026-01-31' },
  currentValue: { value: 10, unit: 'CAD' },
  evidenceIds: ['experiment'],
  sourceIds: ['experiment'],
  provenance: {
    sourceSystem: 'experiment',
    evidenceType: 'MODELLED',
    method: 'synthetic randomized design',
    transformations: [],
  },
  measurementConfidence: 0.95,
  causalConfidence: 0.85,
  completeness: 0.9,
  materiality: 'MATERIAL',
  contradictionStatus: 'NONE',
  statement: 'The intervention caused incremental revenue in the synthetic fixture.',
}

test('epistemic ladder only permits causal wording above explicit thresholds', () => {
  assert.equal(allowedLanguageFor(baseClaim), 'CAUSAL')
  assert.equal(allowedLanguageFor({ ...baseClaim, causalConfidence: 0.79 }), 'SUGGESTIVE')
  assert.equal(allowedLanguageFor({ ...baseClaim, measurementConfidence: 0.79 }), 'SUGGESTIVE')
  assert.equal(allowedLanguageFor({ ...baseClaim, completeness: 0.69 }), 'SUGGESTIVE')
})

test('claim ledger rejects duplicate claim IDs and invalid UNKNOWN values', () => {
  assert.throws(() => buildClaimLedger([baseClaim, baseClaim]), /duplicate claim id/)
  assert.throws(
    () => buildClaimLedger([{ ...baseClaim, type: 'UNKNOWN', currentValue: { value: 0, unit: 'CAD' }, evidenceIds: [], sourceIds: [] }]),
    /UNKNOWN claim cannot carry a current value/,
  )
})

test('merchant economics only applies break-even logic when a threshold exists', () => {
  assert.equal(compareRoasToBreakEven(2.1, buildMerchantEconomics({})), 'UNKNOWN')
  assert.equal(compareRoasToBreakEven(2.1, buildMerchantEconomics({ breakEvenRoas: 2.7 })), 'BELOW')
  assert.equal(compareRoasToBreakEven(2.7, buildMerchantEconomics({ breakEvenRoas: 2.7 })), 'AT')
})

test('all adversarial fixtures produce their governed decision and materiality states', () => {
  assert.equal(ADVERSARIAL_FIXTURES.length, 13)
  for (const fixture of ADVERSARIAL_FIXTURES) {
    const spec = materializeFixture(fixture)
    assert.equal(spec.materiality[0]?.state, fixture.expectedMateriality, fixture.id + ' materiality')
    assert.equal(spec.decision.state, fixture.expectedDecision, fixture.id + ' decision')
  }
})

test('same AnswerSpec produces the same compact governed payload for different model clients', () => {
  const spec = materializeFixture(ADVERSARIAL_FIXTURES[10]!)
  const generic = serializeAnswerSpec(spec, 'generic')
  const chatgpt = serializeAnswerSpec(spec, 'chatgpt-mcp')
  const claude = serializeAnswerSpec(spec, 'claude')
  assert.equal(generic.payload, chatgpt.payload)
  assert.equal(generic.payload, claude.payload)
  assert.match(chatgpt.instruction, /Client=chatgpt-mcp/)
  assert.match(claude.instruction, /Client=claude/)
})
