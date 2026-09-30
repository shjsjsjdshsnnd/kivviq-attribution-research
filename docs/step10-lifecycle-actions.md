# Phase 2 — Action Space
## Step 10 — Lifecycle Actions

## Governing principle

Lifecycle marketing is structured business language for who to contact, through which owned channel, when, how often and for what lifecycle purpose. It is not prose saying to send a winback email, and it does not embed message creative, predicted outcomes, provider execution or experiment design.

Step 10 advances Action schema to 1.8.0 while preserving genuine 1.0–1.7 Actions. TranslationContext advances to 1.6.0.

## Canonical family

New lifecycle Actions include lifecycle.send, lifecycle.start_flow, lifecycle.stop_flow, lifecycle.modify_flow, lifecycle.adjust_frequency, lifecycle.target_segment and lifecycle.rollback_policy.

Legacy lifecycle.adjust_frequency Actions using the original frequency operation remain readable. Schema 1.8 lifecycle.adjust_frequency uses structured lifecycle frequency/contact-policy semantics.

## Channel and purpose

Channel is explicit: EMAIL, SMS or typed CUSTOM channel identity. Canonical lifecycle purpose includes GENERAL_CAMPAIGN, WELCOME, WINBACK, POST_PURCHASE, REPLENISHMENT, RETENTION, BROWSE_ABANDONMENT, CART_ABANDONMENT, BACK_IN_STOCK, PRICE_DROP and LOYALTY, plus typed CUSTOM purpose.

## Sends versus flows

lifecycle.send is an explicit communication event. lifecycle.start_flow activates an ongoing policy that may produce multiple future communications when customers satisfy trigger, audience, consent, suppression and contact-policy rules. A flow is never represented as one future message.

## Audience and membership

Audience inclusion and suppression are separate. Inclusion supports canonical customer segment and structured purchase-count rules. Suppression supports recent purchase windows, current flow membership, suppression segments, channel suppression and contact-policy blocks. SUPPRESS_OVERRIDES_INCLUDE is explicit.

Segment membership boundary is explicit: DECISION_TIME, SEND_TIME or TRIGGER_TIME. Fixed snapshots use stable binding references; dynamic future membership is not frozen prematurely.

## Consent and channel eligibility

Channel requirements explicitly state whether consent eligibility, valid destination and non-suppressed channel evidence are required. Missing evidence remains unknown; it is never guessed and the ontology does not encode jurisdiction-specific legal interpretation.

## Send timing

Timing distinguishes ABSOLUTE_TIME, RELATIVE_TO_EVENT and RECURRING_CADENCE. Absolute schedules carry an explicit timezone. Relative schedules identify the canonical event and delay; they do not pretend to know a future resolved send time before the event exists.

## Flow triggers and events

Machine-evaluable triggers include DAYS_SINCE_LAST_PURCHASE, DAYS_SINCE_LAST_ENGAGEMENT, canonical lifecycle events and audience entry. Canonical events distinguish ORDER_PLACED, ORDER_FULFILLED, ORDER_DELIVERED, PRODUCT_PURCHASED and CUSTOMER_CREATED.

## Sequences

Flows contain ordered steps with stable step IDs, contiguous positions, channel, delay, channel eligibility, suppression, continuation and exit conditions. Multi-channel email/SMS sequences are supported without subject lines, body copy, CTAs or creative assets.

## Flow modification and stop

Started flows use stable lifecycleflow_* identity. lifecycle.modify_flow can change a trigger, step delay, add a step or remove a step. lifecycle.stop_flow prevents future flow-triggered communications and does not erase historical sends.

## Frequency and contact policy

Planned cadence is separate from realized sends. Structured cadence preserves SET / DELTA / MULTIPLY with explicit count and window seconds plus baseline reference for relative operations.

Contact caps and minimum intervals are separate policy forms. This supports rules such as maximum three marketing emails per seven days or minimum twenty-four hours between email and SMS contacts without assuming channel caps operate independently.

## Cross-family identity

Lifecycle replenishment means customer repurchase messaging and remains distinct from Step 8 inventory.reorder. Incentives remain Step 5 promotion Actions. Cross-sell placement remains Step 7 merchandising. Lifecycle Actions can coordinate those Action IDs without hiding promotion or merchandising semantics inside lifecycle text.

## Temporary policies and rollback

Temporary frequency/contact-policy changes require lifecycleRollback. RESTORE_PRE_ACTION_VALUE and SET_EXPLICIT_VALUE are supported with REQUIRE_CURRENT_MATCHES_ACTION_OUTPUT so expiry cannot overwrite a later legitimate policy change.

## Eligibility and flow conflicts

Operator-safe eligibility uses current segment membership, consent, contact destination, suppression, purchase history, known lifecycle event history, current flow membership and contact-policy evaluation. Results remain eligible / ineligible / unknown.

Flow concurrency supports COEXIST, PRECEDENCE, MUTUALLY_EXCLUSIVE_GROUP and SUPPRESS_WHEN_CONTACT_POLICY_BLOCKS. The module detects contact conflicts but does not build a scheduler.

## Message and experiment boundaries

Lifecycle Action remains separate from future MessageSpecification and Experiment specification. Subject lines, body, creative, SMS copy, traffic allocation, control groups, randomization unit, statistical power, significance thresholds and experiment results are forbidden from canonical lifecycle Actions.

## Measurement

Lifecycle Actions use the existing measurement horizon. Relevant metric IDs may include sends, deliveries, opens where reliable, clicks, conversion, repeat purchase, unsubscribes, SMS opt-outs, revenue, contribution and retention. The Action states what to measure, not what the result is expected to be.

## TranslationContext

TranslationContext 1.6.0 supports current flow configuration, current policy values, canonical segment definitions, fixed membership snapshots, channel capabilities, current consent/destination/suppression state, current flow membership and known past lifecycle events.

Future purchases, engagement, churn, future segment membership, predicted send time, provider workflow IDs, evaluator/oracle/GroundTruth information and experiment outcomes are rejected.

## Conservative Step 2 translation

The current simulator has no semantically correct LifecycleSendIntervention, flow activation/deactivation or lifecycle frequency/customer-response mechanics. Every new rigorous lifecycle Action therefore returns UNSUPPORTED_SIMULATOR_CAPABILITY.

Lifecycle Actions are never approximated by changing conversion probability, repeat-purchase probability, retention, customer lifetime value or revenue.

## Provider independence

Canonical Actions contain no Omnisend, Klaviyo, Mailchimp, Attentive or Shopify Email workflow identity. Provider configuration belongs to future execution adapters.

## Non-scope

No message generation, send-time optimization, lifecycle optimizer, segmentation model, experimentation engine, attribution model, deliverability infrastructure, provider execution, recommendation ranking or Growth Operator decision policy is built.