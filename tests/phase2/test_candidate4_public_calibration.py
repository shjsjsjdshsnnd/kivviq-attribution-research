from attribution_lab.phase2_calibration.candidate4_public import run_calibration


def test_public_calibration_is_deterministic_and_separates_limitations() -> None:
    records = run_calibration()
    assert len(records) == 96
    assert {record["structural_class"] for record in records} >= {
        "STRUCTURALLY_FULL_POPULATION_SUPPORTED",
        "STRUCTURALLY_OVERLAP_ONLY",
        "STRUCTURALLY_UNSUPPORTED",
    }
    assert any(record["finite_sample_limited"] for record in records)
    assert any(record["measurement_limited"] for record in records)
    assert all("true_propensity" not in record["observable_diagnostics"] for record in records)
    assert {
        "propensity_min",
        "propensity_max",
        "fraction_005_095",
        "fraction_010_090",
        "normalized_treated_ess",
        "normalized_control_ess",
        "overlap_weighted_ess",
    } <= set(records[0]["observable_diagnostics"])
