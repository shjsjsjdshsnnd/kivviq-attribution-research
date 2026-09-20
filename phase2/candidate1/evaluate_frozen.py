from __future__ import annotations

import argparse
import importlib.util
import json
import math
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path
from statistics import mean
from types import ModuleType
from typing import Any

from attribution_lab.phase2.constants import EVALUATION_PROTOCOL_VERSION, FROZEN_PHASE1_COMMIT
from attribution_lab.phase2.phase1_adapter import FrozenPhase1Adapter
from attribution_lab.phase2.registration import CandidateRegistry
from attribution_lab.phase2_evaluator.evaluator import HoldoutEvaluator
from attribution_lab.phase2_evaluator.gates import apply_preregistered_gate
from attribution_lab.phase2_evaluator.isolation import CandidateRunner
from attribution_lab.phase2_evaluator.ledger import EvaluationLedgerEntry, ResearchLedger
from attribution_lab.phase2_evaluator.results import (
    REQUIRED_HOLDOUT_LIMITATION_DISCLOSURE,
    EvaluationStage,
    GateOutcome,
    ScenarioResult,
    ScenarioStatus,
    SeparatedEvaluationReport,
)
from attribution_lab.phase2_evaluator.seals import HoldoutSealStore
from attribution_lab.runner import ExperimentSpec, quick_benchmark_specs
from phase2_candidate_sdk import DeclaredContext, fingerprint_payload

ROOT = Path(__file__).resolve().parents[2]
SOURCE = (ROOT / "phase2" / "candidate1" / "candidate.py").read_text(encoding="utf-8")
PROTOCOL = json.loads((ROOT / "phase2" / "candidate1" / "falsification_protocol.json").read_text())
DEVELOPMENT_RESULTS = json.loads((ROOT / "phase2" / "candidate1" / "development_results.json").read_text())


def _load_spec() -> ModuleType:
    path = ROOT / "phase2" / "candidate1" / "spec.py"
    module_spec = importlib.util.spec_from_file_location("candidate1_spec", path)
    if module_spec is None or module_spec.loader is None:
        raise RuntimeError("unable to load frozen Candidate 1 spec")
    module = importlib.util.module_from_spec(module_spec)
    module_spec.loader.exec_module(module)
    return module


SPEC = _load_spec()
DECLARATION = SPEC.DECLARATION
DEVELOPMENT_RECORD = SPEC.DEVELOPMENT_RECORD


def _score(response, truth: dict[str, float]) -> dict[str, float]:
    estimates = dict(response.estimates)
    common = sorted(set(estimates) & set(truth))
    if not common:
        return {"mean_absolute_error": math.inf, "max_absolute_error": math.inf, "coverage_fraction": 0.0, "interval_coverage_fraction": 0.0}
    errors = [abs(estimates[key] - truth[key]) for key in common]
    interval_coverage = 0.0
    if response.uncertainty is not None:
        lower = dict(response.uncertainty.lower)
        upper = dict(response.uncertainty.upper)
        interval_coverage = sum(int(lower[k] <= truth[k] <= upper[k]) for k in common) / len(common)
    return {
        "mean_absolute_error": sum(errors) / len(errors),
        "max_absolute_error": max(errors),
        "coverage_fraction": len(common) / len(truth),
        "interval_coverage_fraction": interval_coverage,
    }


def _case(runner: CandidateRunner, spec: ExperimentSpec) -> dict[str, Any]:
    case = FrozenPhase1Adapter.build_case(spec.scenario, seed=spec.seed, sample_size=spec.sample_size, observation_quality=spec.observation_quality)
    response = runner.execute(
        SOURCE,
        case.observable_dataset,
        DeclaredContext(
            stage=EvaluationStage.FROZEN_PHASE1.value,
            scenario_family=case.scenario,
            estimand_fingerprint=fingerprint_payload(asdict(DECLARATION.estimand)),
            phase1_reference=case.phase1_reference,
            holdout_version=None,
            protocol_version=EVALUATION_PROTOCOL_VERSION,
        ),
    )
    return {
        "scenario":spec.scenario,"seed":spec.seed,"sample_size":spec.sample_size,
        "observation_quality":spec.observation_quality,"metrics":_score(response,dict(case.synthetic_truth)),
        "uncertainty_present":response.uncertainty is not None,
    }


