from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime

import numpy as np

from attribution_lab.schemas.core import Channel, Dataset
from attribution_lab.studies.identification_overlap.trace import OracleSubject


@dataclass(frozen=True, slots=True)
class DiagnosticData:
    subject_ids: tuple[str, ...]
    treatment: np.ndarray
    outcome: np.ndarray
    observable_features: np.ndarray
    oracle_features: np.ndarray
    true_propensity: np.ndarray


def _base_subject_id(subject_id: str) -> str:
    if "-fragment-" in subject_id:
        return subject_id.split("-fragment-", 1)[0]
    return subject_id


def _position(timestamp: datetime, start: datetime, end: datetime) -> float:
    duration = max((end - start).total_seconds(), 1.0)
    return min(max((timestamp - start).total_seconds() / duration, 0.0), 1.0)


def prepare_diagnostic_data(
    dataset: Dataset,
    oracle_subjects: tuple[OracleSubject, ...],
    *,
    focal_channel: Channel,
) -> DiagnosticData:
    oracle = {subject.subject_id: subject for subject in oracle_subjects}
    other_channels = [channel for channel in Channel if channel != focal_channel]

    ids: list[str] = []
    treatment: list[float] = []
    outcome: list[float] = []
    observable: list[list[float]] = []
    oracle_rows: list[list[float]] = []
    true_propensity: list[float] = []

    for journey in dataset.journeys:
        base_id = _base_subject_id(journey.subject_id)
        oracle_subject = oracle.get(base_id)
        if oracle_subject is None:
            continue

        touches = list(journey.attribution_touchpoints())
        treated = float(any(touch.channel == focal_channel for touch in touches))
        non_focal = [touch for touch in touches if touch.channel != focal_channel]
        indicators = [
            float(any(touch.channel == channel for touch in non_focal))
            for channel in other_channels
        ]
        if non_focal:
            positions = [
                _position(
                    touch.timestamp,
                    journey.observation_start,
                    journey.observation_end,
                )
                for touch in non_focal
            ]
            earliest = min(positions)
            latest = max(positions)
        else:
            earliest = 0.0
            latest = 0.0

        row = [
            *indicators,
            math.log1p(len(non_focal)) / 3.0,
            math.log1p(len(journey.sessions)) / 2.0,
            earliest,
            latest,
            float(journey.identity_confidence),
            float(journey.consent_state.value == "granted"),
            float(not journey.is_censored),
        ]
        ids.append(journey.subject_id)
        treatment.append(treated)
        outcome.append(float(journey.qualifying_conversion() is not None))
        observable.append(row)
        oracle_rows.append([*row, oracle_subject.latent_intent])
        true_propensity.append(oracle_subject.true_focal_propensity)

    if not observable:
        raise ValueError("diagnostic dataset contains no observable subjects")

    return DiagnosticData(
        subject_ids=tuple(ids),
        treatment=np.asarray(treatment, dtype=float),
        outcome=np.asarray(outcome, dtype=float),
        observable_features=np.asarray(observable, dtype=float),
        oracle_features=np.asarray(oracle_rows, dtype=float),
        true_propensity=np.asarray(true_propensity, dtype=float),
    )
