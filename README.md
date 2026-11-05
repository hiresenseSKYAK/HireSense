# PROJECT: HireSense - Company Web Crawler and Job Openings Tracker

# TEAM: SKYAK Solutions

# MEMBERS: Kaelin, Saad, Kristopher, Anas, Yohannis 

# INSTRUCTOR: DIANA RABAH

# TA: JORDAN BLACK

## Live job architecture

GitHub Actions runs the lightweight crawler on a schedule: direct employer
boards every 15 minutes, official APIs hourly, and LinkedIn/Handshake every six
hours. Listings pass through validation, normalization, stable identity matching,
and idempotent upserts into Aiven MySQL. FastAPI serves only active database rows
posted (or first found) within the last 30 days to the Vite frontend. Each job
links to the real available application page, where the user-controlled
HireSense Autofill workflow can run.

Resume uploads are read by a rule-based parser. For signed-in users it is
enhanced by OpenAI, using the same `OPENAI_API_KEY` as the AI Interview, and
every AI value is checked against the resume text.

Operational commands, migrations, required secrets, failure behavior, and
source-extension guidance are documented in [DEPLOYMENT.md](DEPLOYMENT.md).

More documentation:

- [docs/job-ingestion.md](docs/job-ingestion.md): sources, schedule, and how
  jobs expire.
- [docs/ai-interview.md](docs/ai-interview.md): OpenAI configuration, the AI
  Interview, career coaching, and resume parsing.