def _find(rows, scenario, quality):
    return [r for r in rows if r["scenario"] == scenario and r["observation_quality"] == quality]


def _phase1_gate(rows):
    c=PROTOCOL["phase1_criteria"]; failures=[]
    sel=[r for r in rows if r["scenario"] in {"demand_capture","retargeting_selection"} and r["observation_quality"]=="perfect"]
    selection_max=max(r["metrics"]["mean_absolute_error"] for r in sel)
    if selection_max>c["selection_world_max_mae"]["threshold"]: failures.append("selection_world_max_mae")
    nulls=[r for r in rows if (r["scenario"]=="null_paid_channel" or r["scenario"].startswith("null_channel_")) and r["observation_quality"]=="perfect"]
    null_max=max(r["metrics"]["mean_absolute_error"] for r in nulls)
    if null_max>c["null_world_max_mae"]["threshold"]: failures.append("null_world_max_mae")
    harmful=max(r["metrics"]["mean_absolute_error"] for r in _find(rows,"harmful_channel","perfect"))
    if harmful>c["harmful_world_max_mae"]["threshold"]: failures.append("harmful_world_max_mae")
    missing=max(r["metrics"]["mean_absolute_error"] for r in _find(rows,"balanced_multi_touch","missing_50"))
    if missing>c["missing_50_max_mae"]["threshold"]: failures.append("missing_50_max_mae")
    fragmented=max(r["metrics"]["mean_absolute_error"] for r in _find(rows,"balanced_multi_touch","fragmented_identity"))
    if fragmented>c["fragmented_identity_max_mae"]["threshold"]: failures.append("fragmented_identity_max_mae")
    min_cov=min(r["metrics"]["coverage_fraction"] for r in rows)
    if min_cov<c["minimum_output_coverage"]: failures.append("minimum_output_coverage")
    perfect=[r for r in rows if r["observation_quality"]=="perfect"]
    int_cov=mean(r["metrics"]["interval_coverage_fraction"] for r in perfect)
    if int_cov<c["minimum_mean_interval_coverage_on_perfect_cases"]: failures.append("minimum_mean_interval_coverage_on_perfect_cases")
    return not failures, failures, {"selection_world_max_mae":selection_max,"null_world_max_mae":null_max,"harmful_world_mae":harmful,"missing_50_mae":missing,"fragmented_identity_mae":fragmented,"minimum_output_coverage":min_cov,"mean_interval_coverage":int_cov}


def _robust_specs():
    specs=[]
    for seed in (7,17,29):
        for size in (80,250,800): specs.append(ExperimentSpec("balanced_multi_touch",seed,size,"perfect"))
    for q in ("missing_10","missing_25","missing_50","fragmented_identity"): specs.append(ExperimentSpec("balanced_multi_touch",17,250,q))
    specs += [
        ExperimentSpec("retargeting_selection",7,250,"perfect"),
        ExperimentSpec("retargeting_selection",29,250,"perfect"),
        ExperimentSpec("strong_first_touch",17,250,"perfect"),
        ExperimentSpec("strong_final_touch",17,250,"perfect"),
        ExperimentSpec("balanced_rare_channels",17,80,"perfect"),
    ]
    return specs


