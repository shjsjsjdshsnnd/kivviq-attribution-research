# Steps 10–12 — Lifecycle Actions, Customer Targeting & Timing

Build the next three layers of Kivviq's canonical Action Space as a coordinated **10-step implementation sequence**.

The three domains are:

**10. Lifecycle Actions** — what lifecycle intervention occurs.

**11. Customer Targeting** — exactly who is eligible to receive an intervention.

**12. Timing** — exactly when the intervention starts, becomes effective, ends, and potentially repeats.

The governing architecture is:

```text
Population
→ WHO is eligible

Action
→ WHAT intervention exists

Timing
→ WHEN the intervention applies

Evaluation / Simulator
→ WHAT COULD HAPPEN

Future Growth Operator
→ WHAT, IF ANYTHING, SHOULD BE DONE
```

Do not weaken these boundaries.

In particular:

> **Membership, not desirability:** Population evaluation may determine whether an entity satisfies an explicit population definition. It must never estimate, rank, recommend, or otherwise determine whether that entity or population should receive an intervention.

Do not build optimization, recommendation ranking, churn prediction, LTV prediction, message generation, send-time optimization, experimentation, provider execution, or Growth Operator decision policy in these steps.

---

# Step 1 — Establish the shared lifecycle-targeting-timing boundary

Before adding domain behavior, establish how the three systems connect.

A targeted lifecycle intervention should conceptually resolve as:

```text
Lifecycle Action
    ↓
WHAT

PopulationDefinition
    ↓
WHO

ActionTiming
    ↓
WHEN
```

For example:

```text
Action:
Send WINBACK email

Population:
customers with >= 1 completed order
AND days since last completed order >= 90
AND email eligible

Timing:
evaluate membership at SEND_TIME
send Friday at 10:00
```

These must remain separate contracts.

Do not create an object such as:

```text
send_winback_email_to_high_value_lapsed_customers_friday
```

that collapses intervention, population and timing into one Action type.

All three systems must remain independently reusable.

---

# Step 2 — Build canonical lifecycle Actions

Add lifecycle Action semantics supporting at minimum:

```text
lifecycle.send
lifecycle.start_flow
lifecycle.stop_flow
lifecycle.modify_flow
lifecycle.adjust_frequency
lifecycle.adjust_contact_policy
lifecycle.rollback_policy
```

Support channels:

```text
EMAIL
SMS
```

and lifecycle purposes including:

```text
GENERAL_CAMPAIGN
WELCOME
WINBACK
POST_PURCHASE
REPLENISHMENT
RETENTION
```

Keep channels provider-neutral.

Do not create:

```text
OMNISEND_SEND
KLAVIYO_FLOW
```

as canonical business Actions.

Provider execution belongs downstream.

Distinguish:

```text
one-time send
```

from:

```text
automated flow
```

A campaign send is a communication event.

A flow is an ongoing policy capable of generating future sends when its trigger and eligibility conditions are satisfied.

---

# Step 3 — Build lifecycle intervention semantics

Implement the actual lifecycle decisions Kivviq needs to express.

### Sends

Support:

```text
Send EMAIL to Population A.

Send SMS to Population B.

Send EMAIL Friday at 10:00.
```

### Frequency

Support:

```text
SET email cadence = 3/week

DELTA email cadence = +1/week

SET SMS cadence = 2/month
```

Frequency must always include a period.

### Contact policies

Support:

```text
maximum 3 marketing emails per 7 days

maximum 2 SMS messages per 30 days

minimum 48 hours between promotional SMS messages

maximum 4 total promotional contacts
across EMAIL + SMS
per 7 days
```

Keep campaign cadence distinct from customer contact caps.

### Winback

Support:

```text
Start WINBACK flow
for customers reaching
90 days since last completed purchase.
```

### Post-purchase

Support:

```text
Send care instructions
2 days after ORDER_FULFILLED.

Send review request
14 days after ORDER_DELIVERED.
```

### Replenishment

Support:

```text
Send replenishment reminder
60 days after Product A purchase.
```

Keep lifecycle replenishment completely separate from:

```text
inventory.reorder
```

### Retention

Support:

