"""LinkedIn jobs are shown only while LinkedIn shows an Apply option, and
reposts of the same role are shown once."""

import os
import unittest
from unittest.mock import MagicMock, patch

os.environ.setdefault("DB_HOST", "test.invalid")
os.environ.setdefault("DB_PORT", "3306")
os.environ.setdefault("DB_NAME", "testdb")
os.environ.setdefault("DB_USER", "testuser")
os.environ.setdefault("DB_PASSWORD", "testpassword")

from crawler.parsers import linkedin
from crawler.parsers.linkedin import linkedin_posting_state
from services import updater
from services.job_deduplication import partition_unique_postings

DESCRIPTION = (
    "Join our team as a software engineering intern. You will build Python services, "
    "write tests, and ship features with mentorship from senior engineers. "
) * 4

# Trimmed from real guest pages (/jobs-guest/jobs/api/jobPosting/<id>).
OPEN_PAGE = f"""
<section class="top-card-layout">
  <h2 class="top-card-layout__title">Software Engineer Intern</h2>
  <a class="topcard__org-name-link" href="https://www.linkedin.com/company/acme">Acme</a>
  <span class="topcard__flavor--bullet">Dallas, TX</span>
  <button class="sign-up-modal__outlet top-card-layout__cta" data-modal="job-details-topcard-apply-modal">
    Apply
    <icon data-svg-class-name="apply-button__offsite-apply-icon-svg"></icon>
  </button>
  <div class="contextual-sign-in-modal" data-impression-id="public_jobs_apply-link-offsite_contextual-sign-in-modal"></div>
</section>
<ul>
  <li class="description__job-criteria-item">
    <h3 class="description__job-criteria-subheader">Seniority level</h3>
    <span class="description__job-criteria-text">Internship</span>
  </li>
</ul>
<div class="show-more-less-html__markup"><p>{DESCRIPTION}</p></div>
"""

CLOSED_PAGE = f"""
<section class="top-card-layout">
  <h2 class="top-card-layout__title">Software Engineer Intern</h2>
  <a class="topcard__org-name-link" href="https://www.linkedin.com/company/acme">Acme</a>
  <span class="topcard__flavor--bullet">Dallas, TX</span>
  <figure class="closed-job">
    <span class="closed-job__icon closed-job__icon--error-pebble"></span>
    <figcaption class="closed-job__flavor closed-job__flavor--closed">No longer accepting applications</figcaption>
  </figure>
</section>
<div class="show-more-less-html__markup"><p>{DESCRIPTION}</p></div>
"""

NO_APPLY_PAGE = CLOSED_PAGE.replace(
    CLOSED_PAGE[CLOSED_PAGE.index("<figure"):CLOSED_PAGE.index("</figure>") + len("</figure>")], ""
)



def _parse(page):
    response = MagicMock(status_code=200, text=page)
    with patch.object(linkedin, "_get_with_retries", return_value=response):
        return linkedin._extract_details_from_posting("123", session=None)


def _session(status, text=""):
    session = MagicMock()
    session.get.return_value = MagicMock(status_code=status, text=text)
    return session


def _row(id, source, location, description, **extra):
    return {"id": id, "source": source, "company": "Acme Inc.", "job_title": "Software Engineer Intern",
            "location": location, "job_description": description,
            "application_link": f"https://example.com/{source}/{id}", **extra}


class LinkedInAvailabilityTests(unittest.TestCase):
    def test_posting_state_classifies_real_page_shapes(self):
        assert linkedin_posting_state(OPEN_PAGE) == "open"
        assert linkedin_posting_state(CLOSED_PAGE) == "closed"
        assert linkedin_posting_state(NO_APPLY_PAGE) == "no_apply"
        assert linkedin_posting_state("<html><body>Sign in to continue</body></html>") is None
        assert linkedin_posting_state(
            '<h2 class="top-card-layout__title">X</h2><p>Not currently accepting applications</p>'
        ) == "closed"

    def test_crawler_keeps_open_posting(self):
        job = _parse(OPEN_PAGE)
        assert job is not None
        assert job["job_title"] == "Software Engineer Intern"

    def test_crawler_skips_closed_and_unappliable_postings(self):
        assert _parse(CLOSED_PAGE) is None
        assert _parse(NO_APPLY_PAGE) is None

    def test_checker_closes_linkedin_jobs_without_apply_option(self):
        assert updater.classify_linkedin_posting("123", session=_session(200, OPEN_PAGE))[0] is False
        assert updater.classify_linkedin_posting("123", session=_session(200, CLOSED_PAGE))[0] is True
        assert updater.classify_linkedin_posting("123", session=_session(200, NO_APPLY_PAGE))[0] is True
        assert updater.classify_linkedin_posting("123", session=_session(404))[0] is True
        # Unrecognizable pages and rate limits never close a job.
        assert updater.classify_linkedin_posting("123", session=_session(200, "<html>login</html>"))[0] is None
        assert updater.classify_linkedin_posting("123", session=_session(429))[0] is None

    def test_checker_closes_no_apply_linkedin_job_immediately(self):
        job = {"id": 7, "source": "linkedin", "source_job_id": "123",
               "application_link": "https://www.linkedin.com/jobs/view/123/"}
        expired, _reason, confirmed = updater.classify_job(job, session=_session(200, NO_APPLY_PAGE))
        assert expired is True and confirmed is True

    def test_linkedin_reposts_of_same_role_show_once(self):
        rows = [
            _row(10, "linkedin", "Dallas", DESCRIPTION),
            _row(11, "linkedin", "Dallas", DESCRIPTION.replace("ship features", "ship new features")),
        ]
        unique, duplicates = partition_unique_postings(rows)
        assert [row["id"] for row in unique] == [11]
        assert [row["id"] for row in duplicates] == [10]

    def test_employer_board_copy_wins_over_linkedin_copy_in_same_city(self):
        rows = [
            _row(20, "linkedin", "Dallas", DESCRIPTION[:400]),
            _row(5, "greenhouse", "Dallas, TX", DESCRIPTION),
        ]
        unique, _ = partition_unique_postings(rows)
        assert [row["id"] for row in unique] == [5]

    def test_same_title_with_different_descriptions_is_kept(self):
        rows = [
            _row(40, "linkedin", "Dallas", DESCRIPTION),
            _row(41, "linkedin", "Dallas", "Work on the payments team building Go services. " * 8),
        ]
        unique, duplicates = partition_unique_postings(rows)
        self.assertEqual(len(unique), 2)
        self.assertEqual(duplicates, [])

    def test_same_role_in_different_cities_is_kept(self):
        rows = [
            _row(30, "linkedin", "Dallas", DESCRIPTION),
            _row(31, "linkedin", "Austin", "Different text for the Austin office."),
            _row(32, "linkedin", "Remote — United States", "Remote version."),
        ]
        unique, duplicates = partition_unique_postings(rows)
        assert len(unique) == 3 and duplicates == []


if __name__ == "__main__":
    unittest.main()
