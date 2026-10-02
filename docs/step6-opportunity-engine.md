# Step 6 — Opportunity Engine

This implementation completes the public research contract for Opportunity Engine components 6.1–6.37 on top of the frozen Action Space and Business State integration branch.

The engine is operator-safe. It consumes observed Business State and optional diagnosis output. Evaluator-only truth, oracle answers, latent future state, and optimal-action labels are rejected before generation.

## Architecture

Business State / Diagnosis
→ Opportunity Areas
→ Candidate Interventions
→ Impact / uncertainty / consequences
→ Constraint + feasibility gates
→ Structured Opportunity objects
→ Portfolio construction
→ Decision Engine inputs
→ Canonical Action binding
→ Simulator translation

The Opportunity Engine does not choose a winner. It produces factual candidate inputs for the later Decision Engine.

## Component coverage

| Step | Implementation |
| --- | --- |
| 6.1 | contract.ts defines the complete opportunity contract. |
| 6.2 | diagnosis-adapter.ts and deriveOpportunityAreas convert diagnosis changes and unknowns into intervention areas. |
| 6.3 | templates.ts maintains a cross-domain intervention taxonomy. |
| 6.4 | generateOpportunities generates multiple candidates per opportunity area. |
| 6.5 | Proactive Business State rules detect inventory, lifecycle, merchandising, shipping and return opportunities. |
| 6.6 | Every candidate has a resolved or explicitly unresolved intervention target; unresolved targets cannot become actionable. |
| 6.7 | Candidate parameters are READY, NEEDS_INPUT or NOT_APPLICABLE. |
| 6.8 | Every candidate declares a mechanism from action to primary lever. |
| 6.9 | Mechanisms terminate in contribution profit; measurable outcomes are attached separately. |
| 6.10 | Addressable upside is represented as an evidenced range or explicit unknown. |
| 6.11 | Response curves support nonlinear piecewise response. |
| 6.12 | Incremental effects require experiment, causal-model or observational-bound evidence. Platform attribution alone is not accepted as incremental impact. |
| 6.13 | Revenue, gross profit, contribution profit, CAC, cash and related economics are represented in the impact contract. |
| 6.14 | Estimates use low/base/high ranges and explicit confidence. |
| 6.15 | Merchant Business State constraints are evaluated by intervention family. |
| 6.16 | Feasibility requires capability, target, parameters and resolved constraints. |
| 6.17 | Control conflicts and mutually exclusive alternatives are represented and checked in portfolios. |
| 6.18 | Cannibalization is a mandatory consequence dimension. |
| 6.19 | Cross-channel effects are a mandatory consequence dimension. |
| 6.20 | Inventory effects are a mandatory consequence dimension. |
| 6.21 | Customer effects are a mandatory consequence dimension. |
| 6.22 | Promotion effects are a mandatory consequence dimension. |
| 6.23 | Operational effects are a mandatory consequence dimension. |
| 6.24 | generateOpportunityPortfolios enumerates compatible multi-action portfolios. |
| 6.25 | Dependencies are explicit; paid scaling can depend on conversion remediation. |
| 6.26 | Area alternatives share mutually-exclusive choice groups. |
| 6.27 | Each object exposes impact, uncertainty, cost, effort, reversibility, time-to-impact, risk and dependencies. |
| 6.28 | Every candidate has baseline, success direction, horizon and required evidence. |
| 6.29 | Every candidate has hard-constraint, evidence and guardrail rollback/reconsider conditions. |
| 6.30 | Evidence trace links diagnoses, Business State evidence and estimation evidence. |
| 6.31 | Facts and assumptions are separate structures with distinct identities. |
| 6.32 | Missing effect evidence produces INSUFFICIENT_EVIDENCE rather than invented impact. |
| 6.33 | opportunitySchema is deterministic; actionable opportunities may bind a validated canonical Action for simulator translation. |
| 6.34 | scenario-validation.ts measures candidate recall against evaluator-only expected intervention sets without leaking those labels into generation. |
| 6.35 | Adversarial tests cover ROAS/incrementality, inventory, discount/margin, hidden truth, incomplete evidence and nonlinear response. |
| 6.36 | Coverage tests verify the taxonomy spans paid media, pricing, promotion, CRO, merchandising, inventory, lifecycle/retention, shipping, operations and investigation. |
| 6.37 | A no-action / wait-observe option is always emitted. |

## Safety and evidence rules

An opportunity is ACTIONABLE only when its target is resolved, parameters are executable, required system capability is present, constraints are satisfied, and contribution impact is evidenced.

When causal impact is not established, the engine reports INSUFFICIENT_EVIDENCE. It does not convert platform-attributed revenue into incremental revenue, use simulator ground truth, or manufacture response estimates.

The evaluator-side scenario harness can use known truth to judge candidate recall, but those expected labels are never passed into generateOpportunities.

## Tests

Run:

    npm run test:opportunity

The suite covers candidate generation, diagnosis routing, proactive opportunities, constraints and feasibility, dependencies, mutual exclusion, portfolio validation, no-action, nonlinear response, operator-safety leakage, candidate-set recall and action-space coverage.
