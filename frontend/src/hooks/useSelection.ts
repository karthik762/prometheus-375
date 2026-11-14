import React, { createContext, useContext, useState, type ReactNode } from 'react';
import type { AreaSelection, Preset } from '../api/types';
import type { ColorScaleType } from '../lib/colorRamp';

const DEFAULT_AREA: AreaSelection = {
  type: 'preset',
  presetId: 'punjab_haryana',
  name: 'Punjab & Haryana (India)',
  bbox: [73.8, 27.6, 77.6, 32.5],
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

const SelectionContext = createContext<SelectionContextType | null>(null);

export function SelectionProvider({ children }: { children: ReactNode }) {
  const [area, setArea] = useState<AreaSelection>(DEFAULT_AREA);
  const [startMonth, setStartMonth] = useState<string>('2001-01');
  const [endMonth, setEndMonth] = useState<string>('2026-11');
  const [selectedMonth, setSelectedMonth] = useState<string>('2026-11');
  const [colorScale, setColorScale] = useState<ColorScaleType>('fire');

  const setPreset = (preset: Preset) => {
    setArea({
      type: 'preset',
      presetId: preset.id,
      name: preset.name,
      bbox: preset.bbox,
    });
  };

  const setBBox = (bbox: [number, number, number, number], name?: string) => {
    setArea({
      type: 'bbox',
      name: name || 'Custom Bounding Box',
      bbox,
    });
  };

  const setPolygon = (polygon: GeoJSON.Polygon | GeoJSON.MultiPolygon, name?: string) => {
    setArea({
      type: 'polygon',
      name: name || 'Custom Drawn Area',
      polygon,
    });
  };

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
