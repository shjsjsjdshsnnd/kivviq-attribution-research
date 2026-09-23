import type { DraftAnswer, DecisionState, MerchantEconomics } from './types.js'

export function withUnsupportedClaim(draft: DraftAnswer, claimId: string): DraftAnswer {
  return { ...draft, usedClaimIds: [...draft.usedClaimIds, claimId] }
}

export function withAlteredNumber(
  draft: DraftAnswer,
  claimId: string,
  replacement: number,
  text: string,
): DraftAnswer {
  return {
    ...draft,
    text,
    numericMentions: draft.numericMentions.map((mention) =>
      mention.claimId === claimId ? { ...mention, value: replacement } : mention,
    ),
  }
}

export function withCausalEscalation(
  draft: DraftAnswer,
  claimId: string,
  text: string,
): DraftAnswer {
  return {
    ...draft,
    text,
    claimLanguage: draft.claimLanguage.map((use) =>
      use.claimId === claimId ? { ...use, strength: 'CAUSAL' as const } : use,
    ),
  }
}

export function withoutContradiction(draft: DraftAnswer, contradictionId: string): DraftAnswer {
  return {
    ...draft,
    acknowledgedContradictionIds: draft.acknowledgedContradictionIds.filter((id) => id !== contradictionId),
  }
}

export function withRecommendation(
  draft: DraftAnswer,
  state: DecisionState,
  target: string,
): DraftAnswer {
  return { ...draft, recommendation: { state, target } }
}

export function withoutUnknown(draft: DraftAnswer, claimId: string): DraftAnswer {
  return {
    ...draft,
    acknowledgedUnknownClaimIds: draft.acknowledgedUnknownClaimIds.filter((id) => id !== claimId),
  }
}

export function withUnknownAssertion(draft: DraftAnswer, claimId: string): DraftAnswer {
  return {
    ...draft,
    usedClaimIds: [...new Set([...draft.usedClaimIds, claimId])],
    claimLanguage: [...draft.claimLanguage, { claimId, strength: 'ASSERTIVE' as const }],
  }
}

export function withPositiveSpin(draft: DraftAnswer): DraftAnswer {
  return { ...draft, text: draft.text + ' Performance is encouraging.' }
}

export function withoutDisclosure(draft: DraftAnswer, disclosureId: string): DraftAnswer {
  return {
    ...draft,
    acknowledgedDisclosureIds: draft.acknowledgedDisclosureIds.filter((id) => id !== disclosureId),
  }
}

export function withInventedThreshold(
  draft: DraftAnswer,
  key: keyof MerchantEconomics,
  value: number,
): DraftAnswer {
  return {
    ...draft,
    merchantThresholdMentions: [...draft.merchantThresholdMentions, { key, value }],
  }
}
