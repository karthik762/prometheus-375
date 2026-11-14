import React from 'react';
import { useSelection } from '../../hooks/useSelection';
import { formatMonthName } from '../../lib/format';

const MILESTONES = [
  { year: '2002', label: "Aqua '02", month: '2002-07' },
  { year: '2012', label: "VIIRS '12", month: '2012-01' },
  { year: '2018', label: "NOAA-20 '18", month: '2018-04' },
  { year: '2020', label: "Holdout '20", month: '2020-11' },
  { year: '2026', label: "Now '26", month: '2026-11' },
];

export const TimeSlider: React.FC = () => {
  const { selectedMonth, setSelectedMonth } = useSelection();

  // Convert "YYYY-MM" to month index (0 to 310)
  // 2001-01 is index 0; 2026-11 is index 25 * 12 + 10 = 310
  const getIndexFromMonth = (mStr: string): number => {
    const [y, m] = mStr.split('-').map(Number);
    return (y - 2001) * 12 + (m - 1);
  };

  const getMonthFromIndex = (idx: number): string => {
    const y = 2001 + Math.floor(idx / 12);
    const m = (idx % 12) + 1;
    return `${y}-${String(m).padStart(2, '0')}`;
  };

  const currentIndex = Math.min(310, Math.max(0, getIndexFromMonth(selectedMonth)));

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newIdx = parseInt(e.target.value, 10);
    setSelectedMonth(getMonthFromIndex(newIdx));
  };

  return (
    <div
      style={{
        padding: 'var(--space-md) var(--space-lg)',
        backgroundColor: 'var(--color-bg-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-sm)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className="label-mono" style={{ color: 'var(--color-gold)' }}>
            Temporal Focus
          </span>
          <span style={{ fontSize: '0.9375rem', fontWeight: 600 }}>
            {formatMonthName(selectedMonth)}
          </span>
        </div>

        <div style={{ display: 'flex', gap: '6px' }}>
          {MILESTONES.map((ms) => (
            <button
              key={ms.year}
              type="button"
              onClick={() => setSelectedMonth(ms.month)}
              style={{
                fontSize: '0.6875rem',
                fontFamily: 'var(--font-mono)',
                padding: '3px 6px',
                backgroundColor: selectedMonth.startsWith(ms.year) ? 'var(--color-gold)' : 'var(--color-bg-base)',
                color: selectedMonth.startsWith(ms.year) ? '#10121d' : 'var(--color-text-secondary)',
                border: '1px solid var(--color-border)',
                borderRadius: '3px',
                cursor: 'pointer',
              }}
            >
              {ms.label}
            </button>
          ))}
        </div>
      </div>

      <input
        type="range"
        min={0}
        max={310} // up to Nov 2026
        value={currentIndex}
        onChange={handleSliderChange}
        aria-label="Timeline scrubber"
        style={{
          width: '100%',
          cursor: 'pointer',
          accentColor: 'var(--color-gold)',
        }}
      />

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: '0.6875rem',
          fontFamily: 'var(--font-mono)',
          color: 'var(--color-text-tertiary)',
        }}
      >
        <span>Jan 2001 (Terra Only)</span>
        <span>2012 (VIIRS 375m Transition)</span>
        <span>Nov 2026 (Month-to-Date)</span>
      </div>
    </div>
  );
};
