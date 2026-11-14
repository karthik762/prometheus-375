import React, { useState, useEffect } from 'react';
import { useSelection } from '../../hooks/useSelection';
import { Button } from '../ui/Button';

export const LatLonInput: React.FC = () => {
  const { area, setBBox } = useSelection();

  const [minLon, setMinLon] = useState<string>('73.50');
  const [minLat, setMinLat] = useState<string>('27.50');
  const [maxLon, setMaxLon] = useState<string>('77.50');
  const [maxLat, setMaxLat] = useState<string>('32.50');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Sync with area bbox if selection changes from presets
  useEffect(() => {
    if (area.bbox && area.bbox.length === 4) {
      setMinLon(area.bbox[0].toFixed(2));
      setMinLat(area.bbox[1].toFixed(2));
      setMaxLon(area.bbox[2].toFixed(2));
      setMaxLat(area.bbox[3].toFixed(2));
      setErrorMsg(null);
    }
  }, [area.bbox]);

  const handleApply = (e: React.FormEvent) => {
    e.preventDefault();
    const minX = parseFloat(minLon);
    const minY = parseFloat(minLat);
    const maxX = parseFloat(maxLon);
    const maxY = parseFloat(maxLat);

    if (isNaN(minX) || isNaN(minY) || isNaN(maxX) || isNaN(maxY)) {
      setErrorMsg('Please enter valid numeric coordinates.');
      return;
    }

    if (minY < -90 || minY > 90 || maxY < -90 || maxY > 90) {
      setErrorMsg('Latitude must be between -90° and +90°.');
      return;
    }

    if (minX < -180 || minX > 180 || maxX < -180 || maxX > 180) {
      setErrorMsg('Longitude must be between -180° and +180°.');
      return;
    }

    if (minY >= maxY) {
      setErrorMsg('Min Latitude must be less than Max Latitude.');
      return;
    }

    if (minX >= maxX) {
      setErrorMsg('Min Longitude must be less than Max Longitude.');
      return;
    }

    setErrorMsg(null);
    setBBox([minX, minY, maxX, maxY], `BBox [${minX.toFixed(2)}, ${minY.toFixed(2)} → ${maxX.toFixed(2)}, ${maxY.toFixed(2)}]`);
  };

  return (
    <form onSubmit={handleApply} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div className="label-mono" style={{ color: 'var(--color-text-secondary)' }}>
        Manual Coordinates (WGS-84)
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
        <div>
          <label htmlFor="input-min-lat" style={{ fontSize: '0.6875rem', color: 'var(--color-text-tertiary)', display: 'block', marginBottom: '2px' }}>
            Min Lat (°N)
          </label>
          <input
            id="input-min-lat"
            type="number"
            step="0.01"
            value={minLat}
            onChange={(e) => setMinLat(e.target.value)}
            style={{
              width: '100%',
              backgroundColor: 'var(--color-bg-base)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              padding: '6px 8px',
              color: 'var(--color-text-primary)',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.8125rem',
            }}
          />
        </div>

        <div>
          <label htmlFor="input-max-lat" style={{ fontSize: '0.6875rem', color: 'var(--color-text-tertiary)', display: 'block', marginBottom: '2px' }}>
            Max Lat (°N)
          </label>
          <input
            id="input-max-lat"
            type="number"
            step="0.01"
            value={maxLat}
            onChange={(e) => setMaxLat(e.target.value)}
            style={{
              width: '100%',
              backgroundColor: 'var(--color-bg-base)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              padding: '6px 8px',
              color: 'var(--color-text-primary)',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.8125rem',
            }}
          />
        </div>

        <div>
          <label htmlFor="input-min-lon" style={{ fontSize: '0.6875rem', color: 'var(--color-text-tertiary)', display: 'block', marginBottom: '2px' }}>
            Min Lon (°E)
          </label>
          <input
            id="input-min-lon"
            type="number"
            step="0.01"
            value={minLon}
            onChange={(e) => setMinLon(e.target.value)}
            style={{
              width: '100%',
              backgroundColor: 'var(--color-bg-base)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              padding: '6px 8px',
              color: 'var(--color-text-primary)',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.8125rem',
            }}
          />
        </div>

        <div>
          <label htmlFor="input-max-lon" style={{ fontSize: '0.6875rem', color: 'var(--color-text-tertiary)', display: 'block', marginBottom: '2px' }}>
            Max Lon (°E)
          </label>
          <input
            id="input-max-lon"
            type="number"
            step="0.01"
            value={maxLon}
            onChange={(e) => setMaxLon(e.target.value)}
            style={{
              width: '100%',
              backgroundColor: 'var(--color-bg-base)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              padding: '6px 8px',
              color: 'var(--color-text-primary)',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.8125rem',
            }}
          />
        </div>
      </div>

      {errorMsg && (
        <span style={{ fontSize: '0.75rem', color: 'var(--color-error)' }}>
          {errorMsg}
        </span>
      )}

      <Button type="submit" size="sm" variant="secondary" style={{ marginTop: '4px' }}>
        Apply Coordinates
      </Button>
    </form>
  );
};
