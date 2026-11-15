import React, { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import type { AreaSelection, Preset } from '../api/types';
import type { ColorScaleType } from '../lib/colorRamp';

const DEFAULT_AREA: AreaSelection = {
  type: 'preset',
  presetId: 'punjab_haryana',
  name: 'Punjab & Haryana (India)',
  bbox: [73.5, 27.5, 77.5, 32.5],
};

interface SelectionContextType {
  area: AreaSelection;
  startMonth: string;
  endMonth: string;
  selectedMonth: string;
  colorScale: ColorScaleType;
  setArea: (area: AreaSelection) => void;
  setPreset: (preset: Preset) => void;
  setBBox: (bbox: [number, number, number, number], name?: string) => void;
  setPolygon: (polygon: GeoJSON.Polygon | GeoJSON.MultiPolygon, name?: string) => void;
  setStartMonth: (month: string) => void;
  setEndMonth: (month: string) => void;
  setSelectedMonth: (month: string) => void;
  setColorScale: (scale: ColorScaleType) => void;
}

// First month shown in the UI (calendar rows, time slider, Hero copy all say 2001)
export const RECORD_START = '2001-01';
const now = new Date();
export const CURRENT_MONTH = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

const SelectionContext = createContext<SelectionContextType | null>(null);

export function SelectionProvider({ children }: { children: ReactNode }) {
  const [area, setArea] = useState<AreaSelection>(DEFAULT_AREA);
  const [startMonth, setStartMonth] = useState<string>(RECORD_START);
  const [endMonth, setEndMonth] = useState<string>(CURRENT_MONTH);
  const [selectedMonth, setSelectedMonth] = useState<string>(CURRENT_MONTH);
  // Fire ramp by default; viridis (AGENTS.md colour-blind-safe option) is one click away in the NavBar
  const [colorScale, setColorScale] = useState<ColorScaleType>('fire');

  // Stable identities: FireMap's init effect depends on setPolygon, and a new
  // function each render used to tear down and re-create the map (camera reset
  // to India) on every preset click.
  const setPreset = useCallback((preset: Preset) => {
    setArea({
      type: 'preset',
      presetId: preset.id,
      name: preset.name,
      bbox: preset.bbox,
    });
  }, []);

  const setBBox = useCallback((bbox: [number, number, number, number], name?: string) => {
    setArea({
      type: 'bbox',
      name: name || 'Custom Bounding Box',
      bbox,
    });
  }, []);

  const setPolygon = useCallback((polygon: GeoJSON.Polygon | GeoJSON.MultiPolygon, name?: string) => {
    setArea({
      type: 'polygon',
      name: name || 'Custom Drawn Area',
      polygon,
    });
  }, []);

  return React.createElement(
    SelectionContext.Provider,
    {
      value: {
        area,
        startMonth,
        endMonth,
        selectedMonth,
        colorScale,
        setArea,
        setPreset,
        setBBox,
        setPolygon,
        setStartMonth,
        setEndMonth,
        setSelectedMonth,
        setColorScale,
      },
    },
    children
  );
}

export function useSelection(): SelectionContextType {
  const context = useContext(SelectionContext);
  if (!context) {
    throw new Error('useSelection must be used within a SelectionProvider');
  }
  return context;
}
