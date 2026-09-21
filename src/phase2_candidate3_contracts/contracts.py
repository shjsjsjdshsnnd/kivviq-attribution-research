from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime
from enum import StrEnum
from typing import Any

from phase2_candidate_sdk import fingerprint_payload


class Candidate3Decision(StrEnum):
    ESTIMATE_ATO = "ESTIMATE_ATO"
    ABSTAIN_PRETREATMENT_INVALID = "ABSTAIN_PRETREATMENT_INVALID"
    ABSTAIN_INADEQUATE_SUPPORT = "ABSTAIN_INADEQUATE_SUPPORT"
    ABSTAIN_INADEQUATE_FINITE_SAMPLE = "ABSTAIN_INADEQUATE_FINITE_SAMPLE"


class SupportStatus(StrEnum):
    ADEQUATE = "ADEQUATE"
    INADEQUATE = "INADEQUATE"


class FiniteSampleStatus(StrEnum):
    ADEQUATE = "ADEQUATE"
    INADEQUATE = "INADEQUATE"


@dataclass(frozen=True, slots=True)
class ATOEstimandContract:
    candidate_id: str
    version: str
    focal_treatment: str
    outcome: str
    horizon_hours: float
    unit_of_analysis: str
    decision_opportunity_definition: str
    propensity_definition: str
    overlap_weight_definition: str
    estimand_formula: str
    target_population: str
    full_population_ate_status: str
    latent_confounding_scope: str

    def __post_init__(self) -> None:
        if self.horizon_hours <= 0:
            raise ValueError("ATO horizon must be positive")
        if self.full_population_ate_status != "NOT_ESTIMATED":
            raise ValueError("Candidate 3 must not silently answer a full-population ATE")
        if "e(X_t)*(1-e(X_t))" not in self.overlap_weight_definition:
            raise ValueError("overlap population weight must be explicitly defined")

    @property
    def fingerprint(self) -> str:
        return fingerprint_payload(asdict(self))


@dataclass(frozen=True, slots=True)
class PretreatmentFeatureSpec:
    name: str
    rationale: str
    temporal_rule: str
    provenance_rule: str
    treatment_time_indexed: bool = True

    def __post_init__(self) -> None:
        if not all(
            value.strip()
            for value in (
                self.name,
                self.rationale,
                self.temporal_rule,
                self.provenance_rule,
            )
        ):
            raise ValueError("pre-treatment feature specifications must be explicit")
        if not self.treatment_time_indexed:
            raise ValueError("Candidate 3 X must be treatment-time indexed")


@dataclass(frozen=True, slots=True)
class PretreatmentXContract:
    focal_decision_time_requirement: str
    untreated_opportunity_requirement: str
    permitted_features: tuple[PretreatmentFeatureSpec, ...]
    explicitly_forbidden_features: tuple[str, ...]
    missing_provenance_policy: str
    no_future_information_rule: str

    def __post_init__(self) -> None:
        if not self.permitted_features:
            raise ValueError("at least one pre-treatment feature must be declared")
        if len({feature.name for feature in self.permitted_features}) != len(
            self.permitted_features
        ):
            raise ValueError("pre-treatment feature names must be unique")
        if not self.explicitly_forbidden_features:
            raise ValueError("forbidden post-treatment features must be explicit")

    @property
    def fingerprint(self) -> str:
        return fingerprint_payload(asdict(self))


@dataclass(frozen=True, slots=True)
class SupportAbstentionContract:
    propensity_central_lower: float
    propensity_central_upper: float
    minimum_central_overlap_fraction: float
    minimum_normalized_overlap_mass: float
    minimum_treated_count: int
    minimum_control_count: int
    minimum_total_overlap_ess: float
    minimum_treated_overlap_ess: float
    minimum_control_overlap_ess: float
    minimum_outcome_events: int
    decision_priority: tuple[Candidate3Decision, ...]
    support_formula: str
    full_ate_when_support_inadequate: str

    def __post_init__(self) -> None:
        if not 0 < self.propensity_central_lower < self.propensity_central_upper < 1:
            raise ValueError("invalid central propensity interval")
        if not 0 < self.minimum_central_overlap_fraction <= 1:
            raise ValueError("central overlap fraction threshold must be in (0,1]")
        if not 0 < self.minimum_normalized_overlap_mass <= 1:
            raise ValueError("normalized overlap mass threshold must be in (0,1]")
        if min(self.minimum_treated_count, self.minimum_control_count) <= 0:
            raise ValueError("arm counts must be positive")
        if min(
            self.minimum_total_overlap_ess,
            self.minimum_treated_overlap_ess,
            self.minimum_control_overlap_ess,
        ) <= 0:
            raise ValueError("ESS thresholds must be positive")
        if self.minimum_outcome_events <= 0:
            raise ValueError("outcome-event threshold must be positive")
        expected = (
            Candidate3Decision.ABSTAIN_PRETREATMENT_INVALID,
            Candidate3Decision.ABSTAIN_INADEQUATE_SUPPORT,
            Candidate3Decision.ABSTAIN_INADEQUATE_FINITE_SAMPLE,
            Candidate3Decision.ESTIMATE_ATO,
        )
        if self.decision_priority != expected:
            raise ValueError("Candidate 3 decision priority is frozen")
        if self.full_ate_when_support_inadequate != "NEVER_ESTIMATE":
            raise ValueError("unsupported full-population ATE must never be estimated")

    @property
    def fingerprint(self) -> str:
        return fingerprint_payload(asdict(self))


