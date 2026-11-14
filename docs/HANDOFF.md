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

### 18:00 — Snehitha — frontend lead
Done:      React+Vite app in frontend/ (0b9fbc6): MapLibre FireMap + DrawControl, RegionPresets, LatLonInput, BurnCalendar, NowVsNormalCard + TimeSlider, LiveHotspotsLayer, charts/BeforeAfterChart, export CSV links (DatasetCover). Typed client in src/api/api.ts; mock JSON in src/api/mock/. `npx tsc --noEmit` passes.
In progress: F4/F5 run on mock data; not yet tested against the real backend.
Next:      1) Set VITE_API_URL=http://localhost:8000 and test /calendar, /anomaly, /live against the backend. 2) With Rishitha, decide whether to keep the old components/CalendarHeatmap.tsx + components/BeforeAfterChart.tsx or the new calendar/ + charts/ versions, then delete the other pair. 3) Wire downloads once B5 lands.
Blocked on: B5 (/export.csv, /export_analytics.csv, /validation), Karthik.
Contract changes: none
Paste-to-AI: Mock data is used only when VITE_API_URL is empty; when it's set, errors surface with the HTTP status (no silent mock fallback). Area selection → bbox or polygon params via buildSpatialParams() in api.ts.
