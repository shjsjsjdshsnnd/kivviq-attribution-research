from __future__ import annotations

import re
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from .model import Period

REFERENCE_TIMEZONE = "America/Toronto"


def _today(reference: datetime | None) -> date:
    tz = ZoneInfo(REFERENCE_TIMEZONE)
    if reference is None:
        return datetime.now(tz).date()
    if reference.tzinfo is None:
        reference = reference.replace(tzinfo=tz)
    return reference.astimezone(tz).date()


def resolve_period(text: str, reference: datetime | None = None) -> Period:
    q = text.lower()
    today = _today(reference)

    custom = re.search(r"(20\d{2}-\d{2}-\d{2})\s+(?:to|through|until)\s+(20\d{2}-\d{2}-\d{2})", q)
    if custom:
        start = date.fromisoformat(custom.group(1))
        end = date.fromisoformat(custom.group(2))
        return Period(start, end, f"{start.isoformat()} to {end.isoformat()}")

    if "previous 30 days" in q:
        end = today - timedelta(days=30)
        start = end - timedelta(days=29)
        return Period(start, end, "previous 30 days")
    if "last 30 days" in q:
        return Period(today - timedelta(days=29), today, "last 30 days")
    if "last 7 complete days" in q:
        return Period(today - timedelta(days=7), today - timedelta(days=1), "last 7 complete days")
    if "last 7 days" in q:
        return Period(today - timedelta(days=6), today, "last 7 days")
    if "yesterday" in q:
        d = today - timedelta(days=1)
        return Period(d, d, "yesterday")
    if "today" in q or "right now" in q:
        return Period(today, today, "today")
    if "last week" in q:
        this_monday = today - timedelta(days=today.weekday())
        start = this_monday - timedelta(days=7)
        return Period(start, start + timedelta(days=6), "last week")
    if "this week" in q:
        start = today - timedelta(days=today.weekday())
        return Period(start, today, "this week")
    if "month to date" in q or "mtd" in q:
        return Period(today.replace(day=1), today, "month to date")
    if "last month" in q:
        first_this = today.replace(day=1)
        end = first_this - timedelta(days=1)
        return Period(end.replace(day=1), end, "last month")

    # Benchmark default: current last-30-day window.
    return Period(today - timedelta(days=29), today, "last 30 days")
