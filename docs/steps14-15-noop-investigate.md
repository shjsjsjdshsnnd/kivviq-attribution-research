# Steps 14–15: NO_OP and INVESTIGATE

`no_op.do_nothing` is an explicit decision to introduce no new business intervention in its target and timing scope. Merchant, advertising channel, campaign, product, SKU, and customer segment targets are accepted. The simulator translator returns `TRANSLATED` with an empty intervention list. This does not freeze the clock, cancel existing actions, or imply zero future profit. `no_op.wait_observe` remains a separate decision with an observation boundary.

`investigation.inspect` describes evidence acquisition. Its structured parameters can identify a source, metric, target, observation and comparison windows, suspected issue class, requested evidence, success criteria, and maximum duration. Missing data requests require a specific target and metric; anomaly diagnosis requires a metric and two valid windows; tracking audits require a source and metric. The existing Action timing controls *when the investigation runs*; the observation window controls *which evidence it inspects*. Resource requirements and known costs use the existing Action cost contract.

Investigation readiness and results are separate contracts in `src/action_ontology/investigation.ts`. An Action never contains findings or a predicted value of information. An investigation also translates to zero commercial simulator interventions, but it retains its own Action type and identity, including inside compounds. Unsupported commercial actions remain unsupported; they do not become investigations.

Step 13 compound composition is inherited from `action-space/step13-compound-actions`. These steps do not implement investigation execution, outcome evaluation, or a recommendation policy.
