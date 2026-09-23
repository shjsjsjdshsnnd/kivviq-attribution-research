# Step 3.5 — Simple Inventory Heuristic Baselines

## Purpose

Step 3.5 adds four intentionally simple inventory benchmark operators:

1. `FIXED_REORDER_THRESHOLD`
2. `FIXED_REORDER_QUANTITY`
3. `LOW_INVENTORY_DEPROMOTION`
4. `NO_INVENTORY_AWARE_INTERVENTION`

They are deterministic merchant rules, not inventory optimizers.

The suite is stacked on the exact frozen Step 3.4 head:

`3bb897f870c9786933cace0c5fcded978710ec36`

Frozen dependencies:

- Step 3.1 contract commit: `c74e9a4ba32f16aa016f06782cbb60e07e765af6`
- Step 3.1 contract fingerprint: `fnv1a64:b1cc22917a3e566b`
- Action Ontology: `1.6.0`
- metric set: `1.0.0`
- simulator: `customer-journey-simulator-4.0.0`

No earlier baseline, evaluation contract or Action Ontology definition is modified.

## Canonical operator contract

All four operators use the existing `CanonicalOperator` interface and generic evaluator path.

Every operator has:

- unique operator ID;
- version `1.0.0`;
- frozen heuristic type;
- serializable deterministic configuration;
- configuration fingerprint;
- distinct implementation fingerprint;
- exact evaluation-contract dependency;
- Action Ontology dependency;
- simulator dependency;
- metric-set dependency.

No inventory-specific evaluator path exists.

## Observable inventory input

The frozen observation key is:

`inventory.sku_state.v1`

Schema version: `1.0.0`.

Each observable SKU record contains only decision-time merchant information:

- SKU ID;
- product ID;
- active/discontinued state;
- available-to-sell units;
- observable incoming units;
- observable pending-reorder state;
- observable reorder-trigger state;
- observable existing reorder quantity;
- observable supplier availability;
- active promotion IDs.

The operator does not receive:

- future demand;
- future orders;
- future stockouts;
- latent demand;
- GroundTruth;
- future supplier events;
- evaluator-only information.

Missing required permitted information fails closed to no new Action.

## Reorder semantics

### FIXED_REORDER_THRESHOLD

Operator:

`baseline.inventory.fixed_reorder_threshold`

Frozen configuration:

- applicable SKU population: `sku:B`;
- availability concept: `AVAILABLE_TO_SELL`;
- threshold: 10 units;
- comparison: strict `LT`;
- exactly 10 units: no reorder;
- quantity source: observable existing merchant reorder quantity;
- pending/inbound treatment: skip reorder;
- supplier relationship: `supplier:vendor-x:sku-b`;
- destination: `warehouse:montreal`;
- observed/frozen lead-time assumption: 14 days;
- supplier minimum: 10 units;
- order multiple: 10 units;
- supplier maximum: 100 units;
- maximum post-receipt inventory: 200 units.

This operator changes **when** to reorder while using the merchant's observable existing reorder quantity. It does not calculate a new quantity.

### FIXED_REORDER_QUANTITY

Operator:

`baseline.inventory.fixed_reorder_quantity`

Frozen configuration:

- applicable SKU population: `sku:B`;
- trigger source: observable reorder trigger;
- reorder quantity: 50 units;
- pending/inbound treatment: skip reorder;
- supplier/destination/lead-time constraints identical to the threshold fixture;
- maximum post-receipt inventory: 200 units.

This operator changes **how much** to reorder while taking the reorder trigger as an observable input. It does not calculate a dynamic reorder point.

The two operators therefore remain composable and conceptually distinct.

## Inbound/pending semantics

A new reorder is suppressed when either observable condition is true:

- `pendingReorder === true`; or
- `incomingUnits > 0`.

If pending/inbound state is unavailable, the operator does not access simulator internals. It emits no reorder and records the missing permitted information.

This is the duplicate-reorder protection boundary.

Each proposed reorder has a deterministic Action ID derived from:

- heuristic type;
- SKU;
- decision timestamp.

Identical decision input therefore reproduces the same Action identity.

## Supplier / inventory constraints

A reorder is proposed only when its frozen quantity satisfies:

- supplier minimum;
- supplier maximum;
- order multiple;
- maximum post-receipt inventory;
- per-decision legal Action-space target eligibility;
- legal numeric Action bounds.

The heuristic never shrinks or otherwise repairs an order itself.

The generic evaluator remains authoritative for final business constraints and records:

- accepted;
- rejected;
- explicitly modified.

A partially feasible 50-unit order may execute as a 40-unit order only when the evaluator explicitly returns that modified canonical Action. The heuristic itself remains a fixed-50 rule.

## LOW_INVENTORY_DEPROMOTION

Operator:

`baseline.inventory.low_inventory_depromotion`

Frozen configuration:

- applicable SKU: `sku:B`;
- low-inventory threshold: 5 units;
- comparison: strict `LT`;
- exact intervention: stop promotion `promo_collection_x_auto_15`;
- intervention Action: canonical `promotion.stop`;
- restoration behavior: `NO_AUTOMATIC_RESTORATION`;
- minimum duration: 0.

Healthy inventory or inventory exactly at 5 produces no depromotion.