```text
Start retention flow.

Send retention message
30 days after first purchase.

Start repeat-purchase education sequence.
```

Do not encode outcomes such as:

```text
increase retention
reduce churn
increase LTV
```

as Actions.

Those are objectives/outcomes, not interventions.

---

# Step 4 — Build lifecycle flow structure

Flows require stable canonical identity:

```text
flowId = lifecycleflow_123
```

Support ordered sequences:

```text
WINBACK FLOW

Step 1
EMAIL
trigger + 0 days

Step 2
EMAIL
+ 7 days

Step 3
SMS
+ 14 days
```

Each step should preserve:

* step identity
* order
* channel
* timing/delay
* eligibility
* suppression
* exit conditions

Support deterministic branching such as:

```text
IF completed purchase
→ EXIT FLOW

ELSE
→ continue to next eligible step
```

Do not build a general-purpose workflow language.

Support modifications:

```text
Change winback threshold
90 days → 75 days.

Change Step 2 delay
7 days → 5 days.

Add SMS step.

Remove Step 3.
```

Support explicit:

```text
lifecycle.stop_flow
```

Stopping a flow prevents future flow-generated sends.

It does not unsend messages already sent.

Sent email/SMS is therefore irreversible.

Flow configuration and frequency/contact policies may remain reversible using the existing conflict-safe rollback architecture.

---

# Step 5 — Build `PopulationDefinition`

Now establish the canonical answer to:

> Exactly who is eligible?

Create a typed, versioned:

```text
PopulationDefinition
```

supporting:

* population ID
* version
* universe
* inclusion criteria
* exclusion criteria
* logical composition
* lookback windows
* membership mode
* membership binding
* provenance
* deterministic fingerprint

Support universes such as:

```text
ALL_CUSTOMERS
KNOWN_CUSTOMERS
MARKETING_CONTACTS
PURCHASERS
EMAIL_ELIGIBLE_CUSTOMERS
SMS_ELIGIBLE_CUSTOMERS
```

Population rules must be structural.

For example:

```text
completed_order_count >= 2
```

```text
net_revenue >= 500 CAD
window = trailing 365 days
```

```text
days_since_last_completed_order >= 90
```

```text
purchased Product A
within trailing 90 days
```

Support:

```text
AND
OR
NOT
INTERSECTION
UNION
DIFFERENCE
```

Do not use prose such as:

```text
high-value customers
good customers
likely buyers
high-intent customers
```

as executable population definitions.

Merchant labels such as:

```text
VIP
LAPSED
LOYAL
```

may exist only as aliases for explicit versioned definitions.

---

# Step 6 — Build deterministic population evaluation

Create:

```text
PopulationEvaluation
```

separately from:

```text
PopulationDefinition
```

Population evaluation must use:

```text
ELIGIBLE
INELIGIBLE
UNKNOWN
```

Do not use ordinary boolean truthiness.

Three-valued logic must be deterministic.

For `AND`:

```text
FALSE + anything → FALSE
TRUE + TRUE → TRUE
otherwise → UNKNOWN
```

For `OR`:

```text
TRUE + anything → TRUE
FALSE + FALSE → FALSE
otherwise → UNKNOWN
```

For `NOT`:

```text
TRUE → FALSE
FALSE → TRUE
UNKNOWN → UNKNOWN
```

Exclusions have deterministic precedence:

```text
1. Evaluate inclusion.
2. Evaluate exclusions.
3. Confirmed exclusion → INELIGIBLE.
4. Inclusion FALSE → INELIGIBLE.
5. Inclusion TRUE + exclusions FALSE → ELIGIBLE.
6. Unresolved evidence capable of changing membership → UNKNOWN.
```

`PopulationEvaluation` may expose only membership/evidence information such as:

```text
eligibleCount
ineligibleCount
unknownCount
evidenceCoverage
evaluatedAt
snapshotRef
```

It must reject:

```text
score
rank
expectedLift
expectedRevenue
responseProbability
expectedLTV
recommendedTreatment
bestAudience
recommendationScore
```

### Normative freeze invariant

> **Membership, not desirability:** Population evaluation may determine whether an entity satisfies an explicit population definition. It must never estimate, rank, recommend, or otherwise determine whether that entity or population should receive an intervention.