@dataclass(frozen=True, slots=True)
class UncertaintyContract:
    interval_level: float
    method: str
    bootstrap_replicates: int
    bootstrap_unit: str
    bootstrap_refits_full_pipeline: bool
    minimum_valid_bootstrap_fraction: float
    maximum_interval_width: float
    deterministic_seed_rule: str
    insufficient_information_action: Candidate3Decision

    def __post_init__(self) -> None:
        if self.interval_level != 0.90:
            raise ValueError("Candidate 3 interval level is frozen at 90%")
        if self.bootstrap_replicates != 400:
            raise ValueError("Candidate 3 bootstrap replicate count is frozen at 400")
        if not self.bootstrap_refits_full_pipeline:
            raise ValueError("bootstrap must refit the complete estimation pipeline")
        if not 0 < self.minimum_valid_bootstrap_fraction <= 1:
            raise ValueError("invalid valid-bootstrap threshold")
        if not 0 < self.maximum_interval_width <= 2:
            raise ValueError("invalid interval-width threshold")
        if (
            self.insufficient_information_action
            != Candidate3Decision.ABSTAIN_INADEQUATE_FINITE_SAMPLE
        ):
            raise ValueError("inadequate uncertainty must trigger finite-sample abstention")

    @property
    def fingerprint(self) -> str:
        return fingerprint_payload(asdict(self))


@dataclass(frozen=True, slots=True)
class TreatmentOpportunity:
    subject_id: str
    focal_channel: str
    decision_time: datetime
    treated: bool
    opportunity_source: str

    def __post_init__(self) -> None:
        if self.opportunity_source != "declared_treatment_decision_opportunity":
            raise ValueError(
                "treated and untreated units require an explicit decision opportunity"
            )


@dataclass(frozen=True, slots=True)
class FeatureObservation:
    feature_name: str
    decision_time: datetime
    source_event_times: tuple[datetime, ...]
    baseline_available_before_decision: bool = False


@dataclass(frozen=True, slots=True)
class SupportDiagnostics:
    central_overlap_fraction: float
    normalized_overlap_mass: float
    treated_count: int
    control_count: int
    total_overlap_ess: float
    treated_overlap_ess: float
    control_overlap_ess: float
    outcome_events: int
    valid_bootstrap_fraction: float | None = None
    interval_width: float | None = None


@dataclass(frozen=True, slots=True)
class Candidate3OutputContract:
    decision: Candidate3Decision
    estimand: str
    estimate: float | None
    interval_lower: float | None
    interval_upper: float | None
    target_population: str
    full_population_ate: None
    support_status: SupportStatus
    finite_sample_status: FiniteSampleStatus
    identification_statement: str
    latent_confounding_statement: str

    def __post_init__(self) -> None:
        if self.full_population_ate is not None:
            raise ValueError("Candidate 3 must never populate a full-population ATE")
        if self.decision == Candidate3Decision.ESTIMATE_ATO:
            if self.estimate is None or self.interval_lower is None or self.interval_upper is None:
                raise ValueError("ATO estimate requires estimate and interval")
        else:
            if any(
                value is not None
                for value in (self.estimate, self.interval_lower, self.interval_upper)
            ):
                raise ValueError("abstention outputs must not contain causal estimates")
        if "conditional on declared pre-treatment observables" not in self.identification_statement:
            raise ValueError("Candidate 3 must state its identifying assumption")
        if "does not solve latent confounding" not in self.latent_confounding_statement:
            raise ValueError("Candidate 3 must disclaim latent-confounding resolution")


