import React from 'react';
import { usePresets } from '../../hooks/usePresets';
import { useSelection } from '../../hooks/useSelection';
import type { Preset } from '../../api/types';

export const RegionPresets: React.FC = () => {
  const { data: presets } = usePresets();
  const { area, setPreset } = useSelection();

  const currentPresetId = area.type === 'preset' ? area.presetId : '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div
        className="label-mono"
        style={{
          color: 'var(--color-text-tertiary)',
          fontSize: '0.6875rem',
          letterSpacing: '0.08em',
        }}
      >
        Area
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {presets?.map((p: Preset) => {
          const isSelected = currentPresetId === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => setPreset(p)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '9px 12px',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.8125rem',
                fontFamily: 'var(--font-sans)',
                textAlign: 'left',
                backgroundColor: isSelected ? 'var(--color-bg-elevated)' : 'transparent',
                color: isSelected ? '#ffffff' : 'var(--color-text-secondary)',
                border: isSelected ? '1px solid var(--color-gold)' : '1px solid transparent',
                cursor: 'pointer',
                transition: 'background-color 180ms ease-out, border-color 180ms ease-out, color 180ms ease-out',
              }}
              onMouseEnter={(e) => {
                if (!isSelected) {
                  e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.04)';
                  e.currentTarget.style.color = 'var(--color-text-primary)';
                }
              }}
              onMouseLeave={(e) => {
                if (!isSelected) {
                  e.currentTarget.style.backgroundColor = 'transparent';
                  e.currentTarget.style.color = 'var(--color-text-secondary)';
                }
              }}
            >
              <span>{p.name.replace(/\s*\(.*?\)\s*/g, '')}</span>
              {isSelected && (
                <span
                  style={{
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    backgroundColor: 'var(--color-gold)',
                  }}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};
