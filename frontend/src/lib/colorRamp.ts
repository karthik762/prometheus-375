export type ColorScaleType = 'fire' | 'viridis' | 'cividis';

const NO_FIRE = '#1b1c2b'; // count 0

// Fire ramp steps: 0 -> very low -> low -> medium -> high -> extreme
const FIRE_RAMP = [NO_FIRE, '#5A1F00', '#8F3A0A', '#C45A1E', '#E6863F', '#F4B37A'];

// Viridis (perceptually uniform & colorblind-safe). Lowest step starts a bit
// above viridis(0) so quiet months stay visible against the dark background.
const VIRIDIS_RAMP = [NO_FIRE, '#472d7b', '#3b528b', '#21918c', '#5ec962', '#fde725'];

// Cividis (optimised for red-green colour-vision deficiency)
const CIVIDIS_RAMP = [NO_FIRE, '#2d4370', '#575d6d', '#7c7b78', '#b5a36f', '#fee838'];

const RAMPS: Record<ColorScaleType, string[]> = {
  fire: FIRE_RAMP,
  viridis: VIRIDIS_RAMP,
  cividis: CIVIDIS_RAMP,
};

export const COLOR_SCALES: { id: ColorScaleType; label: string }[] = [
  { id: 'fire', label: 'Fire' },
  { id: 'viridis', label: 'Viridis' },
  { id: 'cividis', label: 'Cividis' },
];

/** Mid-ramp swatch, used for the active toggle button. */
export function getScaleAccent(scale: ColorScaleType): string {
  return RAMPS[scale][3];
}

/**
 * Returns color hex string for a given count and max count across the dataset.
 * Uses a gentle square-root scale so intermediate months remain visible alongside huge peak months.
 */
export function getHeatmapColor(
  count: number,
  maxCount: number,
  scale: ColorScaleType = 'fire'
): string {
  const ramp = RAMPS[scale];
  if (count <= 0) return ramp[0];

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
  const ramp = RAMPS[scale];
  return [
    { label: '0', color: ramp[0] },
    { label: 'Low', color: ramp[1] },
    { label: 'Mod-Low', color: ramp[2] },
    { label: 'Moderate', color: ramp[3] },
    { label: 'High', color: ramp[4] },
    { label: 'Extreme', color: ramp[5] },
  ];
}
