# Phase 1 continuation: adaptive expenditure and prospective decision evaluation

Status: active research, not a Phase 1 acceptance certificate. This continuation
extends PR #59 without changing frozen simulator/CRO formulas or the existing
measurement-only scenario qualifications.

## Adaptive budget actions

`InteractiveReplayWorld` is now `interactive-replay-world/0.2.0`. It accepts an
optional evaluator-owned `ScheduledSpendPlan` and registered `budgetAdjustments`.
The Operator facade is unchanged: `observe()` and `step(actionId)` only. Reset,
spend schedules, simulator requests, costs and ground truth are evaluator-only.

A registered budget action has explicit channel, operation (`set` or `delta`),
and minor-unit amount per a fixed reference period. For example, a 100000-minor
unit delta with a seven-day reference is +$1,000 per week, not a one-off charge.
The reference must be recorded in the evaluator configuration and in the public
business-action description supplied to the policy by the eventual canonical
Action adapter. Neutral IDs alone do not communicate business intent.

Budget changes start one millisecond after the current observation cutoff. The
complete initial world and action history are replayed. A step is committed only
when its predecision observation is unchanged. Invalid changes leave the previous
world, history, clock and expenditure ledger intact. Reset clears both merchant
interventions and budget decisions and reproduces the same sequence under a fixed
seed. This is replay, not a native checkpoint implementation.

## Expenditure contract

`scheduled-spend/1.0.0` represents a declared synthetic, fully-spent allocation
rate. It is not an auction-fill model and does not assert that real platforms
always spend a merchant's budget. The ledger is independent of purchases,
customer conversion, platform credit and the order-revenue spend proxy.

- The rate is integrated in integer milliseconds.
- Cumulative BigInt arithmetic retains fractional cents until they form whole cents.
- Debits are reported only for completed daily buckets (including the last partial day).
- An open bucket is not represented as fully observed expenditure.
- Future decisions cannot change previously delivered debit entries.
- Meta and Google feeds are projections of the same ledger; Pinterest and affiliate
  expense still count in evaluator economics even though the current observed
  platform-report schema contains only Meta and Google.
- Rates are normalized to the fixed whole-episode response-curve allocation, never
  to the changing as-of window. Non-integral/overflowing response coefficients are
  rejected rather than silently rounded.
- Competing spend authorities, inactive-channel budgets, retroactive changes,
  duplicate decisions and negative budgets fail closed.

Because actions begin after the cutoff, a rate change may differ from a nominal
whole-day allocation by a cent. Tests assert the exact rational debit, not a
rounded headline amount.

## Prospective finite decision oracle

`scheduled-decision-oracle/0.1.0` runs a warmup observation before each branch.
It then schedules candidate actions strictly after that observation and evaluates
only subsequent booked contribution. Every candidate must reproduce the identical
predecision observed payload and booked economic state. Future results, action
scores and candidate labels never enter that payload.

The finite action set, horizon, common seeds, action payloads and execution budget
are explicit. The execution budget includes the baseline warmup runs, not only
candidate evaluations. Candidate failure aborts the comparison rather than ranking
a partial surviving set. The existing finite oracle retains its explicit distinction
between a single realized seed and a Monte Carlo estimate.

The economics adapter includes product-level COGS, payment fees, shipping,
fulfillment, variable costs, all paid expenditure including nonbuyers, and declared
implementation cost. Scope is **explicit unweighted agents; booked contribution;
closed daily expense buckets; no returns, CLV or overhead**. Unsupported inventory,
retention, external-cost or promotion-policy extensions fail explicitly instead of
silently dropping costs. This is not yet the complete long-horizon merchant oracle.

## Retargeting decision scenario

`retargeting-budget-decision/0.1.0` reuses the existing Step 5 retargeting fixture,
now behind the actual measurement layer and a prospective decision cutoff.

- Episode: January 1–May 1, 2026.
- Operator observation: data available through February 1, 2026.
- Candidate changes: effective February 1, 2026, plus one millisecond.
- Scored economic consequences: after the February 1 cutoff through the episode end.
- Registered finite subspace: no-op, Meta allocation +$1,000, Meta off, Google Search
  allocation +$1,000, and Google Search off. Allocation deltas are whole-episode
  reference rates, so only their remaining-period fraction is spent after the decision.
- Development seeds: 105002 and 105003.
- Separate public validation seeds: 205002 and 205003. These are not sealed holdouts.

The verifier requires observed Meta ROAS above one, nonempty future commerce,
identical future purchases with Meta off, no extra purchases from increasing Meta,
lower true contribution from that increase, Meta-off outperforming Meta-scale, and
identical predecision information for every candidate. There is no seed filtering.

This is a verified finite-budget decision mechanism only when every registered
predicate passes. It is **not** a complete canonical BusinessAction scenario and
does not automatically count toward the Phase 1 target of 20 accepted scenarios.
No results from this synthetic control are recommendations for a real merchant.

## Inherited imagery failure

The existing Step 12 imagery assertion is retained without changes. The old formula
averages imagery with other PDP qualities and then applies a saturating response.
In the registered fixture, moving imagery from 0.24 to 0.96 changes the transition
multiplier by 0.027118619084284035, below the existing >0.05 requirement. The failure
is a model/fixture magnitude mismatch, not a flaky measurement or build test.

No coefficients, frozen fixtures, or assertions were adjusted to manufacture a green
suite. Resolving it requires a documented model/fixture-contract revision; the full
repository remains blocked until that is properly addressed.

## Remaining release gates

The full 20-scenario decision library, full canonical Action adapter, checkpoint
integration, return/retention/inventory-aware oracle, sealed evaluation, dependency
locking, broader distribution evidence, inherited regression repair and isolated
execution for untrusted algorithms remain open. No merge, freeze or deployment is
authorized by this continuation.
