# Step 14 external reality: implementation start

Status: foundation only. Step 14 is not frozen. The public repository currently ends at the Step 12 website branch; Step 13's daily time, checkpoint and replay contract has not been published here.

The `external_reality` module provides a versioned, serializable event schedule; persistent events omit `endsAt`, temporary events use an exclusive end. Effects act on upstream causal targets with log multipliers and optional delay, ramp and decay. They are scoped by market, category and channel. The runtime reads the existing `SimulationClock`, while domain-specific counter-based streams derive from the external seed, model version, domain and stable key. This makes draws reproducible and independent of call order.

The operator projection only returns published signals after their availability time. It excludes future events and their effect settings. The full environment is evaluator truth and must remain outside operator interfaces.

Next integration: adopt the frozen Step 13 clock/checkpoint interface; connect effective demand, media auction, supplier and delivery targets upstream of outcome generation; create a hidden truth ledger and realistic evidence adapters; implement interaction/confounding scenarios and multi-year performance tests. These are required before freeze.
