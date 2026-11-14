# DECISIONS.md — append-only log. Newest at bottom.
Format: `YYYY-MM-DD HH:MM — who — decision — why — affects`

- 2026-11-13 — team — Challenge locked: MODIS/VIIRS Hot Spots — feasible in 48h, clean data — all
- 2026-11-14 09:00 — team — Name: Prometheus 375 — fire + forethought; 375 m VIIRS — pitch
- 2026-11-14 09:20 — team — Stack: Python pipeline → parquet → FastAPI+DuckDB → React+MapLibre; Vercel+Render; Streamlit fallback — no DB server, offline pipeline can't break demo — all
- 2026-11-14 09:30 — team — Coordination via AGENTS.md + roles/ + TASKS.md + HANDOFF.md, shared across all AI tools — 4 different AI tools — all
- 2026-11-14 09:35 — team — Roles: Rishitha data+frontend, Poojitha data+backend, Karthik backend lead, Snehitha frontend lead+backend; task tracker xlsx with 8 statuses + % complete is the live source — real team split — all
- 2026-11-14 09:50 — team — Karthik owns the GitHub repo AND all deploys (Render + Vercel); F7 moved from Snehitha to Karthik (Snehitha helps) — deploy accounts link to the repo owner's GitHub, one person controls env vars/URLs — K4, B6, F7
