# Steps 13–15 — Compound Actions, Do Nothing & Investigate

Extend Kivviq's canonical Action Space with the final three foundational decision forms needed before Growth Operator can reason over interventions:

**13. Compound Actions** — several coordinated interventions forming one business decision.

**14. Do Nothing (`NO_OP`)** — deliberately preserve the current state.

**15. Investigate** — deliberately gather information before deciding whether to intervene.

These three concepts must remain distinct:

```text
COMPOUND
→ coordinate multiple interventions

NO_OP
→ deliberately introduce no new intervention

INVESTIGATE
→ acquire information without pretending an operational intervention has occurred
```

The governing principle is:

**Growth Operator's choice set must include changing several things, changing nothing, and gathering more evidence.**

Otherwise the future decision system will be structurally biased toward immediate intervention.

Do not build Growth Operator, candidate ranking, value-of-information optimization, recommendation policy, execution orchestration, or ActionEvaluation in these steps.

---

# 1. Build the canonical CompoundAction contract

Formalize the existing Compound Action readiness concept.

A `CompoundAction` represents:

> One coordinated merchant decision composed of multiple canonical atomic Actions.

Examples:

```text
Meta -$2,000/week
+
Google +$2,000/week
```

or:

```text
15% Collection X promotion
+
email campaign
+
Google Shopping +20%
+
homepage Collection X feature
```

Every component must remain a valid canonical Action.

A Compound Action must preserve:

* stable compound identity
* component Action identities
* component roles
* coordination semantics
* dependencies
* timing relationships
* population relationships
* compound constraints
* failure semantics
* rollback semantics
* measurement horizon
* provenance

Do not allow arbitrary operations or natural-language recommendations inside a Compound Action.

---

# 2. Preserve atomic causal identity

A Compound Action must never collapse its components into one opaque intervention.

For:

```text
CompoundAction
├── promotion.start
├── lifecycle.send
└── paid_media budget +20%
```

future systems must still be able to identify:

* promotion intervention
* lifecycle intervention
* paid-media intervention
* overall compound decision

This is essential for later simulation, causal evaluation and rollback.

One compound decision does not mean one simulator intervention.

---

# 3. Define compound coordination

Support explicit relationships such as:

```text
UNORDERED
ORDERED

START_TOGETHER
EFFECTIVE_TOGETHER
INDEPENDENT_TIMING

START_AFTER
EFFECTIVE_AFTER
COMPLETE_AFTER
REQUIRES
END_WITH
```

Example:

```text
Promotion must become EFFECTIVE
before lifecycle email SEND.
```

Dependencies must form a valid graph.

Reject:

```text
A requires B
B requires A
```

when no valid initial condition can satisfy the dependency.

Reuse Step 12 timing semantics rather than creating a separate Compound timing model.

---

# 4. Build cross-family Compound Actions

Compound Actions must coordinate existing canonical Action families without duplicating them.

Support combinations such as:

```text
PAID MEDIA
+
PROMOTION
+
LIFECYCLE
```

```text
INVENTORY PROTECTION
+
PAID-MEDIA REDUCTION
+
MERCHANDISING DEPRIORITIZATION
```

```text
CLEARANCE
+
PRICE REDUCTION
+
MERCHANDISING FEATURE
+
PAID-MEDIA INCREASE
```

Do not create:

```text
inventory.pause_ads
inventory.reduce_price
campaign_discount_email_google
```

when canonical component Actions already exist.

Composition happens at the Compound layer.

---

# 5. Define compound atomicity, failure and readiness

Support explicit business atomicity such as:

```text
ALL_OR_NOTHING
BEST_EFFORT
DEPENDENCY_GATED
```

Example:

```text
Meta -$2K
Google +$2K
```

may require:

```text
ALL_OR_NOTHING
```

because executing only the Meta reduction violates the intended reallocation.

Create a separate:

```text
CompoundActionReadiness
```

capable of reporting per component:

```text
READY
INELIGIBLE
UNKNOWN
MISSING_CONTEXT
UNSUPPORTED_SIMULATOR_CAPABILITY
```

and an overall result such as:

```text
READY
PARTIALLY_READY
BLOCKED
UNKNOWN
```

Do not silently omit unsupported components.

Do not convert unsupported components into `NO_OP`.

---

# 6. Build compound rollback semantics

Compound rollback must coordinate existing **domain-specific rollback** rather than replacing it.

For example:

