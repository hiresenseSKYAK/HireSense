import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import Mock, patch

import pytest

os.environ.setdefault("DB_HOST", "test.invalid")
os.environ.setdefault("DB_PORT", "3306")
os.environ.setdefault("DB_NAME", "testdb")
os.environ.setdefault("DB_USER", "testuser")
os.environ.setdefault("DB_PASSWORD", "testpassword")

from crawler import providers
from crawler import crawl
from crawler.sources import SourceSpec, ats_sources
from crawler.parsers.ats import _pick_location
from database.queries import _source_rank
from services.job_deduplication import partition_unique_postings


def test_registry_adds_boards_without_crawler_edits():
    with TemporaryDirectory() as directory:
        path = Path(directory) / "boards.json"
        path.write_text(json.dumps([
            {"company": "Acme", "provider": "greenhouse", "board_identifier": "acme", "enabled": True},
            {"company": "Off", "provider": "lever", "board_identifier": "off", "enabled": False},
        ]), encoding="utf-8")
        sources = ats_sources(path)
    assert len(sources) == 1
    assert sources[0].url == "https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true"


def test_multilocation_direct_job_keeps_its_actual_dfw_option():
    result = _pick_location(["San Diego, California", "Dallas, Texas", "Seattle, Washington"], "On-site", "Build software.")
    assert result == ("Dallas, Texas", "On-site")


def test_official_providers_disabled_without_credentials():
    with patch.dict(os.environ, {"ADZUNA_APP_ID": "", "ADZUNA_APP_KEY": "",
                                 "USAJOBS_EMAIL": "", "USAJOBS_API_KEY": ""}):
        with patch.object(providers.requests, "get") as request:
            assert providers.fetch(SourceSpec("adzuna", "official-api"), max_jobs=20, time_limit_sec=20).error_code == "credentials_missing"
            assert providers.fetch(SourceSpec("usajobs", "official-api"), max_jobs=20, time_limit_sec=20).error_code == "credentials_missing"
            request.assert_not_called()


def test_adzuna_uses_official_api_and_preserves_source_date():
    payload = {"results": [{"id": "9", "title": "Junior Software Engineer", "company": {"display_name": "Acme"},
                            "location": {"display_name": "Dallas, TX"}, "description": "Build Python software.",
                            "created": "2026-10-19T12:00:00Z", "redirect_url": "https://example.com/apply/9"}]}
    response = Mock(status_code=200)
    response.json.return_value = payload
    with patch.dict(os.environ, {"ADZUNA_APP_ID": "id-secret", "ADZUNA_APP_KEY": "key-secret"}):
        with patch.object(providers.requests, "get", return_value=response) as request:
            result = providers.fetch(SourceSpec("adzuna", "official-api"), max_jobs=20, time_limit_sec=20)
    assert result.jobs[0]["date_posted"] == "2026-10-19"
    assert result.jobs[0]["source_job_id"] == "9"
    assert request.call_args.args[0] == "https://api.adzuna.com/v1/api/jobs/us/search/1"
    assert request.call_args.kwargs["params"]["app_key"] == "key-secret"


def test_rate_limit_error_is_safe_and_typed():
    response = Mock(status_code=429)
    with patch.dict(os.environ, {"ADZUNA_APP_ID": "id-secret", "ADZUNA_APP_KEY": "key-secret"}):
        with patch.object(providers.requests, "get", return_value=response):
            with pytest.raises(providers.ProviderError) as raised:
                providers.fetch(SourceSpec("adzuna", "official-api"), max_jobs=20, time_limit_sec=20)
    assert raised.value.code == "rate_limited"
    assert raised.value.rate_limited
    assert "secret" not in str(raised.value)


def test_rate_limited_source_is_not_refetched():
    with patch.object(crawl, "source_specs", return_value=[SourceSpec("adzuna", "official-api")]):
        with patch.object(crawl, "is_rate_limited", return_value=True):
            with patch.object(crawl.providers, "fetch") as fetch:
                jobs, counts = crawl.collect_jobs(source="adzuna", limit=20, persist_health=True)
    assert jobs == []
    assert counts["source_errors"] == 0
    fetch.assert_not_called()


def test_direct_source_wins_cross_provider_duplicate():
    common = {"company": "Acme", "job_title": "Junior Software Engineer", "location": "Dallas, TX",
              "job_description": "Build software for customers. " * 50, "canonical_url": "https://acme.example/jobs/9"}
    unique, duplicates = partition_unique_postings([
        {**common, "id": 1, "source": "adzuna"},
        {**common, "id": 2, "source": "greenhouse"},
    ])
    assert [row["id"] for row in unique] == [2]
    assert [row["id"] for row in duplicates] == [1]
    assert _source_rank("greenhouse") > _source_rank("adzuna")


def test_aggregator_excerpt_deduplicates_only_with_same_location_and_title():
    excerpt = "Build Python services and data pipelines for customers with cloud deployment. " * 4
    direct = {"id": 2, "source": "greenhouse", "company": "Acme", "job_title": "Junior Backend Engineer",
              "location": "Dallas, TX", "job_description": excerpt + "Additional team details. " * 10,
              "application_link": "https://acme.example/jobs/2"}
    aggregator = {"id": 3, "source": "adzuna", "company": "Acme", "job_title": "Junior Backend Engineer",
                  "location": "Dallas, TX", "job_description": excerpt,
                  "application_link": "https://adzuna.example/3"}
    unique, duplicates = partition_unique_postings([aggregator, direct])
    assert [item["id"] for item in unique] == [2]
    assert [item["id"] for item in duplicates] == [3]
    unique_other_location, _ = partition_unique_postings([{**aggregator, "location": "Plano, TX"}, direct])
    assert len(unique_other_location) == 2
