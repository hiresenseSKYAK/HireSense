# PROJECT: HireSense - Company Web Crawler and Job Openings Tracker

# TEAM: SKYAK Solutions

# MEMBERS: Kaelin, Saad, Kristopher, Anas, Yohannis 

# INSTRUCTOR: DIANA RABAH

# TA: JORDAN BLACK

## Live job architecture

GitHub Actions runs the lightweight crawler on a six-hour schedule. LinkedIn
and Handshake public listings pass through validation, normalization, stable
identity matching, and idempotent upserts into Aiven MySQL. FastAPI serves only
active database rows to the Vite frontend. Each job links to the real available
application page, where the user-controlled HireSense Autofill workflow can run.

Operational commands, migrations, required secrets, failure behavior, and
source-extension guidance are documented in [DEPLOYMENT.md](DEPLOYMENT.md).
