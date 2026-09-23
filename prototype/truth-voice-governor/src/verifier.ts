import { governEvidence } from './evidence.js'
import { claimById, LANGUAGE_RANK } from './claim-ledger.js'
import { merchantThresholdValue } from './economics.js'
import { parseDraftAnswer } from './schemas.js'
import type {
  AnswerSpec,
  DraftAnswer,
  MerchantEconomics,
  VerificationResult,
  VerificationViolation,
  ViolationCode,
} from './types.js'

function sameNumber(left: number, right: number): boolean {
  const scale = Math.max(1, Math.abs(left), Math.abs(right))
  return Math.abs(left - right) <= Number.EPSILON * 16 * scale
}

function violation(
  code: ViolationCode,
  message: string,
  extras: Pick<VerificationViolation, 'claimId' | 'contradictionId'> = {},
): VerificationViolation {
  return { code, message, ...extras }
}

function parseTextNumbers(text: string): number[] {
  const matches = text.match(/[-+]?\$?\d[\d,]*(?:\.\d+)?(?:%|x)?/gi) ?? []
  return matches
    .map((raw) => {
      const percent = raw.endsWith('%')
      const cleaned = raw.replace(/[$,%x]/gi, '')
      const value = Number(cleaned)
      return percent ? value / 100 : value
    })
    .filter((value) => Number.isFinite(value))
}

function claimNumbers(spec: AnswerSpec): number[] {
  return spec.claimLedger.claims.flatMap((claim) => {
    const values: number[] = []
    if (claim.currentValue) values.push(claim.currentValue.value)
    if (claim.comparisonValue) values.push(claim.comparisonValue.value)
    return values
  })
}

function thresholdMentionSupported(
  economics: MerchantEconomics,
  mention: DraftAnswer['merchantThresholdMentions'][number],
): boolean {
  const value = merchantThresholdValue(economics, mention.key)
  return value !== undefined && sameNumber(value, mention.value)
}

function hasUnsupportedCausalText(text: string): boolean {
  return /\b(caused?|drove|drives|driven|resulted in|because of|led to|leads to)\b/i.test(text)
}

function countHedges(text: string): number {
  const matches = text.match(/\b(maybe|perhaps|possibly|might|could be|it seems|arguably|potentially)\b/gi)
  return matches?.length ?? 0
}

function hasPositiveSpin(text: string): boolean {
  return /\b(encouraging|promising|strong performance|healthy performance|excellent|great result|positive momentum)\b/i.test(text)
}

function hasGenericConsultantLanguage(text: string): boolean {
  return /\b(unlock growth|leverage synergies|holistic strategy|strategic opportunity|optimize strategically|best-in-class)\b/i.test(text)
}

function escapeRegex(value: string): string {
  const special = '\\^$.*+?()[]{}|'
  return [...value].map((character) => special.includes(character) ? '\\' + character : character).join('')
}

function assertsUnknownAsZero(spec: AnswerSpec, text: string): boolean {
  return spec.claimLedger.claims
    .filter((claim) => claim.type === 'UNKNOWN')
    .some((claim) => {
      const metric = escapeRegex(claim.metric.name)
      return new RegExp('\\b' + metric + '\\b.{0,30}\\b(?:was|is|=)\\s*\\$?0(?:\\.0+)?\\b', 'i').test(text)
    })
}

function presentsAttributionAsIncrementality(spec: AnswerSpec, text: string): boolean {
  const hasAttributedSupport = spec.claimLedger.claims.some(
    (claim) => claim.type !== 'UNKNOWN' && /attributed/i.test(claim.metric.id),
  )
  const hasKnownIncremental = spec.claimLedger.claims.some(
    (claim) => claim.type !== 'UNKNOWN' && /incremental/i.test(claim.metric.id),
  )
  if (!hasAttributedSupport || hasKnownIncremental) return false
  return /\b(?:generated|produced|delivered|drove)\b.{0,50}\bincremental\b|\bincremental revenue\b.{0,20}\b(?:was|is)\b\s*\$?\d/i.test(text)
}

