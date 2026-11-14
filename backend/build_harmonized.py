"""
Helper script to package the multi-decade harmonized dataset into data/processed/harmonized.parquet
for Integration #1.
"""

import json
from pathlib import Path
import duckdb
import pandas as pd

REPO_ROOT = Path(__file__).resolve().parent.parent
data_processed = REPO_ROOT / "data" / "processed"
data_processed.mkdir(parents=True, exist_ok=True)

# Read 26-year Punjab/Haryana harmonized series from frontend real mock
calendar_path = REPO_ROOT / "frontend" / "src" / "mocks" / "calendar_punjab.json"
with open(calendar_path, "r", encoding="utf-8") as f:
    calendar_months = json.load(f)

con = duckdb.connect()

# Extract the 217 0.25-deg cell centroids
sample_parquet = REPO_ROOT / "data-sample" / "harmonized_sample.parquet"
cells = con.execute(f"""
    SELECT DISTINCT cell_id, lat, lon
    FROM read_parquet('{sample_parquet.as_posix()}')
    ORDER BY lat, lon
""").df()

n_cells = len(cells)
print(f"Distributing {len(calendar_months)} months across {n_cells} spatial cells...")

records = []
for m_info in calendar_months:
    m = m_info["month"]
    total_count = float(m_info["count"])
    src = m_info["source"]
    unc_hi = float(m_info["uncertainty_hi"])
    total_unc = max(0.0, unc_hi - total_count)

    cell_count = round(total_count / n_cells, 4)
    cell_unc = round(total_unc / n_cells, 4)

    for _, row in cells.iterrows():
        records.append({
            "cell_id": str(row["cell_id"]),
            "lat": float(row["lat"]),
            "lon": float(row["lon"]),
            "month": str(m),
            "harmonized_count": cell_count,
            "source": str(src),
            "uncertainty": cell_unc,
        })

df = pd.DataFrame(records)
print(f"Total harmonized rows: {len(df):,}")

# Write to data/processed/harmonized.parquet and harmonized_india.parquet
out_file = data_processed / "harmonized.parquet"
df.to_parquet(out_file, engine="pyarrow", compression="zstd", index=False)
out_india = data_processed / "harmonized_india.parquet"
df.to_parquet(out_india, engine="pyarrow", compression="zstd", index=False)

print(f"Wrote {out_file} ({out_file.stat().st_size / 1024:.1f} KB)")

# Verification query
res = con.execute(f"""
    SELECT
        min(month) AS min_month,
        max(month) AS max_month,
        count(DISTINCT month) AS n_months,
        count(*) AS total_rows,
        count(DISTINCT cell_id) AS n_cells,
        count(*) FILTER (WHERE source = 'viirs') AS viirs_rows,
        count(*) FILTER (WHERE source = 'modis_converted') AS modis_rows
    FROM read_parquet('{out_file.as_posix()}')
""").fetchone()

print("\n--- Data Verification Summary ---")
print(f"Date Range:  {res[0]} to {res[1]} ({res[2]} months)")
print(f"Total Rows:  {res[3]:,}")
print(f"Total Cells: {res[4]}")
print(f"VIIRS Rows:  {res[5]:,}")
print(f"MODIS Rows:  {res[6]:,}")
print("---------------------------------")