```text
Pricing
→ RESTORE_PRE_ACTION_VALUE

Promotion
→ DEACTIVATE

Shipping offer
→ DEACTIVATE

Merchandising rank
→ conflict-safe restoration

Lifecycle send
→ irreversible after dispatch
```

Support compound rollback policies such as:

```text
ROLLBACK_ALL_REVERSIBLE_COMPONENTS
ROLLBACK_COMPLETED_COMPONENTS
ROLLBACK_DEPENDENT_COMPONENTS
NO_AUTOMATIC_ROLLBACK
```

Preserve partial reversibility.

A Compound Action containing:

```text
promotion
+
email already sent
```

cannot truthfully claim that the complete business state can be restored.

The promotion may be deactivated.

The email cannot be unsent.

Compensating Actions are not rollback.

---

# 7. Build explicit `NO_OP`

Formalize `NO_OP` as a first-class canonical Action.

`NO_OP` means:

> Deliberately introduce no new causal business intervention within the specified scope and time horizon.

It must not be represented as:

```text
null
undefined
[]
missing recommendation
```

Those mean no Action was supplied.

`NO_OP` means a deliberate decision.

Support explicit scope:

```text
NO_OP:
paid media

NO_OP:
Google Shopping

NO_OP:
SKU A pricing

NO_OP:
Population X lifecycle intervention

NO_OP:
entire current decision problem
```

Reuse Step 12 timing.

Examples:

```text
Maintain current Google Shopping policy
for 14 days.
```

```text
Make no pricing change to SKU A
during the evaluation horizon.
```

---

# 8. Define NO_OP semantics rigorously

Preserve the critical translation invariant:

```text
NO_OP
→ TRANSLATED
→ SimulatorIntervention[] = []
```

This is different from:

```text
UNSUPPORTED_ACTION_TYPE
```

and different from:

```text
no candidate exists
```

Under `NO_OP`, normal business evolution continues.

Customers still arrive.

Existing campaigns continue.

Existing promotions expire according to their schedules.

Inventory may deplete.

Previously ordered inventory may arrive.

Previously scheduled Actions may become effective.

`NO_OP` does **not**:

* freeze the simulator
* restore a historical baseline
* cancel existing Actions
* stop existing campaigns
* stop promotions
* set values to zero
* reapply current values

It means no **new** causal intervention from this decision.

---

# 9. Make NO_OP a normal future candidate

The architecture must support a future candidate set such as:

```text
Candidate 0
NO_OP

Candidate 1
Increase Google +20%

Candidate 2
Decrease Google -10%

Candidate 3
Meta -$2K + Google +$2K

Candidate 4
INVESTIGATE
```

Do not assign:

```text
NO_OP expected value = 0
```

Doing nothing may have substantial business consequences.

It may preserve profitable operations.

It may also allow:

* stockouts
* excess inventory
* customer churn
* poor CRO
* inefficient spend

Those are future outcomes, not properties of the Action.

`NO_OP` must use the same future ActionEvaluation boundary as active Actions.

---

# 10. Keep NO_OP distinct from WAIT and INVESTIGATE

These must remain separate.

### NO_OP

```text
Maintain current state.
```

### WAIT / OBSERVE

```text
Delay intervention and reassess later.
```

### INVESTIGATE

```text
Actively acquire information needed for a better decision.
```

For example:

```text
NO_OP
→ Leave Google unchanged.
```

```text
WAIT
→ Leave Google unchanged and reassess after seven more days of observations.
```

```text
INVESTIGATE
→ Audit Google attribution because current evidence is inconsistent.
```

Do not collapse them because they may all produce zero immediate commercial simulator interventions.

Their decision semantics are different.

---

# 11. Build the canonical `INVESTIGATE` Action

Formalize investigation as a first-class Action.

An investigation represents:

> A deliberate information-acquisition intervention intended to resolve uncertainty, missing evidence, data-quality problems or unexplained business behavior before an operational decision is made.

Support investigation categories such as:

```text
TRACKING_AUDIT
DATA_QUALITY_CHECK
MISSING_DATA_REQUEST
ANOMALY_DIAGNOSIS
METRIC_RECONCILIATION
BUSINESS_PROCESS_CHECK
MEASUREMENT_VALIDATION
```

Keep the taxonomy extensible.

Examples:

```text
Investigate Meta tracking.
```

```text
Diagnose conversion-rate drop.
```

```text
Request missing SKU COGS.
```

```text
Reconcile Shopify revenue against payment data.
```

