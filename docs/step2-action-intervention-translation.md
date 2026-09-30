# Phase 2 — Action Space
## Step 2 — Business Action to Simulator Intervention Translation

## Governing principle

**A business action is not a simulator intervention.**

Step 1 remains the authoritative merchant-facing action language. Step 2 adds a
separate deterministic adapter that turns valid canonical Actions into the
narrow causal state mutations understood by a simulator.

The dependency direction is:

Business Action
→ typed translation registry
→ SimulatorIntervention[]
→ simulator

The simulator does not interpret Action descriptions and the Action ontology
does not import simulator-specific contracts.

## Three distinct concepts

### Business Action

The immutable canonical Action from Step 1. It says what a merchant could decide
to do.

Examples include changing advertising budget, changing a price, pausing a
campaign, running a promotion, waiting, investigating or running an experiment.

### SimulatorIntervention

A simulator-native, versioned contract describing a causal state transition.

The intervention contract includes:

- deterministic intervention ID;
- intervention type;
- schema version;
- simulator-native target;
- preserved scope;
- SET, DELTA or MULTIPLY operation;
- typed values and units;
- effective time;
- duration and end condition;
- provenance back to the originating business decision and source atomic Action.

It contains no recommendation score, prediction, expected profit, confidence,
rank, lifecycle state, execution state or merchant-facing rationale.

### Translation

Translation is an explicit registry lookup by structured Action type. No natural
language parser or LLM participates in translation.

## Separate modules

The boundary is physically separated:

- src/action_ontology — canonical business language;
- src/simulator_intervention — simulator-native intervention contract;
- src/action_translation — adapter and translation context.

simulator_intervention imports only shared core units. It does not import Action.

action_translation may import Action and SimulatorIntervention contracts, but it
cannot import simulator internals, GroundTruth, evaluator/oracle modules or
economic God-mode layers.

## Versioning

Current versions:

- Action schema: inherited from Step 1;
- SimulatorIntervention schema: 1.0.0;
- Action translation version: 1.0.0;
- TranslationContext schema: 1.0.0.

Unsupported intervention/context versions fail explicitly.

## Translation registry

Each supported Action type has an explicit translator.

Initial registry:

- advertising.adjust_budget → translator.budget.v1
- advertising.pause_campaign → translator.campaign_status.v1
- pricing.adjust_price → translator.price.v1
- promotion.apply_discount → translator.promotion.v1
- merchandising.move_product → translator.merchandising_position.v1
- no_op.do_nothing → translator.no_op.v1
- no_op.wait_observe → translator.wait_observe.v1
- investigation.inspect → translator.investigate.v1
- experimentation.run_experiment → translator.experiment_boundary.v1

No translator may infer meaning from Action.description.

Zero translators produces UNSUPPORTED_ACTION_TYPE.
More than one matching translator produces AMBIGUOUS_TRANSLATION.

## Translation results

The public result contract distinguishes:

- TRANSLATED
- UNSUPPORTED_ACTION_TYPE
- UNSUPPORTED_TARGET
- UNSUPPORTED_SIMULATOR_CAPABILITY
- MISSING_CONTEXT
- INVALID_ACTION
- AMBIGUOUS_TRANSLATION
- EXPERIMENT_REQUIRES_ENGINE

Unsupported behavior is never approximated by another intervention type.

## Translation context

Some structured Actions require information legitimately available at
translation time.

TranslationContext contains only:

- simulator clock;
- declared simulator capabilities;
- canonical Action-target → simulator-target mappings;
- explicit decision-time reference/baseline bindings.

The context rejects future/oracle/evaluator information such as future demand,
future conversions, counterfactual revenue, true incremental ROAS, oracle state,
GroundTruth, evaluator results or optimizer output.

## SET, DELTA and MULTIPLY

Operation type is preserved exactly.

A MULTIPLY business action remains a MULTIPLY simulator intervention. Translation
does not silently turn a relative action into an absolute SET.

DELTA and MULTIPLY operations carry an auditable baseline. The baseline comes
from either:

- an explicit baseline stored in the Action; or
- a matching TranslationContext binding.

