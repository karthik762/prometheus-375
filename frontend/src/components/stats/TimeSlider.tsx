import React from 'react';
import { useSelection, CURRENT_MONTH, RECORD_START } from '../../hooks/useSelection';
import { formatMonthName, formatMonthShort } from '../../lib/format';

const MILESTONES = [
  { year: '2002', label: "Aqua '02", month: '2002-07' },
  { year: '2012', label: "VIIRS '12", month: '2012-01' },
  { year: '2018', label: "NOAA-20 '18", month: '2018-04' },
  { year: '2020', label: "Holdout '20", month: '2020-11' },
  { year: CURRENT_MONTH.slice(0, 4), label: `Now '${CURRENT_MONTH.slice(2, 4)}`, month: CURRENT_MONTH },
];

const START_YEAR = Number(RECORD_START.slice(0, 4));
const MAX_INDEX = (Number(CURRENT_MONTH.slice(0, 4)) - START_YEAR) * 12 + Number(CURRENT_MONTH.slice(5)) - 1;

export const TimeSlider: React.FC = () => {
  const { selectedMonth, setSelectedMonth } = useSelection();

  // Month index: RECORD_START (2001-01) is 0, CURRENT_MONTH is MAX_INDEX
  const getIndexFromMonth = (mStr: string): number => {
    const [y, m] = mStr.split('-').map(Number);
    return (y - START_YEAR) * 12 + (m - 1);
  };

  const getMonthFromIndex = (idx: number): string => {
    const y = START_YEAR + Math.floor(idx / 12);
    const m = (idx % 12) + 1;
    return `${y}-${String(m).padStart(2, '0')}`;
  };

  const currentIndex = Math.min(MAX_INDEX, Math.max(0, getIndexFromMonth(selectedMonth)));

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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className="label-mono" style={{ color: 'var(--color-gold)' }}>
            Temporal Focus
          </span>
          <span style={{ fontSize: '0.9375rem', fontWeight: 600 }}>
            {formatMonthName(selectedMonth)}
          </span>
        </div>

        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {MILESTONES.map((ms) => (
            <button
              key={ms.year}
              type="button"
              onClick={() => setSelectedMonth(ms.month)}
              aria-pressed={selectedMonth === ms.month}
              aria-label={`Jump to ${formatMonthName(ms.month)}`}
              style={{
                fontSize: '0.6875rem',
                fontFamily: 'var(--font-mono)',
                padding: '3px 6px',
                backgroundColor: selectedMonth === ms.month ? 'var(--color-gold)' : 'var(--color-bg-base)',
                color: selectedMonth === ms.month ? '#10121d' : 'var(--color-text-secondary)',
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
        max={MAX_INDEX}
        value={currentIndex}
        onChange={handleSliderChange}
        aria-label="Timeline scrubber"
        aria-valuetext={formatMonthName(selectedMonth)}
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
        <span>{formatMonthShort(CURRENT_MONTH)} (Month-to-Date)</span>
      </div>
    </div>
  );
};
