# Lifecycle, population, and universal timing

The new `./canonical-action` entry point exposes Action schema **2.0.0**. Every new Action has separate `what`, optional `population` reference, and universal `timing`. Lifecycle sends and flow starts require population references. `./population` contains membership contracts; `./action-timing` contains temporal intent and resolution. None imports simulator internals or optimization policy.

```typescript
import { createCanonicalFixtures, serializeCanonicalAction } from '@kivviq/growth-operator-research/canonical-action';
import { translateBusinessAction } from '@kivviq/growth-operator-research/action-translation';

const fixtures = createCanonicalFixtures();
const winbackEmail = fixtures[0]!.action!;
const serialized = serializeCanonicalAction(winbackEmail);
// Resolved intent still needs real simulator mechanics; no effect is fabricated.
const unsupported = fixtures[29]!;
const result = translateBusinessAction(unsupported.action, unsupported.translationContext);
// result.status === 'UNSUPPORTED_SIMULATOR_CAPABILITY'
```

## Lifecycle

Seven strict provider-neutral WHAT variants cover send, start/stop/modify flow, adjust cadence, adjust contact policy, and guarded rollback. EMAIL and SMS are distinct. Cadence includes a period; contact caps and minimum spacing use separate structures. A send has instantaneous duration even when it belongs to a recurring series. Sent communications are irreversible.

Flows retain identity, ordered steps, shared timing per step, population references, eligibility/suppression evidence references, and purchase exits. Pure flow gating consumes caller-supplied membership, timing readiness, and observed purchase evidence; it never delivers a message. Readiness must come from the corresponding deterministic evaluator, and completed-purchase exit evidence means a purchase observed for the active flow entry. Stop prevents future eligible steps while retaining prior send history. Configuration, cadence and contact-policy rollback require the expected current value and exact target identity.

## Population

Definitions are strict, versioned structural rules with universes, inclusion, exclusions, logical composition, lookback windows, provenance, binding and membership mode. Revenue thresholds use major currency units (500 CAD means CAD 500); observed revenue summaries require the matching currency/window and exact evaluation instant. Conflicting duplicate summaries, including equivalent timestamp offsets, are rejected.

Evaluation returns ELIGIBLE, INELIGIBLE or UNKNOWN. Exclusion TRUE and inclusion FALSE both force INELIGIBLE; otherwise missing evidence that can affect membership remains UNKNOWN. Count coverage means the fraction of supplied customers with resolved membership, not predictive confidence. Context explicitly supplies the evaluated universe of controlled customer IDs; absence from that input makes no claim about an unobserved customer. Product/cart evidence may establish nonmembership only when its corresponding evidence-complete flag is true.

Evaluation and snapshots are distinct from definitions. Snapshots hold controlled internal IDs and their own fingerprints; snapshot factory outputs are immutable. A frozen Action must supply its exact `snapshotRef` when translated. Dynamic membership requires a fresh matching evaluation at the named binding instant. No fallback converts unknown membership into a broadcast. Merchant labels must be external aliases to exact population ID/version/fingerprint, never executable prose.

Population windows and `DAYS_SINCE_LAST_COMPLETED_ORDER` use elapsed 24-hour days; universal ActionTiming explicitly distinguishes calendar days from elapsed hours. All temporal context is supplied; there is no ambient wall-clock lookup.

## Timing

Temporal intent remains immutable. Resolution supports absolute/local, immediate, event/trigger-relative, elapsed/calendar duration, persistent policies, explicit ends, bounded recurrence, dependencies, and observed termination. Calendar arithmetic uses Temporal and IANA timezones; month overflow constrains to the last valid day. Ambiguous or nonexistent local times reject by default; callers may choose an explicit earlier/later disambiguation. Weekdays use JavaScript numbering, Sunday 0 through Saturday 6.

Occurrences retain the originating Action ID. Open recurrence needs an explicit horizon or cap; bounded recurrence reports unresolved if expansion limits prevent a complete answer. Occurrences are evidence of resolved intent, not execution orders. Unknown future events, unmet state termination, and missing dependency evidence remain unresolved. Dependency graph context must include the scheduling graph to detect cycles across Actions; self-cycles are rejected without a graph. Embedded references participate in cycle detection.

Observed event/trigger/completion/metric timestamps cannot be later than the approved clock. Planned Action start/end timestamps may be in the future. FIRST_OF can terminate on an observed alternative without waiting for an unobserved alternative; supplied observations must be authoritative as of the approved clock.

## Compatibility and translation

Historical `./action-ontology` Action 1.x readers, validation and fingerprints remain unchanged. `readCanonicalAction` dispatches by version; there is no implicit migration. `adaptLegacyAction` explicitly lifts inherited business fields into the new envelope and uses the same universal timing for advertising, pricing, promotions, shipping, merchandising, inventory and CRO. The legacy business validation projection preserves Action identity and duration classification; a calendar duration uses a positive witness only to activate inherited temporary-policy safety rules. This internal object is never serialized or executed.

Automatic migration rejects legacy lifecycle inline audience/timing, opaque condition references, and manual-reversal boundaries that require explicit structural definitions. This refusal preserves meaning. Inventory lead times and offer eligibility are still business configuration, not substitutes for ActionTiming.

The public translator dispatches schema 2.0.0 through the new membership/timing gate. It reports MISSING_CONTEXT for unresolved binding or time, INVALID_ACTION for invalid intent, and UNSUPPORTED_SIMULATOR_CAPABILITY when the simulator cannot preserve the complete semantics. No lifecycle outcome knobs, universal broadcast, or immediate-time fallback have been added. Legacy translators remain available only for historical Actions.

## Acceptance fixtures and verification

`createCanonicalFixtures()` provides all 30 numbered cases from the approved brief:

| Cases | Coverage |
|---|---|
| 1–5 | EMAIL/SMS, Friday 10:00, cadence change, channel and cross-channel caps |
| 6–11 | Winback, ordered EMAIL/SMS flow, fulfillment care, delivery review, product replenishment, one-buyer retention |
| 12–17 | Order counts, revenue/currency/window, product purchase, observed abandonment, exclusion, unknown consent |
| 18–20 | Frozen snapshot, dynamic binding, changed membership counts over time |
| 21–26 | Immediate/future/delayed/event-relative/persistent/bounded timing |
| 27–30 | Recurrence, DST, unresolved future event, unsupported simulator translation |

Run `npm run test:canonical` for focused coverage and `npm run check` for architectural boundaries, type checking, all inherited tests, and build. Prediction/desirability and PII leakage are rejected by runtime schemas, not only by tests. FNV fingerprints are deterministic reproducibility identifiers, not cryptographic proofs or authorization tokens.
