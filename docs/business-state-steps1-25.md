# Canonical Business State — Steps 1–25

Status: implementation branch. The Business State layer is operator-safe and consumes governed evidence only. It does not import evaluator truth, simulator internals, latent customer state, oracle rankings or production credentials.

## Architecture

\`\`\`text
Authoritative providers / governed Kivviq evidence
  ├─ Shopify
  ├─ GA4
  ├─ Google Ads / Meta Ads / Pinterest Ads
  ├─ Omnisend / Klaviyo
  ├─ first-party measurement
  └─ merchant configuration
          │
          ▼
Canonical metric registry
          │
          ▼
Business-state evidence collector
          │
          ├─ current period
          ├─ previous period
          ├─ YoY
          └─ seasonal baseline
          │
          ▼
BusinessStateSnapshot
  ├─ metrics + evidence
  ├─ confidence
  ├─ measurement quality
  ├─ derived state signals
  └─ hard constraints
          │
          ├──────────────► historical snapshots / change detection
          │
          ├──────────────► simulator seed
          │
          └──────────────► action compatibility / abstention / decision context
                                       │
                                       ▼
                                  shadow mode
\`\`\`

The canonical snapshot is descriptive. It is not an optimizer and does not automatically choose or execute an action.

## Acceptance mapping

| Step | Implementation |
| --- | --- |
| 1. Canonical schema | \`src/business_state/schema.ts\` defines one versioned \`BusinessStateSnapshot\` across commercial, profitability, acquisition, customer, merchandising, lifecycle and measurement state. |
| 2. Metric definitions | \`metric-registry.ts\` defines the canonical meaning, unit, domain, derivation and direction of every state metric. |
| 3. Source authority | Every metric has an explicit authoritative-source allowlist. Store revenue/orders come from Shopify, sessions from GA4, lifecycle evidence from Omnisend/Klaviyo, journeys/measurement from first-party evidence and paid spend from governed platform evidence. |
| 4. Evidence collector | \`collector.ts\` requests only the direct metrics needed for the requested domains plus dependency closure, in parallel. |
| 5. Time context | Current, prior, YoY and seasonal-baseline values are represented independently with deltas and trends. |
| 6. Commercial | Revenue, channel revenue, orders, AOV, discounting and returns are canonical metrics. |
| 7. Profitability | COGS, gross profit/margin, paid spend, fulfillment, fees, return cost and contribution are explicit. Contribution remains UNKNOWN when any required cost is unknown. |
| 8. Acquisition/marketing | Spend, CVR, CAC, paid dependency, prospecting/retargeting mix, platform ROAS, concentration and incrementality evidence are separate concepts. |
| 9. Customer | New customers, returning orders, repeat rate, frequency, 90-day value and retention are represented. |
| 10. Merchandising | Product concentration, margin, discounted share, inventory cover, stockout rate, inventory risk and momentum are represented. |
| 11. Lifecycle | List size/growth, campaign revenue, automation revenue, lifecycle share and stage coverage are represented. |
| 12. Measurement | COGS coverage, journey coverage, identity quality, provider availability, freshness, attribution quality, incrementality coverage and sample adequacy are first-class state. |
| 13. Constraints | \`constraints.ts\` evaluates typed budget/inventory/margin/measurement/sample/saturation/policy/capacity constraints and preserves UNKNOWN. |
| 14. Derived signals | \`signals.ts\` emits factual signals such as \`orders_flat\`, \`AOV_rising\`, \`retargeting_heavy\`, \`inventory_constrained\`, \`margin_compression\` and \`profit_down_revenue_up\`, each bound to evidence metrics. |
| 15. Confidence | Every metric is \`KNOWN\`, \`PARTIAL\`, \`UNCERTAIN\` or \`UNKNOWN\`; missing evidence never becomes zero. |
| 16. Canonical snapshot | The schema validates unique metric identities, time bounds, version and confidence invariants. |
| 17. Historical snapshots | \`history.ts\` stores strictly ordered merchant snapshots. |
| 18. Change detection | Material metric changes and named transitions are detected between snapshots. |
| 19. Simulator connection | \`snapshotToSimulatorSeed\` deterministically translates observable state into a simulator-start seed while retaining unknown metrics and constraints. |
| 20. Decision Intelligence | \`decision.ts\` builds \`state → candidate actions → expected consequences → constraints → decision context\` without ranking or auto-execution. |
| 21. Abstention | Missing metrics, inadequate confidence or unknown required constraints yield \`ABSTAIN\` with explicit evidence requirements. |
| 22. Synthetic benchmark | \`benchmark.ts\` contains growth, stagnation, margin compression, retargeting dependence, inventory shortage, discount growth, retention failure and measurement failure cases. |
| 23. Adversarial states | The benchmark adds revenue-up/profit-down, high-ROAS/no-incrementality, aggregate-CVR and four-days-of-stock traps. |
| 24. State/action compatibility | Known violated constraints or forbidden state signals block actions before they can enter the eligible set. |
| 25. Real-data shadow mode | \`shadow.ts\` exposes provider adapters that external Kivviq connectors can feed with governed evidence, compares the resulting state with governed assertions and hard-disables automatic decisions and production mutations. |

## Metric-substitution rules

These distinctions are structural:

- Shopify store revenue is not interchangeable with Meta/Google/Pinterest attributed revenue.
- Platform ROAS is never represented as incremental return.
- Observed CAC is not an incrementality estimate.
- Paid-attributed revenue is not total store revenue.
- Gross profit is not contribution profit.
- Missing COGS, return cost, fulfillment cost, payment fees or paid spend do not become zero.
- A missing or stale provider cannot produce a \`KNOWN\` metric.
- An unknown hard constraint does not default to satisfied.

## Confidence

\`KNOWN\` means the current metric has acceptable governed evidence.

\`PARTIAL\` means a value exists but coverage/freshness is incomplete.

\`UNCERTAIN\` is used when evidence exists but sample sufficiency does not support stronger certainty.

\`UNKNOWN\` means the current business state cannot be established from available governed evidence.

Derived metrics inherit the weakest confidence of their required dependencies.

## Shadow-mode boundary

The public repository contains no merchant credentials and no production mutation path. A production Kivviq service supplies source-bound evidence through \`GovernedProviderAdapter\`. \`runBusinessStateShadowMode\` then:

1. builds the snapshot,
2. derives state signals,
3. evaluates constraints,
4. compares selected metrics against governed assertions,
5. returns mismatches,
6. sets both \`automaticDecisionAllowed\` and \`productionMutationAllowed\` to \`false\`.

Moving beyond shadow mode requires a separate production approval gate; this package deliberately does not expose one.

## Verification

Run:

\`\`\`sh
npm run test:business-state
npm run architecture
npm run typecheck
npm test
npm run build
\`\`\`

\`tests/business_state/steps1-25.test.ts\` contains an explicit acceptance test for every numbered Business State requirement.
