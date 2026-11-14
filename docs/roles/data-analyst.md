# Role: Data analyst + storyteller — 4th member
Paste after AGENTS.md. Skills TBC at kickoff: pick **Track A** if comfortable with Python, else **Track B**.

## Track A (Python)
1. `pipeline/07_anomaly.py` — for each region/month: median, p10, p90, z-score, percentile vs all prior years.
2. `pipeline/08_onset.py` — season-onset date per year (e.g., first day cumulative count passes 10% of season total); `onset_shift_days` vs median onset.
3. Before/after chart (raw MODIS+VIIRS showing 2012 jump vs harmonized) as PNG + data for the UI.
4. Then do Track B.

## Track B (everyone does this by Sun 14:00)
- Research notes: 5 cited facts for the pitch (Punjab burning, Delhi AQI, sensor specs).
- Slides: problem → proof (before/after) → live demo → limitations → "built for sensor retirement".
- Limitations slide (table in context doc).
- Demo video (record from the deployed site Sun 14:00–17:00) + screen-recording backup of the live demo.
- Project page text + README.
- Testing: run every feature on the deployed site, file bugs in TASKS.md.

## Your AI's job
Analysis code that matches the contract, and clear, non-hype pitch writing. Never invent statistics — every number on a slide needs a source link.