def _robust_gate(rows):
    c=PROTOCOL["robustness_criteria"]; failures=[]
    if any(not math.isfinite(r["metrics"]["mean_absolute_error"]) or r["metrics"]["coverage_fraction"]<1.0 for r in rows): failures.append("all_runs_numerically_valid")
    n80=max(r["metrics"]["mean_absolute_error"] for r in rows if r["sample_size"]==80 and r["observation_quality"]=="perfect")
    if n80>c["n80_max_mae"]: failures.append("n80_max_mae")
    missing=max(r["metrics"]["mean_absolute_error"] for r in _find(rows,"balanced_multi_touch","missing_50"))
    if missing>c["missing_50_max_mae"]: failures.append("missing_50_max_mae")
    frag=max(r["metrics"]["mean_absolute_error"] for r in _find(rows,"balanced_multi_touch","fragmented_identity"))
    if frag>c["fragmented_identity_max_mae"]: failures.append("fragmented_identity_max_mae")
    selection=max(r["metrics"]["mean_absolute_error"] for r in _find(rows,"retargeting_selection","perfect"))
    if selection>c["selection_shift_max_mae"]: failures.append("selection_shift_max_mae")
    temporal=max(r["metrics"]["mean_absolute_error"] for r in rows if r["scenario"] in {"strong_first_touch","strong_final_touch"})
    if temporal>c["temporal_shift_max_mae"]: failures.append("temporal_shift_max_mae")
    int_cov=mean(r["metrics"]["interval_coverage_fraction"] for r in rows)
    if int_cov<c["minimum_mean_interval_coverage"]: failures.append("minimum_mean_interval_coverage")
    m80=mean(r["metrics"]["mean_absolute_error"] for r in rows if r["scenario"]=="balanced_multi_touch" and r["observation_quality"]=="perfect" and r["sample_size"]==80)
    m800=mean(r["metrics"]["mean_absolute_error"] for r in rows if r["scenario"]=="balanced_multi_touch" and r["observation_quality"]=="perfect" and r["sample_size"]==800)
    diff=abs(m80-m800)
    if diff>c["max_mean_mae_difference_n80_vs_n800"]: failures.append("max_mean_mae_difference_n80_vs_n800")
    return not failures, failures, {"n80_max_mae":n80,"missing_50_mae":missing,"fragmented_identity_mae":frag,"selection_shift_max_mae":selection,"temporal_shift_max_mae":temporal,"mean_interval_coverage":int_cov,"mean_mae_n80":m80,"mean_mae_n800":m800,"mean_mae_difference_n80_vs_n800":diff}


