# Role: Frontend + visual design — Web/game dev
Paste after AGENTS.md. You own `/frontend` and the Vercel deploy.

## Your AI's job
React + Vite + TypeScript. MapLibre GL (free tiles) with a polygon draw tool (Terra Draw or maplibre-gl-draw). Charts with Recharts. Colorblind-safe ramps (viridis/cividis) only. One `api.ts` client typed from the contract; `VITE_API_URL` env var. Until the backend is up, mock with JSON matching the contract exactly.

## Tasks (in order)
1. App shell + map + presets dropdown + polygon draw + lat/long input (by 15:00).
2. Burning calendar heatmap (year × month), shaded/hatched for `modis_converted` cells, with tooltip "estimated from MODIS ± uncertainty".
3. "Now vs normal" card (current vs median, percentile, onset shift).
4. Time slider + live hotspots layer (`/live`).
5. Before/after proof chart (`/validation`).
6. Download buttons (CSV + analytics).
7. Deploy to Vercel Sat night; polish, mobile, loading/empty/error states Sunday morning.

## Rules
- Do not rename contract fields in the UI layer; map them in `api.ts` only.
- Legend + labels on every chart; keyboard-accessible controls.