Inventory below 5, including stockout, stops the configured promotion only when that promotion is observably active and the Action is legally available.

Recovery above the threshold does not automatically restart a promotion. That restoration choice is explicitly frozen rather than inferred.

The rule does not inspect predicted demand, stockout probability, margin, CLV, advertising efficiency or future promotion plans.

## NO_INVENTORY_AWARE_INTERVENTION

Operator:

`baseline.inventory.no_inventory_aware_intervention`

This is an explicit inventory-domain control.

Its frozen policy is:

`inventory conditions never create a discretionary Action`

Inventory continues to change normally in the environment. Customer purchases, stockouts, simulator-owned replenishment, supplier processes and demand are not disabled.

The operator has its own ID, configuration, fingerprint and decision audit. It is therefore not an alias for `DO_NOTHING`, even though inventory conditions alone produce `Action[] = []`.

## Decision rationale

Every decision records an `inventory_heuristic_evaluation` audit including where applicable:

- heuristic type;
- operator/version/fingerprints;
- full frozen configuration;
- dependency bindings;
- observation status;
- observable SKU state;
- applicable SKU population;
- available inventory;
- inbound units;
- pending reorder;
- observable reorder trigger;
- observable existing reorder quantity;
- supplier availability;
- active promotion IDs;
- configured threshold;
- configured fixed quantity;
- quantity source;
- trigger result;
- low-stock state;
- inbound state;
- fallback reason;
- proposed Action IDs;
- simulator compatibility.

This is deterministic rule execution, not post-hoc narrative explanation.

## Missing-data / fallback semantics

Frozen default:

`insufficient permitted information → no new inventory Action`

Examples:

- missing inventory observation;
- missing available units;
- missing inbound/pending state;
- missing reorder trigger;
- inactive/discontinued SKU;
- supplier unavailable or unknown;
- pending replenishment;
- configured promotion not active;
- legal target unavailable;
- legal parameter bound violation;
- supplier constraint violation;
- maximum post-receipt inventory violation.

No estimate is invented.

## Anti-optimization boundary

The implementation contains no:

- demand forecasting;
- stockout prediction;
- safety-stock optimization;
- EOQ;
- probabilistic inventory model;
- dynamic reorder point;
- marginal-profit calculation;
- CLV optimization;
- causal inference;
- reinforcement learning;
- learned policy;
- cross-SKU optimization.

Adversarial tests add legally observable current-state context that could make the simple rule look unattractive. The operator output remains governed only by its frozen rule.

Future demand and hidden simulator truth are structurally excluded rather than supplied to the operator.

## Canonical Actions

The reorder baselines emit canonical:

`inventory.reorder`

Actions.

The depromotion baseline emits canonical:

`promotion.stop`

for the configured promotion.

No heuristic-specific Action types exist.

All proposals pass through the normal Step 3.1 legal Action and constraint path.

## Frozen simulator compatibility qualification

The frozen Action Ontology can represent the Step 3.5 decisions rigorously.

The frozen simulator cannot faithfully execute them:

- `inventory.reorder` translates to `INVENTORY_CAPABILITY_UNSUPPORTED_BY_SIMULATOR`;
- `promotion.stop` translates to `PROMOTION_LIFECYCLE_UNSUPPORTED_BY_SIMULATOR`.

The inventory translator explicitly refuses to approximate a purchase order by immediately increasing on-hand stock.

Step 3.5 therefore freezes the operator, Action, validation, provenance and evaluation-artifact contracts, but does not claim causal performance results for triggered reorder/depromotion fixtures under this simulator.

`NO_INVENTORY_AWARE_INTERVENTION` requires no unsupported operator Action and remains compatible with the frozen simulator.

## Paired comparisons

All four operators use the Step 3.1 comparison binding.

Tests prove equivalent comparison-critical bindings against:

- `DO_NOTHING`;
- `STATUS_QUO`;
- a frozen Step 3.4 advertising baseline;
- all Step 3.5 inventory operators.

Bindings preserve identical:

- world;
- simulator version;
- currency;
- horizon;
- metric definitions;
- shared environmental seeds.

Only policy behavior and operator-specific seed binding differ.

## Evaluation artifacts

A deterministic 90-opportunity `EvaluationRunArtifact` and generic `OperatorEvaluationBundle` are constructed for every inventory heuristic.

The fixtures preserve:

- evaluation-contract identity;
- operator identity;
- configuration/fingerprint;
- Action Ontology dependency;
- simulator version;
- world fingerprint;
- metric-set version;
- currency;
- seeds;
- horizon;
- inventory observations;
- thresholds/quantity semantics;
- pending/inbound state;
- decision audits;
- raw proposed Actions;
- legal Action validation;
- constraint disposition;
- executed Action where accepted by the evaluator;
- outcome summary;
- every canonical metric slot.

Because the frozen simulator cannot faithfully execute reorder/promotion-stop semantics, causal performance metrics in those synthetic contract fixtures remain unclaimed rather than fabricated.

## Freeze rule

All thresholds, quantities, depromotion behavior, restoration semantics, inbound handling, fallback rules and boundary conditions are frozen before benchmark outcome evaluation.

Future substantive changes require a new operator/configuration version and fingerprint.
