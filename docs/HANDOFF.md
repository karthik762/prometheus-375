# HANDOFF.md — write one entry at the end of every work block / before sleeping
Your teammate (or their AI) should be able to continue from your entry alone. Newest at top.

## Template
```
### HH:MM — <name> — <role>
Done:      <what now works, with file paths>
In progress: <what's half-done, where>
Next:      <the next 1–3 steps>
Blocked on: <person/thing, or "nothing">
Contract changes: <none / link to DECISIONS entry>
Paste-to-AI: <2–3 lines of context your AI needed that isn't in AGENTS.md>
```

## Entries
_(newest first)_

### 15:40 (Sun) — Rishitha — drawn areas
Done:      no_data outside coverage (backend/main.py, backend/spatial.py: area_has_data, X-No-Data header, AnomalyResponse.no_data); frontend coverage copy in BurnCalendar + NowVsNormalCard, faint "Data coverage" outlines on the map (frontend/src/lib/coverage.ts). Polygon queries: cell-key filter instead of ST_Within + LRU caches; [timing] logs per step. Also resolved leftover merge-conflict markers in backend/main.py + backend/anomaly.py (kept both sides: month_to_date/mtd_days AND onset_shift_min_days) — backend did not import on main since f32e818.
In progress: nothing
Next:      Check Render timings for a drawn polygon after redeploy ([timing] lines in Render logs; set TIMING_LOGS=0 to silence).
Blocked on: nothing
Contract changes: DECISIONS 2026-11-15 15:40 (additive)
Paste-to-AI: Nevada is NOT no_data: the California FIRMS download rectangle (-124.5..-114 lon) covers it. Grid centroids are exactly k*0.25+0.125; cell key SQL in spatial.CELL_KEY_SQL.

### 18:00 — Snehitha — frontend lead
Done:      React+Vite app in frontend/ (0b9fbc6): MapLibre FireMap + DrawControl, RegionPresets, LatLonInput, BurnCalendar, NowVsNormalCard + TimeSlider, LiveHotspotsLayer, charts/BeforeAfterChart, export CSV links (DatasetCover). Typed client in src/api/api.ts; mock JSON in src/api/mock/. `npx tsc --noEmit` passes.
In progress: F4/F5 run on mock data; not yet tested against the real backend.
Next:      1) Set VITE_API_URL=http://localhost:8000 and test /calendar, /anomaly, /live against the backend. 2) With Rishitha, decide whether to keep the old components/CalendarHeatmap.tsx + components/BeforeAfterChart.tsx or the new calendar/ + charts/ versions, then delete the other pair. 3) Wire downloads once B5 lands.
Blocked on: B5 (/export.csv, /export_analytics.csv, /validation), Karthik.
Contract changes: none
Paste-to-AI: Mock data is used only when VITE_API_URL is empty; when it's set, errors surface with the HTTP status (no silent mock fallback). Area selection → bbox or polygon params via buildSpatialParams() in api.ts.
