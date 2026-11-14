export type ColorScaleType = 'fire' | 'viridis';

// Fire ramp steps: 0 -> very low -> low -> medium -> high -> extreme
const FIRE_RAMP = [
  '#1b1c2b', // 0 / nodata
  '#5A1F00', // low
  '#8F3A0A', // moderate-low
  '#C45A1E', // moderate
  '#E6863F', // high
  '#F4B37A', // extreme
];

// Viridis ramp steps (perceptually uniform & colorblind-safe)
const VIRIDIS_RAMP = [
  '#1b1c2b', // 0 / nodata
  '#440154', // dark purple
  '#3b528b', // blue
  '#21918c', // teal
  '#5ec962', // green
  '#fde725', // bright yellow
];

/**
 * Returns color hex string for a given count and max count across the dataset.
 * Uses a gentle square-root scale so intermediate months remain visible alongside huge peak months.
 */
export function getHeatmapColor(
  count: number,
  maxCount: number,
  scale: ColorScaleType = 'fire'
): string {
  if (count <= 0) {
    return scale === 'fire' ? FIRE_RAMP[0] : VIRIDIS_RAMP[0];
  }

  const ramp = scale === 'fire' ? FIRE_RAMP : VIRIDIS_RAMP;
  const safeMax = Math.max(maxCount, 1);
  // Sqrt scaling enhances contrast across dynamic ranges (100 to 30,000)
  const norm = Math.min(1, Math.sqrt(count) / Math.sqrt(safeMax));

  if (norm < 0.1) return ramp[1];
  if (norm < 0.3) return ramp[2];
  if (norm < 0.55) return ramp[3];
  if (norm < 0.82) return ramp[4];
  return ramp[5];
}

/**
 * Returns the color steps array for rendering the legend
 */
export function getRampLegendSteps(scale: ColorScaleType = 'fire'): { label: string; color: string }[] {
  const ramp = scale === 'fire' ? FIRE_RAMP : VIRIDIS_RAMP;
  return [
    { label: '0', color: ramp[0] },
    { label: 'Low', color: ramp[1] },
    { label: 'Mod-Low', color: ramp[2] },
    { label: 'Moderate', color: ramp[3] },
    { label: 'High', color: ramp[4] },
    { label: 'Extreme', color: ramp[5] },
  ];
}