This must be enforced through schema/validation, not merely tests.

---

# Step 7 — Build population time binding and snapshots

Membership changes over time.

Support:

```text
DECISION_TIME
EXECUTION_TIME
SEND_TIME
TRIGGER_TIME
EFFECTIVE_TIME
```

and:

```text
FROZEN_MEMBERSHIP
DYNAMIC_MEMBERSHIP
```

These must be semantically different.

For example:

```text
VIP @ DECISION_TIME
```

must fingerprint differently from:

```text
VIP @ SEND_TIME
```

Likewise:

```text
FROZEN_MEMBERSHIP
```

must differ from:

```text
DYNAMIC_MEMBERSHIP
```

Create:

```text
PopulationSnapshot
```

separately from the definition.

A snapshot may preserve:

* population ID/version
* definition fingerprint
* binding
* evaluation timestamp
* controlled internal customer IDs
* provenance
* snapshot fingerprint

Do not store raw PII such as:

* email
* phone
* name
* postal address

inside canonical population definitions, fingerprints or Action serialization.

Campaigns may use frozen membership.

Automated lifecycle flows may intentionally use dynamic membership evaluated at `TRIGGER_TIME`.

Do not freeze all populations indiscriminately.

---

# Step 8 — Build universal `ActionTiming`

Formalize one timing contract shared by every Action family.

At minimum support:

```text
decisionTime
requestedStart
implementationDelay
effectiveStart
duration
end
terminationCondition
recurrence
timezone
```

Distinguish:

```text
decision time
requested start
effective start
```

For example:

```text
Decision:
September 20

Requested start:
October 1

Implementation delay:
2 hours

Effective:
October 1 + 2 hours
```

Support:

### Immediate

```text
IMMEDIATE
```

### Absolute

```text
October 1 at 00:00
America/Toronto
```

### Event-relative

```text
14 days after ORDER_DELIVERED
```

### Trigger-relative

```text
when customer reaches
90 days since last purchase
```

### Duration

```text
7 days
4 weeks
24 elapsed hours
1 calendar month
```

### Persistent

```text
until changed
```

### Explicit end

```text
Friday → Monday
```

### State termination

```text
until inventory <= 50
```

### Recurrence

```text
every Tuesday
for 8 weeks
```

Do not create separate incompatible timing models for lifecycle, promotions, paid media, inventory, etc.

---

# Step 9 — Build `TimingResolution` and temporal safety

Keep:

```text
ActionTiming
```

separate from:

```text
TimingResolution
```

`ActionTiming` defines temporal intent.

`TimingResolution` may resolve:

* effective start
* effective end
* occurrences
* dependencies
* unresolved events
* missing context
* validation state
* provenance

Do not mutate canonical timing intent as more runtime information becomes available.

Support:

```text
START_AFTER
EFFECTIVE_AFTER
COMPLETE_AFTER
END_WITH
```

where Actions depend on other Actions/events.

Reject temporal cycles.

Example:

```text
A starts after B completes
B starts after A completes
```

must fail when unschedulable.

Support recurrence without expanding the canonical Action into unrelated Actions.

Example:

```text
Send every Tuesday for 8 weeks
```

remains one recurring business Action.

Future resolution may generate eight occurrences retaining the same originating Action identity.

Respect timezone and daylight-saving semantics.

Do not assume:

```text
1 calendar day = exactly 24 hours
```

or:

```text
1 month = 30 days
```

where business semantics differ.

---

# Step 10 — Integrate, guard, fixture and freeze Steps 10–12

Integrate the three layers:

```text
Lifecycle Action
        ↓
WHAT

PopulationDefinition
        ↓
WHO

ActionTiming
        ↓
WHEN
```

A complete intervention should now be capable of representing:

```text
WHAT
Send WINBACK email

WHO
Customers with >= 1 completed order
AND days since last purchase >= 90
AND email eligible

WHEN
Evaluate population at SEND_TIME
Send Friday at 10:00
America/Toronto
```

or:

```text
WHAT
Start post-purchase review-request flow

WHO
Eligible purchasers

WHEN
14 days after ORDER_DELIVERED
dynamic membership at TRIGGER_TIME
```

