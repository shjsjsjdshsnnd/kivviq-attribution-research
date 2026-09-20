from __future__ import annotations

from attribution_lab.schemas.core import Dataset
from phase2_candidate_sdk import (
    ObservableConversion,
    ObservableDataset,
    ObservableJourney,
    ObservableSession,
    ObservableTouchpoint,
)


def to_observable_dataset(dataset: Dataset) -> ObservableDataset:
    journeys: list[ObservableJourney] = []
    for journey in dataset.journeys:
        sessions = tuple(
            ObservableSession(
                session_id=session.session_id,
                start=session.start.isoformat(),
                end=session.end.isoformat(),
                device=session.device,
                touchpoints=tuple(
                    ObservableTouchpoint(
                        event_id=touch.event_id,
                        timestamp=touch.timestamp.isoformat(),
                        channel=touch.channel.value,
                        campaign=touch.campaign,
                        utm_source=touch.utm_source,
                        utm_medium=touch.utm_medium,
                        utm_campaign=touch.utm_campaign,
                        click_id=touch.click_id,
                        referrer=touch.referrer,
                    )
                    for touch in session.touchpoints
                ),
            )
            for session in journey.sessions
        )
        conversion = (
            ObservableConversion(
                conversion_id=journey.conversion.conversion_id,
                timestamp=journey.conversion.timestamp.isoformat(),
                value=journey.conversion.value,
            )
            if journey.conversion is not None
            else None
        )
        journeys.append(
            ObservableJourney(
                subject_id=journey.subject_id,
                observation_start=journey.observation_start.isoformat(),
                observation_end=journey.observation_end.isoformat(),
                sessions=sessions,
                conversion=conversion,
                consent_state=journey.consent_state.value,
                identity_confidence=journey.identity_confidence,
                acquisition_evidence=journey.acquisition_evidence.value,
                is_censored=journey.is_censored,
            )
        )
    return ObservableDataset(journeys=tuple(journeys))
