from __future__ import annotations

import pytest
from pydantic import ValidationError

from linkedin_toolkit import models

PROFILE = {
    "publicId": "ada-lovelace",
    "url": "https://www.linkedin.com/in/ada-lovelace",
    "firstName": "Ada",
    "lastName": "Lovelace",
    "fullName": "Ada Lovelace",
    "capturedAt": 1_700_000_000_000,
    "headline": "Analytical engine programmer",
    "experience": [{"title": "Programmer", "company": "Analytical Engine"}],
}


def test_profile_parses_and_exposes_typed_attributes():
    profile = models.Profile.model_validate(PROFILE)
    assert profile.fullName == "Ada Lovelace"
    assert profile.experience[0].company == "Analytical Engine"
    assert profile.location is None


def test_an_unknown_field_is_kept_rather_than_rejected():
    """The extension ships on its own cadence and may capture more than we know about."""
    profile = models.Profile.model_validate({**PROFILE, "somethingNew": {"a": 1}})
    assert profile.model_dump()["somethingNew"] == {"a": 1}


def test_a_missing_required_field_still_fails():
    with pytest.raises(ValidationError):
        models.Profile.model_validate({k: v for k, v in PROFILE.items() if k != "publicId"})


def test_write_result_accepts_the_three_documented_statuses():
    for status in ("sent", "queued", "dryRun"):
        assert models.WriteResult.model_validate({"status": status}).status == status
    with pytest.raises(ValidationError):
        models.WriteResult.model_validate({"status": "definitely-sent"})


def test_status_nests_rate_limits():
    status = models.Status.model_validate(
        {
            "connected": True,
            "extensionVersion": "2.0.0",
            "loggedIn": True,
            "autopilot": False,
            "businessHours": True,
            "quotas": {
                "invite": {
                    "hourlyUsed": 1,
                    "hourlyCap": 20,
                    "dailyUsed": 3,
                    "dailyCap": 100,
                    "nextAllowedAt": 0,
                }
            },
            "queue": {"pending": 2},
            "campaigns": {"active": 1, "paused": 0},
        }
    )
    assert status.quotas["invite"].dailyCap == 100
    assert status.queue["pending"] == 2


def test_engager_is_a_profile_with_engagement_fields():
    engager = models.Engager.model_validate({**PROFILE, "reaction": "like", "engagedAt": 1})
    assert engager.publicId == "ada-lovelace"
    assert engager.reaction == "like"


def test_every_documented_shared_type_has_a_model():
    for name in (
        "Profile",
        "Company",
        "Engager",
        "Thread",
        "Message",
        "List",
        "ListMember",
        "Step",
        "Campaign",
        "QueueItem",
        "WriteResult",
        "RateLimit",
        "Status",
        "ResearchRow",
        "ResolvedRow",
        "Pack",
    ):
        assert hasattr(models, name), name