## Translation boundary

Extend Step 2 translation only where simulator capability legitimately exists.

Never fake lifecycle effects by directly changing:

```text
conversionProbability
retention
repeatPurchaseProbability
revenue
LTV
```

Never fake unresolved population targeting by applying an intervention to everyone.

Never fake unresolved timing by applying an intervention immediately.

If semantics cannot be preserved:

```text
UNSUPPORTED_SIMULATOR_CAPABILITY
```

or:

```text
MISSING_CONTEXT
```

is correct.

## Leakage guards

Reject fields including:

```text
expectedOpenRate
expectedClickRate
expectedConversion
expectedRevenue
expectedProfit
expectedRetentionLift
expectedLTV
predictedChurn
predictedOptimalSendTime
responseProbability
bestAudience
recommendedTreatment
recommendationScore
confidenceScore
futurePurchase
counterfactualRevenue
```

## Canonical fixtures

Implement at minimum:

1. Email to explicit Population A Friday at 10:00.
2. SMS to explicit Population B.
3. Email frequency 2/week → 3/week.
4. Maximum 3 marketing emails/customer/7 days.
5. Maximum 4 total EMAIL + SMS contacts/7 days.
6. 90-day winback flow.
7. Multi-step EMAIL + SMS winback flow.
8. Post-purchase care email 2 days after fulfillment.
9. Review request 14 days after delivery.
10. Replenishment reminder 60 days after Product A purchase.
11. Retention flow for one-time buyers.
12. Population with exactly one completed order.
13. Population with >= 2 orders and trailing-365-day net revenue >= $500 CAD.
14. Product A purchaser trailing 90 days.
15. Cart abandoner using observed behavior.
16. Population with exclusion of recent purchasers.
17. Population with missing SMS consent → UNKNOWN.
18. Frozen population at DECISION_TIME.
19. Dynamic population at TRIGGER_TIME.
20. Same population definition evaluated at two times with different counts.
21. Immediate Action.
22. Future effective Action.
23. Action with implementation delay.
24. Event-relative Action.
25. Persistent Action.
26. Time-bounded Action.
27. Recurring Action.
28. Recurring Action crossing DST.
29. Unresolved future event.
30. Unsupported simulator translation.

## Required semantic-identity tests

Prove:

```text
EMAIL != SMS
```

```text
one-time send != automated flow
```

```text
lifecycle replenishment != inventory reorder
```

```text
$500 lifetime != $500 trailing 365 days
```

```text
orders >= 2 != orders > 2
```

```text
DECISION_TIME != SEND_TIME
```

```text
FROZEN_MEMBERSHIP != DYNAMIC_MEMBERSHIP
```

```text
start immediately != start October 1
```

```text
7 days != persistent
```

```text
7 days after ORDER_PLACED
!=
7 days after ORDER_DELIVERED
```

```text
every Tuesday
!=
one time next Tuesday
```

All inherited tests from Steps 1–9 must remain green.

---

# Freeze criteria

Steps 10–12 are complete only when Kivviq can deterministically answer three independent questions:

### 1. WHAT?

> What lifecycle intervention exists?

Example:

```text
Send WINBACK email.
```

### 2. WHO?

> Exactly who is eligible?

Example:

```text
Customers with >= 1 completed order
AND >= 90 days since last completed purchase
AND email eligible.
```

### 3. WHEN?

> When does the intervention become effective, how long does it apply, and does it repeat?

Example:

```text
Evaluate membership at SEND_TIME.
Send Friday at 10:00 America/Toronto.
One occurrence.
```

The system must **not** answer:

> Is this the best population?

> Will they respond?

> Is Friday the optimal send time?

> Will the campaign make money?

> Should we send it?

Those belong downstream.

The inherited architecture after this step is:

```text
Population
→ WHO is eligible

Action
→ WHAT can be done

Timing
→ WHEN it applies

Evaluation / Simulator
→ WHAT COULD HAPPEN

Growth Operator
→ WHAT, IF ANYTHING, SHOULD BE DONE
```

Do not build the final line yet.

This 10-step sequence should freeze lifecycle intervention language, population eligibility language, and universal timing language without allowing recommendation or optimization logic to leak upstream.
