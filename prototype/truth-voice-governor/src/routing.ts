export interface ConversationRoutingState { kivviqEstablished: boolean }
export function routeEvidenceRequest(message: string, state: ConversationRoutingState): 'kivviq' | 'unspecified' {
  if (/\bkivviq\b/i.test(message)) return 'kivviq'
  if (state.kivviqEstablished && /\b(revenue|profit|sales|spend|orders|roas|meta|google|pinterest)\b/i.test(message)) return 'kivviq'
  return 'unspecified'
}
