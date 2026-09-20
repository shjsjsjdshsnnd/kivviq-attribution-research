from __future__ import annotations

# ruff: noqa: I001

import json
from pathlib import Path

from attribution_lab.phase2_evaluator.ledger import (
    EvaluationLedgerEntry,
    ResearchLedger,
)
from phase2_candidate_sdk import fingerprint_payload

ROOT = Path(__file__).resolve().parent
DISCLOSURE = (
    "The holdout-family architecture is public because the repository is public. "
    "The instantiated holdout seeds, parameter values, treatment effects, latent-intent "
    "strengths, interactions, selection mechanisms and corruption settings remained "
    "sealed from Candidate 2 development. This is strong research-process separation, "
    "not a completely secret external benchmark."
)


def _read(name: str) -> dict[str, object]:
    return json.loads((ROOT / name).read_text(encoding="utf-8"))


def main() -> None:
    frozen = _read("FROZEN.json")
    phase1 = _read("frozen_phase1_results.json")
    prereg = _read("preregistration_estimand.json")
    development = _read("development_results.json")
    holdout = _read("holdout_public_metadata.json")

    if bool(phase1["preholdout_eligible"]):
        raise RuntimeError("final rejection script is only valid after pre-holdout rejection")
    if bool(phase1["candidate2_holdout_exposure_consumed"]):
        raise RuntimeError("Candidate 2 holdout must remain unconsumed")
    if bool(development["candidate1_holdout_metrics_used_for_tuning"]):
        raise RuntimeError("Candidate 1 holdout contamination detected")
    if holdout["version"] != "candidate2-holdout-v1":
        raise RuntimeError("Candidate 2 holdout version changed")

    criteria = phase1["criteria"]
    comparison = criteria["observed_selection_comparison_vs_candidate1"]
    rejection_reason = (
        "FROZEN_PHASE1 primary observed-selection comparison failed: Candidate 2 "
        f"aggregate known-zero error {comparison['candidate2_aggregate']:.6f} was not "
        f"lower than Candidate 1 {comparison['candidate1_aggregate']:.6f}, and only "
        f"{comparison['scenario_means_improved']} of 4 required scenario means improved."
    )

    ledger = ResearchLedger(ROOT / "research_state" / "research-ledger.jsonl")
    existing = ledger.records()
    already_recorded = any(
        record.get("entry_type") == "EvaluationLedgerEntry"
        and isinstance(record.get("entry"), dict)
        and record["entry"].get("candidate_id") == frozen["candidate_id"]
        and record["entry"].get("candidate_version") == frozen["candidate_version"]
        for record in existing
    )
    if not already_recorded:
        ledger.append(
            EvaluationLedgerEntry(
                candidate_id=str(frozen["candidate_id"]),
                candidate_version=str(frozen["candidate_version"]),
                estimand_declaration_fingerprint=str(
                    frozen["declaration_fingerprint"]
                ),
                hypothesis_fingerprint=fingerprint_payload(prereg["hypothesis"]),
                candidate_code_fingerprint=str(frozen["code_fingerprint"]),
                development_world_record_fingerprint=str(
                    frozen["development_record_fingerprint"]
                ),
                phase1_reference=str(phase1["phase1_reference"]),
                holdout_version=str(holdout["version"]),
                evaluation_timestamp="2026-09-20T22:31:32+00:00",
                evaluation_protocol_version=str(
                    holdout["evaluation_protocol_version"]
                ),
                results=(
                    ("frozen_phase1_gate", "REJECT"),
                    (
                        "sealed_holdout",
                        "NOT_CONSUMED_PREHOLDOUT_REJECT",
                    ),
                    ("observed_selection_comparison", "FAIL"),
                ),
                uncertainty=(
                    ("method", "aipw-influence-normal-90pct"),
                    (
                        "frozen_phase1_mean_interval_coverage",
                        str(
                            criteria[
                                "mean_interval_coverage_fraction"
                            ]["value"]
                        ),
                    ),
                    ("sealed_holdout", "NOT_EVALUATED"),
                ),
                robustness_results=(
                    (
                        "known_zero_aggregate",
                        str(criteria["known_zero_aggregate"]["value"]),
                    ),
                    (
                        "missing50_effect_change",
                        str(
                            criteria[
                                "missing_50_mean_absolute_effect_vector_change"
                            ]["value"]
                        ),
                    ),
                    (
                        "fragmented_identity_effect_change",
                        str(
                            criteria[
                                "fragmented_identity_mean_absolute_effect_vector_change"
                            ]["value"]
                        ),
                    ),
                    (
                        "small_sample_finite",
                        str(criteria["small_sample_finite_outputs"]["pass"]).lower(),
                    ),
                ),
                outcome="REJECT",
                rejection_reasons=(rejection_reason,),
            )
        )

    family_results = [
        {
            "family": name,
            "status": "NOT_EVALUATED_PREHOLDOUT_REJECT",
            "feedback_exposure_consumed": False,
        }
        for name, _description in holdout["scenario_family_manifest"]
    ]

    final = {
        "candidate_id": frozen["candidate_id"],
        "candidate_version": frozen["candidate_version"],
        "final_outcome": "REJECT",
        "rejection_reasons": [rejection_reason],
        "harness_reference": prereg["harness_reference"],
        "phase1_reference": phase1["phase1_reference"],
        "candidate1_status": "REJECT_FROZEN_UNTOUCHED",
        "candidate1_holdout_used_for_tuning": False,
        "candidate1_holdout_used_for_candidate2_evaluation": False,
        "candidate2_holdout": {
            "version": holdout["version"],
            "generator_fingerprint": holdout["generator_fingerprint"],
            "configuration_fingerprint": holdout["configuration_fingerprint"],
            "creation_timestamp": holdout["creation_timestamp"],
            "sealed_before_candidate2_implementation": True,
            "feedback_bearing_exposure_consumed": False,
            "results_by_family": family_results,
        },
        "frozen_fingerprints": {
            "code": frozen["code_fingerprint"],
            "declaration": frozen["declaration_fingerprint"],
            "development_record": frozen["development_record_fingerprint"],
            "lineage": frozen["lineage_fingerprint"],
        },
        "selected_hyperparameters": frozen["selected_hyperparameters"],
        "development_mean_mae_selected": next(
            item["mean_absolute_error"]
            for item in development["results"]
            if float(item["outcome_l2"]) == 5.0
            and float(item["propensity_l2"]) == 5.0
        ),
        "frozen_phase1": phase1,
        "observed_selection": {
            "stage": "FROZEN_PHASE1",
            "comparison": comparison,
            "pass": False,
        },
        "hidden_confounding": {
            "sealed_family": "latent_intent_shift",
            "status": "NOT_EVALUATED_PREHOLDOUT_REJECT",
            "note": (
                "The sealed hidden-confounding test remains genuinely unseen because "
                "Candidate 2 failed the preregistered Phase 1 pre-holdout gate."
            ),
        },
        "overlap_diagnostics": phase1["overlap_summary"],
        "robustness": {
            "known_zero_aggregate": criteria["known_zero_aggregate"],
            "harmful_effect": criteria["harmful_effect"],
            "missing_50": criteria[
                "missing_50_mean_absolute_effect_vector_change"
            ],
            "fragmented_identity": criteria[
                "fragmented_identity_mean_absolute_effect_vector_change"
            ],
            "small_sample_finite": criteria["small_sample_finite_outputs"],
        },
        "uncertainty": {
            "method": "90% empirical AIPW influence-function normal interval",
            "frozen_phase1_mean_interval_coverage": criteria[
                "mean_interval_coverage_fraction"
            ],
            "sealed_holdout_coverage": "NOT_EVALUATED",
        },
        "public_holdout_limitation_disclosure": DISCLOSURE,
        "scientific_limit": (
            "Doubly robust does not mean robust to unobserved confounding. "
            "Candidate 2 did not earn access to its sealed hidden-confounding test."
        ),
        "no_private_or_production_data_accessed": True,
        "no_merge_or_deploy": True,
        "candidate3_implemented": False,
    }
    (ROOT / "candidate2_final.json").write_text(
        json.dumps(final, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )

    c2_means = comparison["candidate2_scenario_mean_absolute_estimates"]
    c1_means = comparison["candidate1_scenario_mean_absolute_estimates"]
    lines = [
        "# Candidate 2 final research report",
        "",
        f"Candidate: `{frozen['candidate_id']}` v`{frozen['candidate_version']}`",
        "",
        "## Final outcome",
        "",
        "**REJECT**",
        "",
        rejection_reason,
        "",
        "Candidate 2 failed before sealed-holdout eligibility. "
        "`candidate2-holdout-v1` remains sealed and unconsumed.",
        "",
        "## DEVELOPMENT",
        "",
        (
            "The preregistered 3×3 nuisance-regularization grid selected "
            "**outcome L2 = 5.0** and **propensity L2 = 5.0** using development "
            "worlds only."
        ),
        "",
        (
            "Selected development mean effect MAE: "
            f"**{final['development_mean_mae_selected']:.4f}**."
        ),
        "",
        "Candidate 1 holdout metrics, frozen Phase 1 results and the Candidate 2 "
        "holdout were not used for development tuning.",
        "",
        "## FROZEN_PHASE1 — observed-selection comparison",
        "",
        "| Scenario | Candidate 2 | Candidate 1 frozen comparator | Improved? |",
        "| --- | ---: | ---: | --- |",
    ]
    for scenario in (
        "demand_capture",
        "retargeting_selection",
        "null_channel_high_intent",
        "null_channel_retargeting",
    ):
        c2 = float(c2_means[scenario])
        c1 = float(c1_means[scenario])
        lines.append(
            f"| {scenario} | {c2:.4f} | {c1:.4f} | "
            f"{'yes' if c2 < c1 else 'no'} |"
        )
    lines.extend(
        [
            "",
            (
                "Candidate 2 aggregate: "
                f"**{comparison['candidate2_aggregate']:.5f}**; Candidate 1 aggregate: "
                f"**{comparison['candidate1_aggregate']:.5f}**. Candidate 2 improved "
                f"**{comparison['scenario_means_improved']} of 4** scenario means; "
                "the preregistered requirement was at least 3 of 4 plus lower aggregate error."
            ),
            "",
            "## Other frozen Phase 1 evidence",
            "",
            (
                "- Overall perfect-observation mean effect MAE: "
                f"**{criteria['overall_perfect_observation_mean_effect_mae']['value']:.4f}** — PASS."
            ),
            (
                "- Known-zero aggregate mean absolute effect: "
                f"**{criteria['known_zero_aggregate']['value']:.4f}** — PASS."
            ),
            (
                "- Mean interval coverage: "
                f"**{criteria['mean_interval_coverage_fraction']['value']:.4f}** — PASS."
            ),
            (
                "- Harmful-channel mean estimate: "
                f"**{criteria['harmful_effect']['mean_estimate']:.4f}**; mean absolute "
                f"error **{criteria['harmful_effect']['mean_absolute_error']:.4f}** — PASS."
            ),
            (
                "- Missing-50 mean absolute effect-vector change: "
                f"**{criteria['missing_50_mean_absolute_effect_vector_change']['value']:.4f}** — PASS."
            ),
            (
                "- Fragmented-identity effect-vector change: "
                f"**{criteria['fragmented_identity_mean_absolute_effect_vector_change']['value']:.4f}** — PASS."
            ),
            "",
            "## Propensity / overlap diagnostics",
            "",
            (
                "- Minimum treated/control ESS across perfect Phase 1 cases: "
                f"**{phase1['overlap_summary']['minimum_arm_ess_across_perfect_cases']:.3f}**."
            ),
            (
                "- Maximum extreme raw propensity fraction across perfect cases: "
                f"**{phase1['overlap_summary']['maximum_extreme_propensity_fraction_across_perfect_cases']:.3f}**."
            ),
            (
                "- Maximum clipped inverse weight across perfect cases: "
                f"**{phase1['overlap_summary']['maximum_inverse_weight_across_perfect_cases']:.3f}**."
            ),
            "",
            "These are diagnostics. No post-hoc Phase 1 overlap threshold was added.",
            "",
            "## Hidden-confounding performance",
            "",
            "**NOT EVALUATED.** Candidate 2 failed its preregistered pre-holdout gate, "
            "so the sealed `latent_intent_shift` family was never exposed. This preserves "
            "the new holdout as genuinely unseen historical evidence rather than consuming "
            "it for a candidate that was already rejected.",
            "",
            "## Sealed Candidate 2 holdout",
            "",
            f"- Version: `{holdout['version']}`",
            f"- Generator fingerprint: `{holdout['generator_fingerprint']}`",
            f"- Configuration fingerprint: `{holdout['configuration_fingerprint']}`",
            "- Feedback-bearing exposures consumed: **0**",
            "- Results by family: **NOT EVALUATED — PREHOLDOUT REJECT**",
            "",
            "## Scientific interpretation",
            "",
            "The doubly robust hypothesis did not satisfy its primary public Phase 1 "
            "selection criterion. This does not show that doubly robust estimation is "
            "generally ineffective; it rejects this frozen Candidate 2 specification "
            "under its preregistered synthetic protocol.",
            "",
            "**Doubly robust does not mean robust to unobserved confounding.** The sealed "
            "hidden-confounding test was not reached, so no claim about Candidate 2's "
            "performance under the new hidden-latent-intent holdout is warranted.",
            "",
            "## Public holdout limitation",
            "",
            DISCLOSURE,
            "",
            "## Boundaries",
            "",
            "- Candidate 1 remains permanently frozen as REJECT and was not modified.",
            "- Candidate 1's sealed holdout was not reused.",
            "- Phase 1 remains frozen.",
            "- No private Kivviq, merchant, production or external merchant system was accessed.",
            "- No merge or deployment occurred.",
            "- Candidate 3 was not implemented.",
            "",
        ]
    )
    (ROOT / "candidate2_report.md").write_text(
        "\n".join(lines).rstrip() + "\n",
        encoding="utf-8",
    )
    print("CANDIDATE2_FINAL=" + json.dumps(final, sort_keys=True))


if __name__ == "__main__":
    main()