export function verifyDraft(spec: AnswerSpec, draft: DraftAnswer): VerificationResult {
  const violations: VerificationViolation[] = []
  if (spec.evidenceRequest) {
    const governed = governEvidence(spec.evidenceRequest, spec.evidence ?? [])
    if (governed.primary.length === 0 && draft.usedClaimIds.length) violations.push(violation('SEMANTIC_EVIDENCE_MISMATCH', 'No compatible primary evidence supports this answer.'))
  }
  const knownClaimIds = new Set(spec.claimLedger.claims.map((claim) => claim.id))

  for (const id of draft.usedClaimIds) {
    if (!knownClaimIds.has(id)) {
      violations.push(violation('UNSUPPORTED_CLAIM', 'Draft references a claim outside the governed ledger.', { claimId: id }))
    }
  }

  for (const use of draft.claimLanguage) {
    const claim = claimById(spec.claimLedger, use.claimId)
    if (!claim) {
      violations.push(violation('UNSUPPORTED_CLAIM', 'Language annotation references a missing claim.', { claimId: use.claimId }))
      continue
    }
    if (claim.type === 'UNKNOWN' && use.strength !== 'UNKNOWN_ONLY') {
      violations.push(violation('UNKNOWN_AS_ASSERTION', 'UNKNOWN was converted into an assertion.', { claimId: claim.id }))
    }
    if (LANGUAGE_RANK[use.strength] > LANGUAGE_RANK[claim.allowedLanguage]) {
      violations.push(violation('LANGUAGE_STRENGTH_EXCEEDED', 'Draft wording is stronger than the claim permits.', { claimId: claim.id }))
      if (use.strength === 'CAUSAL' && claim.allowedLanguage !== 'CAUSAL') {
        violations.push(violation('UNSUPPORTED_CAUSAL_LANGUAGE', 'Causal language is not permitted for this claim.', { claimId: claim.id }))
      }
    }
  }

  for (const mention of draft.numericMentions) {
    if (!mention.claimId) continue
    const claim = claimById(spec.claimLedger, mention.claimId)
    if (!claim) {
      violations.push(violation('UNSUPPORTED_CLAIM', 'Numeric annotation references a missing claim.', { claimId: mention.claimId }))
      continue
    }
    const allowed = [claim.currentValue?.value, claim.comparisonValue?.value].filter(
      (value): value is number => value !== undefined,
    )
    if (!allowed.some((value) => sameNumber(value, mention.value))) {
      violations.push(violation('ALTERED_NUMBER', 'Numeric value does not match the governed claim.', { claimId: claim.id }))
    }
  }

  for (const attribution of draft.sourceAttributions) {
    const claim = claimById(spec.claimLedger, attribution.claimId)
    if (!claim || !claim.sourceIds.includes(attribution.sourceId)) {
      violations.push(violation('INCORRECT_SOURCE_ATTRIBUTION', 'Claim was attributed to an unsupported source.', { claimId: attribution.claimId }))
    }
  }

  for (const id of spec.requiredContradictionIds) {
    if (!draft.acknowledgedContradictionIds.includes(id)) {
      violations.push(violation('MATERIAL_CONTRADICTION_OMITTED', 'A material unresolved contradiction was omitted.', { contradictionId: id }))
    }
  }

  for (const id of spec.unknownClaimIds) {
    if (!draft.acknowledgedUnknownClaimIds.includes(id)) {
      violations.push(violation('REQUIRED_UNKNOWN_OMITTED', 'A governed UNKNOWN was not preserved in the answer.', { claimId: id }))
    }
  }

  if (draft.recommendation) {
    if (
      spec.decision.state === 'INSUFFICIENT_EVIDENCE' ||
      draft.recommendation.state !== spec.decision.state ||
      draft.recommendation.target !== spec.decision.target
    ) {
      violations.push(violation('UNAUTHORIZED_RECOMMENDATION', 'Recommendation does not match the Decision Engine output.'))
    }
  }

  const supportedThresholdValues: number[] = []
  for (const mention of draft.merchantThresholdMentions) {
    if (!thresholdMentionSupported(spec.merchantEconomics, mention)) {
      violations.push(violation('UNSUPPORTED_MERCHANT_THRESHOLD', 'Merchant threshold was absent or altered.'))
    } else {
      supportedThresholdValues.push(mention.value)
    }
  }

  if (assertsUnknownAsZero(spec, draft.text)) {
    violations.push(violation('MISSING_AS_ZERO', 'Unavailable evidence was converted into zero.'))
    violations.push(violation('UNKNOWN_AS_ASSERTION', 'UNKNOWN evidence was asserted as a zero value.'))
  }

  if (presentsAttributionAsIncrementality(spec, draft.text)) {
    violations.push(violation('ATTRIBUTION_AS_INCREMENTALITY', 'Platform-attributed revenue was presented as incremental revenue.'))
  }

  if (hasGenericConsultantLanguage(draft.text)) {
    violations.push(violation('GENERIC_CONSULTANT_LANGUAGE', 'Draft uses generic consultant language prohibited by the response contract.'))
  }

  if (
    (spec.conclusion.polarity === 'NEGATIVE' || spec.conclusion.polarity === 'UNCERTAIN') &&
    hasPositiveSpin(draft.text)
  ) {
    violations.push(violation('POSITIVE_SPIN_CONTRADICTS_CONCLUSION', 'Draft adds positive spin that contradicts the governed conclusion.'))
  }

  const usedClaims = draft.usedClaimIds
    .map((id) => claimById(spec.claimLedger, id))
    .filter((claim) => claim !== undefined)
  const allUsedClaimsAreStrong =
    usedClaims.length > 0 &&
    usedClaims.every((claim) => claim.allowedLanguage === 'ASSERTIVE' || claim.allowedLanguage === 'CAUSAL')
  if (
    spec.decision.confidence >= 0.85 &&
    spec.requiredDisclosureIds.length === 0 &&
    allUsedClaimsAreStrong &&
    countHedges(draft.text) > 0
  ) {
    violations.push(violation('EXCESSIVE_HEDGING', 'High-confidence governed conclusion was weakened by unnecessary hedging.'))
  }

  if (
    spec.requiredDisclosureIds.includes('LOW_CONFIDENCE') &&
    !draft.acknowledgedDisclosureIds.includes('LOW_CONFIDENCE')
  ) {
    violations.push(violation('LOW_CONFIDENCE_HIDDEN', 'Low decision confidence was not surfaced.'))
  }

  if (
    spec.userPremise?.status === 'CONTRADICTED' &&
    draft.premiseCorrected !== true
  ) {
    violations.push(violation('FALSE_PREMISE_NOT_CORRECTED', 'Contradicted user premise was not challenged.'))
  }

  const allowedTextNumbers = [
    ...claimNumbers(spec),
    ...supportedThresholdValues,
  ]
  for (const value of parseTextNumbers(draft.text)) {
    if (!allowedTextNumbers.some((allowed) => sameNumber(allowed, value))) {
      violations.push(violation('FABRICATED_NUMBER', 'Draft text contains a number absent from governed claims or supported merchant thresholds.'))
    }
  }

  if (hasUnsupportedCausalText(draft.text)) {
    const hasCausalPermission = draft.claimLanguage.some((use) => {
      const claim = claimById(spec.claimLedger, use.claimId)
      return use.strength === 'CAUSAL' && claim?.allowedLanguage === 'CAUSAL'
    })
    if (!hasCausalPermission) {
      violations.push(violation('UNSUPPORTED_CAUSAL_LANGUAGE', 'Draft text uses causal wording without causal permission.'))
    }
  }

  const deduped = violations.filter(
    (item, index, all) =>
      index === all.findIndex(
        (candidate) =>
          candidate.code === item.code &&
          candidate.claimId === item.claimId &&
          candidate.contradictionId === item.contradictionId,
      ),
  )

  return {
    status: deduped.length === 0 ? 'PASS' : 'FAIL',
    violations: Object.freeze(deduped),
  }
}

export function verifyUnknownDraft(spec: AnswerSpec, value: unknown): VerificationResult {
  try {
    return verifyDraft(spec, parseDraftAnswer(value))
  } catch (error: unknown) {
    return {
      status: 'FAIL',
      violations: [{
        code: 'INVALID_DRAFT_SCHEMA',
        message: error instanceof Error ? error.message : 'Draft failed schema validation.',
      }],
    }
  }
}