def main():
    parser=argparse.ArgumentParser(); parser.add_argument("--output",required=True); parser.add_argument("--seal-dir",required=True); args=parser.parse_args()
    out=Path(args.output); out.mkdir(parents=True,exist_ok=True)
    seal=Path(args.seal_dir); seal.mkdir(parents=True,exist_ok=True)
    runner=CandidateRunner()

    phase1=[_case(runner,s) for s in quick_benchmark_specs()]
    ppass,pfails,psum=_phase1_gate(phase1)

    registry=CandidateRegistry(out/"registrations")
    registered=registry.register(DECLARATION,SOURCE,DEVELOPMENT_RECORD,registered_at=datetime.now(UTC).isoformat())
    ledger=ResearchLedger(out/"research-ledger.jsonl")
    seals=HoldoutSealStore(seal)
    public_meta=seals.create("holdout-v1",created_at=datetime.now(UTC).isoformat())
    evaluator=HoldoutEvaluator(seals,registry,ledger,runner=runner)
    holdout=evaluator.evaluate(DECLARATION,SOURCE,holdout_version="holdout-v1")
    separated=SeparatedEvaluationReport((),(),holdout,REQUIRED_HOLDOUT_LIMITATION_DISCLOSURE)
    hdecision=apply_preregistered_gate(separated,DECLARATION)

    robust=[_case(runner,s) for s in _robust_specs()]
    rpass,rfails,rsum=_robust_gate(robust)

    if not ppass or not rpass or hdecision.outcome==GateOutcome.REJECT: final="REJECT"
    elif hdecision.outcome==GateOutcome.INCONCLUSIVE: final="INCONCLUSIVE"
    else: final="SURVIVE"

    ledger.append(EvaluationLedgerEntry(
        candidate_id=DECLARATION.candidate_id,candidate_version=DECLARATION.version,
        estimand_declaration_fingerprint=fingerprint_payload(asdict(DECLARATION.estimand)),
        hypothesis_fingerprint=fingerprint_payload({"hypothesis":DECLARATION.hypothesis}),
        candidate_code_fingerprint=registered.code_fingerprint,
        development_world_record_fingerprint=registered.development_record_fingerprint,
        phase1_reference=FROZEN_PHASE1_COMMIT,holdout_version="holdout-v1",
        evaluation_timestamp=datetime.now(UTC).isoformat(),evaluation_protocol_version=EVALUATION_PROTOCOL_VERSION,
        results=(("phase1_gate","PASS" if ppass else "FAIL"),("holdout_gate",hdecision.outcome.value)),
        uncertainty=(("method",DECLARATION.uncertainty_method),),
        robustness_results=(("robustness_gate","PASS" if rpass else "FAIL"),),
        outcome=final,rejection_reasons=tuple([*pfails,*hdecision.reasons,*rfails]),
    ))
    ledger.verify()

    holdout_rows=[{"family":x.family,"status":x.status.value,"metrics":dict(x.metrics),"uncertainty_present":x.uncertainty_present,"reason":x.reason} for x in holdout]
    report={
        "candidate_id":DECLARATION.candidate_id,"candidate_version":DECLARATION.version,
        "candidate_fingerprint":registered.lineage_fingerprint,"candidate_code_fingerprint":registered.code_fingerprint,
        "declaration_fingerprint":registered.declaration_fingerprint,"development_record_fingerprint":registered.development_record_fingerprint,
        "estimand":asdict(DECLARATION.estimand),"hypothesis":DECLARATION.hypothesis,
        "estimator":"AIPW with ridge-logistic nuisance models","development_results":DEVELOPMENT_RESULTS,
        "phase1_reference":FROZEN_PHASE1_COMMIT,"frozen_phase1_results":phase1,
        "phase1_gate":{"pass":ppass,"failures":pfails,"summary":psum},
        "sealed_holdout_version":"holdout-v1","sealed_holdout_public_metadata":public_meta.as_dict(),
        "holdout_exposure_consumed_count":sum(1 for e in ledger.exposure_entries() if e.event_type.value=="FEEDBACK_CONSUMED" and e.holdout_version=="holdout-v1"),
        "sealed_holdout_results":holdout_rows,
        "holdout_gate":{"outcome":hdecision.outcome.value,"reasons":list(hdecision.reasons)},
        "robustness_results":robust,"robustness_gate":{"pass":rpass,"failures":rfails,"summary":rsum},
        "uncertainty_method":DECLARATION.uncertainty_method,
        "holdout_limitation_disclosure":REQUIRED_HOLDOUT_LIMITATION_DISCLOSURE,
        "final_outcome":final,"real_world_claims":"none"
    }
    (out/"candidate1_report.json").write_text(json.dumps(report,indent=2,sort_keys=True)+"\n",encoding="utf-8")
    (out/"holdout_public_metadata.json").write_text(json.dumps(public_meta.as_dict(),indent=2,sort_keys=True)+"\n",encoding="utf-8")
    md=["# Candidate 1 frozen evaluation","",f"Candidate: `{DECLARATION.candidate_id}@{DECLARATION.version}`",f"Frozen candidate fingerprint: `{registered.lineage_fingerprint}`",f"Final outcome: **{final}**","","## Phase 1 gate",f"Pass: {ppass}",f"Failures: {pfails}","","## Sealed holdout gate",f"Outcome: {hdecision.outcome.value}",f"Reasons: {list(hdecision.reasons)}","","| Holdout family | MAE | Max error | Coverage | Interval coverage |","| --- | ---: | ---: | ---: | ---: |"]
    for row in holdout_rows:
        m=row["metrics"]; md.append(f"| {row['family']} | {m.get('mean_absolute_error',math.nan):.4f} | {m.get('max_absolute_error',math.nan):.4f} | {m.get('coverage_fraction',math.nan):.3f} | {m.get('interval_coverage_fraction',math.nan):.3f} |")
    md += ["","## Robustness gate",f"Pass: {rpass}",f"Failures: {rfails}","","## Holdout limitation","",REQUIRED_HOLDOUT_LIMITATION_DISCLOSURE,"","Synthetic causal recovery is not real-world causal accuracy or production readiness."]
    (out/"candidate1_report.md").write_text("\n".join(md)+"\n",encoding="utf-8")
    print(json.dumps({"candidate_fingerprint":registered.lineage_fingerprint,"phase1_gate_pass":ppass,"holdout_gate":hdecision.outcome.value,"robustness_gate_pass":rpass,"holdout_exposure_consumed_count":report["holdout_exposure_consumed_count"],"final_outcome":final},sort_keys=True))


if __name__=="__main__":
    main()