If required context is absent, translation returns MISSING_CONTEXT. A baseline is
never guessed.

Units, currency and rate denominator are preserved.

## Timing, duration and scope

Translation copies canonical Action scope into the simulator-native scope
contract without reading descriptions.

A known Action effective start becomes intervention effectiveTime.

Unknown effective start fails with MISSING_CONTEXT rather than being replaced by
the simulator clock.

Duration and termination semantics are preserved, including temporary promotion
duration.

## One-to-one translation

Examples:

Pause Meta campaign
→ SET campaign delivery false

SKU price CAD 899 → CAD 849
→ one DELTA CAD -50 price intervention with explicit CAD 899 baseline

Google Shopping budget ×1.20
→ one MULTIPLY budget intervention with an auditable current-budget baseline

## One-to-many coordinated translation

Step 1 already defined CompoundAction readiness as a grouping of atomic Action
IDs. Step 2 resolves those IDs to canonical atomic Actions without altering the
Action ontology.

The representative reallocation:

Meta prospecting -CAD 2,000/week
+
Google Shopping +CAD 2,000/week

translates into two DELTA interventions.

Both interventions carry:

- the same originatingBusinessActionId — the CompoundAction ID;
- their own sourceActionId;
- component index and component count;
- the same translation version.

Downstream systems therefore cannot mistake the two causal mutations for two
independent merchant decisions.

## Non-causal actions

NO_OP returns an empty intervention list.

WAIT/OBSERVE returns an empty intervention list. Simulation clock advancement is
an orchestration concern, not a merchant intervention.

INVESTIGATE returns an empty intervention list. Investigation does not directly
mutate revenue, demand or customer behavior.

RUN_EXPERIMENT returns EXPERIMENT_REQUIRES_ENGINE with a typed readiness payload.
It is not reduced to a normal state mutation because treatment assignment,
control population and measurement behavior belong to an experiment engine.

## Determinism and fingerprints

Given the same Action, TranslationContext and translation version, translation
returns the same result.

Simulator interventions receive deterministic IDs derived from canonical
intervention semantics. interventionFingerprint provides a deterministic
FNV-1a 64-bit reproducibility fingerprint.

Translation uses no random generation, LLM interpretation, optimizer output,
future simulator state or mutable global registry.

## Validation

Before translation:

- the canonical Action must pass Step 1 runtime validation;
- TranslationContext must pass leakage/version validation;
- an explicit translator must exist exactly once;
- target kind and simulator capability must be supported;
- target mapping must resolve exactly once;
- required relative baselines must resolve exactly once.

SimulatorIntervention runtime validation rejects malformed IDs, versions, targets,
values, units, timestamps, duration, provenance and forbidden prediction/ranking/
lifecycle/oracle fields.

## Architecture enforcement

Dependency-cruiser enforces:

1. Action ontology cannot depend on action_translation or simulator_intervention.
2. simulator_intervention cannot depend on Action ontology.
3. action_translation and simulator_intervention cannot import GroundTruth,
   simulation internals, evaluator/oracle modules or economic God-mode layers.
4. simulation internals cannot import Action ontology directly.

This protects both directions of the boundary.

## Representative fixtures

Step 2 fixtures cover:

1. Google Shopping budget +20% → one MULTIPLY budget intervention.
2. Meta campaign pause → one SET campaign-delivery intervention.
3. SKU CAD 899 → CAD 849 → one DELTA price intervention.
4. Meta→Google CAD 2,000/week reallocation → coordinated decrease + increase.
5. 15% collection promotion for four days → temporary promotion intervention.
6. NO_OP → [].
7. WAIT/OBSERVE → [].
8. INVESTIGATE → [].
9. valid but unsupported CRO page change → UNSUPPORTED_ACTION_TYPE.
10. missing current-budget baseline → MISSING_CONTEXT.
11. RUN_EXPERIMENT → EXPERIMENT_REQUIRES_ENGINE.

## Non-scope

Step 2 does not choose Actions, rank them, predict their outcomes, execute them,
advance simulation time, build experiment assignment, build a Digital Twin
decision policy or implement the Growth Operator.