def build_ato_estimand_contract() -> ATOEstimandContract:
    return ATOEstimandContract(
        candidate_id="candidate3-overlap-ato",
        version="1.0.0",
        focal_treatment=(
            "binary focal-channel exposure at an explicit treatment decision opportunity"
        ),
        outcome="qualifying conversion within 504 hours of the declared observation origin",
        horizon_hours=504.0,
        unit_of_analysis="synthetic treatment decision opportunity",
        decision_opportunity_definition=(
            "an explicit candidate-visible focal-channel decision opportunity timestamp "
            "defined for treated and untreated units before outcome realization"
        ),
        propensity_definition=(
            "e(X_t)=P(A_t=1 | X_t), where X_t contains only information available "
            "strictly before the focal treatment decision opportunity"
        ),
        overlap_weight_definition="h(X_t)=e(X_t)*(1-e(X_t))",
        estimand_formula=(
            "ATO = E[h(X_t)*(Y(1)-Y(0))] / E[h(X_t)]"
        ),
        target_population=(
            "the overlap/equipoise population induced by h(X_t); subjects with "
            "near-deterministic treatment receive vanishing target weight"
        ),
        full_population_ate_status="NOT_ESTIMATED",
        latent_confounding_scope=(
            "Candidate 3 addresses support/positivity only and does not claim "
            "identification under unmeasured confounding"
        ),
    )


def build_pretreatment_x_contract() -> PretreatmentXContract:
    permitted = (
        PretreatmentFeatureSpec(
            name="prior_non_focal_channel_exposure_indicators",
            rationale="summarizes channel history already observed before the focal decision",
            temporal_rule="only touchpoints with timestamp strictly less than decision_time",
            provenance_rule="every contributing touchpoint timestamp must be retained",
        ),
        PretreatmentFeatureSpec(
            name="prior_touch_count",
            rationale="summarizes already-observed engagement intensity",
            temporal_rule="count only touchpoints strictly before decision_time",
            provenance_rule="derived only from timestamped pre-decision touchpoints",
        ),
        PretreatmentFeatureSpec(
            name="prior_completed_session_count",
            rationale="summarizes completed pre-treatment sessions",
            temporal_rule="count only sessions whose end is strictly before decision_time",
            provenance_rule="session start/end timestamps must establish completion pre-treatment",
        ),
        PretreatmentFeatureSpec(
            name="prior_channel_recency_hours",
            rationale="captures recency of already-observed non-focal channel history",
            temporal_rule="last contributing event must be strictly before decision_time",
            provenance_rule="derived from timestamped pre-decision touchpoints only",
        ),
        PretreatmentFeatureSpec(
            name="elapsed_observation_hours",
            rationale="calendar time elapsed before the focal treatment opportunity",
            temporal_rule="observation_start must precede decision_time",
            provenance_rule="computed only from observation_start and decision_time",
        ),
        PretreatmentFeatureSpec(
            name="declared_baseline_covariates",
            rationale=(
                "allows only covariates explicitly documented as fixed and available "
                "before the focal decision opportunity"
            ),
            temporal_rule="must be available before decision_time for every decision unit",
            provenance_rule=(
                "baseline provenance must explicitly certify pre-decision availability; "
                "missing provenance is not treated as baseline"
            ),
        ),
    )
    return PretreatmentXContract(
        focal_decision_time_requirement=(
            "every treated and untreated decision unit must carry an explicit focal "
            "treatment opportunity timestamp; no timestamp may be inferred from outcome "
            "or future journey events"
        ),
        untreated_opportunity_requirement=(
            "untreated controls require the same kind of explicit decision opportunity "
            "as treated units; absence of exposure is not itself an opportunity timestamp"
        ),
        permitted_features=permitted,
        explicitly_forbidden_features=(
            "touch count at or after focal treatment opportunity",
            "subsequent sessions",
            "later channel exposures",
            "checkout or cart behavior after decision_time",
            "conversion-path structure using future events",
            "conversion outcome or conversion timestamp",
            "identity confidence or identity links learned after decision_time",
            "post-treatment consent or measurement state",
            "future observation completeness or censoring information",
            "any feature selected because oracle latent intent makes recovery better",
        ),
        missing_provenance_policy="ABSTAIN_PRETREATMENT_INVALID",
        no_future_information_rule=(
            "every non-baseline source event contributing to X_t must satisfy "
            "source_event_time < decision_time"
        ),
    )


def build_support_abstention_contract() -> SupportAbstentionContract:
    return SupportAbstentionContract(
        propensity_central_lower=0.10,
        propensity_central_upper=0.90,
        minimum_central_overlap_fraction=0.20,
        minimum_normalized_overlap_mass=0.20,
        minimum_treated_count=20,
        minimum_control_count=20,
        minimum_total_overlap_ess=80.0,
        minimum_treated_overlap_ess=30.0,
        minimum_control_overlap_ess=30.0,
        minimum_outcome_events=10,
        decision_priority=(
            Candidate3Decision.ABSTAIN_PRETREATMENT_INVALID,
            Candidate3Decision.ABSTAIN_INADEQUATE_SUPPORT,
            Candidate3Decision.ABSTAIN_INADEQUATE_FINITE_SAMPLE,
            Candidate3Decision.ESTIMATE_ATO,
        ),
        support_formula=(
            "central_overlap_fraction=mean(0.10<=e(X_t)<=0.90); "
            "normalized_overlap_mass=4*mean(e(X_t)*(1-e(X_t))); "
            "overlap weights are (1-e) for treated and e for controls"
        ),
        full_ate_when_support_inadequate="NEVER_ESTIMATE",
    )