```text
Investigate unexpected Pinterest attribution spike.
```

These must be structured Actions, not free-text analyst tasks.

---

# 12. Define investigation targets and questions

Every investigation must identify what uncertainty it is intended to resolve.

Support targets such as:

* data source
* metric
* channel
* campaign
* product
* SKU
* funnel stage
* tracking implementation
* customer journey
* inventory fact
* cost/economic input
* anomalous event

An investigation should include a structured question or evidence requirement.

Example:

```text
Investigation:
MISSING_DATA_REQUEST

Target:
SKU A

Required evidence:
COGS

Purpose:
resolve contribution-margin eligibility
```

Another:

```text
Investigation:
ANOMALY_DIAGNOSIS

Target:
checkout conversion

Observed issue:
material decline from comparison period

Evidence requested:
funnel diagnostics
device split
checkout errors
```

Do not encode the diagnosis before investigating.

---

# 13. Distinguish investigation from its result

This is a critical boundary.

```text
InvestigationAction
→ what evidence should be collected
```

is separate from:

```text
InvestigationResult
→ what was learned
```

For example:

```text
INVESTIGATE:
Audit Meta purchase tracking.
```

must not contain:

```text
finding:
Meta is over-attributing by 30%
```

before the investigation occurs.

Create a future-compatible result boundary such as:

```text
InvestigationResult
```

containing:

* investigation Action reference
* evidence collected
* evidence coverage
* findings
* unresolved questions
* completion time
* provenance

Do not place results inside the immutable Action.

---

# 14. Define investigation success and failure

An investigation may resolve:

```text
RESOLVED
PARTIALLY_RESOLVED
UNRESOLVED
FAILED
```

but those are result/execution states, not fields on the canonical Action itself.

The Action may define:

```text
requiredEvidence
successCriteria
measurementScope
maximumInvestigationHorizon
```

without containing the eventual result.

Do not claim that an investigation necessarily eliminates uncertainty.

---

# 15. Build missing-data investigations

Support explicit evidence requests.

Examples:

```text
Request missing COGS for SKU A.
```

```text
Request supplier lead-time evidence.
```

```text
Request customer consent evidence.
```

```text
Request shipping cost for oversized products.
```

These should reference the canonical fact/metric required.

Do not represent:

```text
get more data
```

as sufficient executable semantics.

The missing evidence must be explicit.

---

# 16. Build tracking and measurement investigations

Support:

```text
Audit Meta purchase tracking.
```

```text
Check whether GA4 purchase events are duplicated.
```

```text
Validate Pinterest attribution event mapping.
```

```text
Inspect lifecycle conversion tracking.
```

The Action should identify:

* system/source
* event/metric
* suspected issue class
* evidence requested
* time window
* success criteria where appropriate

Do not hard-code a presumed error.

---

# 17. Build anomaly investigations

Support structured anomaly diagnosis.

Examples:

```text
Investigate checkout conversion drop.
```

```text
Investigate sudden AOV increase.
```

```text
Investigate unexplained inventory discrepancy.
```

```text
Investigate channel revenue spike.
```

Represent:

* metric
* entity/scope
* observation window
* comparison/baseline reference
* anomaly direction where known
* requested evidence

Do not put the cause inside the Action.

For example:

```text
Investigate conversion decline
because checkout is broken
```

is invalid if checkout failure has not yet been established.

---

# 18. Keep INVESTIGATE separate from active business intervention

Investigation may consume:

* analyst time
* engineering time
* operational capacity
* API calls
* merchant effort

but it does not automatically alter:

* price
* advertising
* promotions
* shipping
* merchandising
* inventory
* CRO
* lifecycle policy

Therefore, where the simulator models only ecommerce causal interventions:

```text
INVESTIGATE
→ SimulatorIntervention[] = []
```

may be correct.

But do not confuse that with `NO_OP`.

`NO_OP` deliberately maintains state.

`INVESTIGATE` deliberately acquires information.

---

# 19. Define investigation cost and duration

Investigations may have real cost.

Support:

* implementation/analyst cost
* engineering cost
* external service cost
* expected duration
* required resources

Keep known cost separate from expected decision value.

Do not include:

```text
expectedValueOfInformation
expectedProfitFromInvestigation
recommendedInvestigationScore
```

inside the Action.

Those belong to future evaluation/decision systems.

---

# 20. Define investigation timing

Reuse Step 12 timing.

Support:

```text
Start immediately.

Complete within 2 days.

Audit trailing 30 days of tracking.

Request COGS and wait for evidence.

Reassess after investigation completes.
```

Distinguish:

```text
investigation execution window
```

from:

```text
evidence observation window
```

Example:

```text
Investigation runs:
Sep 26–27

Evidence inspected:
Aug 27–Sep 25
```

Do not collapse them.

---

# 21. Define investigation dependencies

Investigations may gate future Actions.

Support a future-compatible relationship such as:

```text
Action B
REQUIRES
Investigation A resolved
```

Example:

```text
Price reduction
REQUIRES
COGS investigation resolved
```

or:

```text
Paid-media reallocation
REQUIRES
tracking audit completed
```

Do not automatically create the later intervention.

The investigation resolves evidence.

A future decision system must still decide what to do afterward.

---

# 22. Define investigation recurrence carefully

Some investigations may legitimately recur:

```text
Audit tracking weekly.
```

But do not use recurrence to create a monitoring system unless that is explicitly the Action.

Reuse Step 12 recurrence semantics.

A one-time anomaly investigation and a recurring measurement audit must fingerprint differently.

---

# 23. Define investigation population semantics

Most investigations will not target customers.

Where customer evidence is involved, preserve Step 11 privacy and population boundaries.

For example:

```text
Investigate whether Population X
has incomplete email-consent evidence.
```

is acceptable.

Do not place raw PII into the Action.

Do not turn investigation into customer scoring.

---

# 24. Define investigation readiness

Create a separate readiness result where useful.

Possible blockers:

```text
target does not exist
required source unavailable
insufficient permissions
invalid observation window
required metric undefined
```

Do not mutate the Action with runtime readiness.

Reuse the architecture:

```text
Action definition
≠
readiness
≠
execution/result
```

---

# 25. Integrate INVESTIGATE with Compound Actions

Compound Actions may include investigations where semantically appropriate.

Example:

```text
Compound:
Reduce Meta budget 10%
+
investigate attribution anomaly
```

The paid-media component produces a causal business intervention.

The investigation component produces an information-acquisition task.

Preserve both identities.

Do not require every Compound component to translate into a simulator intervention.

---

# 26. Do not use INVESTIGATE as an unsupported fallback

This is critical.

If Kivviq cannot simulate or execute an Action:

```text
UNSUPPORTED_SIMULATOR_CAPABILITY
```

must remain unsupported.

Do not silently replace it with:

```text
INVESTIGATE
```

Likewise, missing implementation support does not mean more evidence is needed.

Investigation is appropriate only when the business decision genuinely calls for information acquisition.

---

# 27. Protect all three Actions from outcome leakage

Reject fields such as:

```text
expectedRevenue
expectedProfit
expectedROAS
expectedLift
expectedSynergy
expectedValueOfInformation
predictedBestAction
predictedInvestigationValue
recommendationScore
confidenceScore
bestCandidate
```

from:

* CompoundAction
* NO_OP
* InvestigationAction

These Actions define possible decisions.

They do not evaluate those decisions.

---

# 28. Preserve the future candidate architecture

After Steps 13–15, the future Growth Operator should be able to consider:

```text
Candidate A
NO_OP

Candidate B
Atomic Action

Candidate C
Compound Action

Candidate D
WAIT / OBSERVE

Candidate E
INVESTIGATE

Candidate F
RUN_EXPERIMENT
```

These are fundamentally different decision types.

Do not collapse them into a generic:

```text
recommendation
```

object.

---

# 29. Canonical fixtures

Implement fixtures covering at minimum:

### Compound

1. Meta `-$2,000/week` + Google `+$2,000/week`.
2. 15% promotion + email + Google Shopping +20%.
3. Promotion + email + paid media + homepage merchandising.
4. Inventory protection + paid-media reduction + merchandising deprioritization.
5. Clearance + price reduction + merchandising feature + paid-media increase.
6. Ordered compound where promotion must be effective before email.
7. Compound with different populations by component.
8. Compound with one unsupported simulator component.
9. `ALL_OR_NOTHING` compound blocked by unsupported component.
10. Compound rollback containing reversible and irreversible components.
11. Compound rollback where one component returns `CONFLICT`.
12. Invalid circular dependency.

### NO_OP

13. Global NO_OP for 14 days.
14. Paid-media NO_OP.
15. SKU pricing NO_OP.
16. Population-scoped lifecycle NO_OP.
17. NO_OP while an existing promotion continues to scheduled end.
18. NO_OP while an existing purchase