def build_uncertainty_contract() -> UncertaintyContract:
    return UncertaintyContract(
        interval_level=0.90,
        method=(
            "ordinary decision-unit percentile bootstrap of the complete Candidate 3 "
            "estimation pipeline, including nuisance refitting and overlap diagnostics"
        ),
        bootstrap_replicates=400,
        bootstrap_unit="treatment decision opportunity",
        bootstrap_refits_full_pipeline=True,
        minimum_valid_bootstrap_fraction=0.95,
        maximum_interval_width=0.25,
        deterministic_seed_rule=(
            "bootstrap seed is a deterministic hash of evaluation case ID and frozen "
            "candidate lineage; it is never selected from observed performance"
        ),
        insufficient_information_action=(
            Candidate3Decision.ABSTAIN_INADEQUATE_FINITE_SAMPLE
        ),
    )


def validate_feature_observation(
    observation: FeatureObservation,
    contract: PretreatmentXContract,
) -> None:
    permitted = {feature.name for feature in contract.permitted_features}
    if observation.feature_name not in permitted:
        raise ValueError("feature is not permitted by the frozen pre-treatment contract")
    if observation.source_event_times:
        if any(timestamp >= observation.decision_time for timestamp in observation.source_event_times):
            raise ValueError("post-treatment or contemporaneous information is forbidden")
    elif not observation.baseline_available_before_decision:
        raise ValueError("feature has no certified pre-treatment provenance")


def support_status(
    diagnostics: SupportDiagnostics,
    contract: SupportAbstentionContract,
) -> SupportStatus:
    adequate = (
        diagnostics.central_overlap_fraction >= contract.minimum_central_overlap_fraction
        and diagnostics.normalized_overlap_mass >= contract.minimum_normalized_overlap_mass
    )
    return SupportStatus.ADEQUATE if adequate else SupportStatus.INADEQUATE


def finite_sample_status(
    diagnostics: SupportDiagnostics,
    support_contract: SupportAbstentionContract,
    uncertainty_contract: UncertaintyContract,
) -> FiniteSampleStatus:
    adequate = (
        diagnostics.treated_count >= support_contract.minimum_treated_count
        and diagnostics.control_count >= support_contract.minimum_control_count
        and diagnostics.total_overlap_ess >= support_contract.minimum_total_overlap_ess
        and diagnostics.treated_overlap_ess >= support_contract.minimum_treated_overlap_ess
        and diagnostics.control_overlap_ess >= support_contract.minimum_control_overlap_ess
        and diagnostics.outcome_events >= support_contract.minimum_outcome_events
    )
    if diagnostics.valid_bootstrap_fraction is not None:
        adequate = (
            adequate
            and diagnostics.valid_bootstrap_fraction
            >= uncertainty_contract.minimum_valid_bootstrap_fraction
        )
    if diagnostics.interval_width is not None:
        adequate = (
            adequate
            and diagnostics.interval_width <= uncertainty_contract.maximum_interval_width
        )
    return (
        FiniteSampleStatus.ADEQUATE
        if adequate
        else FiniteSampleStatus.INADEQUATE
    )


def candidate3_decision(
    *,
    pretreatment_valid: bool,
    diagnostics: SupportDiagnostics,
    support_contract: SupportAbstentionContract,
    uncertainty_contract: UncertaintyContract,
) -> Candidate3Decision:
    if not pretreatment_valid:
        return Candidate3Decision.ABSTAIN_PRETREATMENT_INVALID
    if support_status(diagnostics, support_contract) == SupportStatus.INADEQUATE:
        return Candidate3Decision.ABSTAIN_INADEQUATE_SUPPORT
    if (
        finite_sample_status(diagnostics, support_contract, uncertainty_contract)
        == FiniteSampleStatus.INADEQUATE
    ):
        return Candidate3Decision.ABSTAIN_INADEQUATE_FINITE_SAMPLE
    return Candidate3Decision.ESTIMATE_ATO


def contract_bundle() -> dict[str, Any]:
    estimand = build_ato_estimand_contract()
    pretreatment = build_pretreatment_x_contract()
    support = build_support_abstention_contract()
    uncertainty = build_uncertainty_contract()
    return {
        "ato_estimand": asdict(estimand),
        "pretreatment_x": asdict(pretreatment),
        "support_abstention": asdict(support),
        "uncertainty": asdict(uncertainty),
        "fingerprints": {
            "ato_estimand": estimand.fingerprint,
            "pretreatment_x": pretreatment.fingerprint,
            "support_abstention": support.fingerprint,
            "uncertainty": uncertainty.fingerprint,
        },
    }
