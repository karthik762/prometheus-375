import React, { useMemo, useState } from 'react';
import { useCalendar } from '../../hooks/useCalendar';
import { useSelection, CURRENT_MONTH, RECORD_START } from '../../hooks/useSelection';
import { getHeatmapColor, getRampLegendSteps } from '../../lib/colorRamp';
import { areaErrorCopy, formatCount, formatMonthName } from '../../lib/format';
import { LoadingState, EmptyState, ErrorState } from '../ui/States';
import { SampleDataBadge } from '../ui/SampleDataBadge';
import type { CalendarRow } from '../../api/types';

const MONTH_LETTERS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const FIRST_YEAR = Number(RECORD_START.slice(0, 4)); // 2001
const CURRENT_YEAR = Number(CURRENT_MONTH.slice(0, 4));
const YEARS = Array.from({ length: CURRENT_YEAR - FIRST_YEAR + 1 }, (_, i) => FIRST_YEAR + i);
const GRID_COLUMNS = '36px repeat(12, minmax(0, 1fr))';
const CELL_HEIGHT = 14;

export const BurnCalendar: React.FC = () => {
  const { data, isMock, loading, error, refetch } = useCalendar();
  const { area, selectedMonth, setSelectedMonth, colorScale } = useSelection();

  // Hover state for tooltip
  const [hoveredCell, setHoveredCell] = useState<{
    row: CalendarRow;
    x: number;
    y: number;
  } | null>(null);

  // Map calendar rows by "YYYY-MM"
  const { calendarMap, maxCount } = useMemo(() => {
    const map = new Map<string, CalendarRow>();
    let max = 0;
    if (data) {
      data.forEach((row) => {
        map.set(row.month, row);
        if (row.count > max) {
          max = row.count;
        }
      });
    }
    return { calendarMap: map, maxCount: max };
  }, [data]);

  // Rows exist but nothing ever burned → an all-dark grid; show a message instead
  const allZero = !!data && data.length > 0 && maxCount === 0;

  const legendSteps = getRampLegendSteps(colorScale);

  return (
    <div
      style={{
        backgroundColor: 'var(--color-bg-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-lg)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        gap: 'var(--space-md)',
        minHeight: '440px',
        position: 'relative',
      }}
    >
      <div>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px', marginBottom: 'var(--space-md)' }}>
          <div>
            <h2 style={{ fontSize: '1.45rem', fontWeight: 500, lineHeight: 1.2, margin: 0 }}>
              Burning activity calendar
            </h2>
            <span
              className="label-mono"
              style={{
                fontSize: '0.6875rem',
                color: 'var(--color-text-tertiary)',
                marginTop: '4px',
                display: 'block',
              }}
            >
              {area.name ? area.name.replace(/\s*\(.*?\)\s*/g, '') : 'Selected Area'} • monthly fire counts
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {isMock && <SampleDataBadge />}
            {selectedMonth && (
              <span
                style={{
                  fontSize: '0.75rem',
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--color-gold)',
                  backgroundColor: 'rgba(184, 156, 107, 0.1)',
                  border: '1px solid var(--color-border)',
                  padding: '2px 8px',
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                {formatMonthName(selectedMonth)}
              </span>
            )}
          </div>
        </div>

        {loading && <LoadingState height="260px" message="Interpolating satellite timeline…" />}

        {error && !loading && (
          <ErrorState
            height="260px"
            {...areaErrorCopy(area, error, "Couldn't load the burning calendar")}
            onRetry={refetch}
          />
        )}

        {/* No rows = no grid cells in the area (archive covers only the 5 study regions) */}
        {!loading && !error && (!data || data.length === 0) && (
          <EmptyState
            height="260px"
            message="No fires in this area"
            subtext="Nothing burned here in the 2001–now record, or the area is outside the five regions with archive data (Punjab–Haryana, Brazil, Greece, NSW Australia, California). Try a preset or a bigger area."
          />
        )}

        {/* Rows but every month is zero (e.g. open sea inside a region) */}
        {!loading && !error && allZero && (
          <EmptyState
            height="260px"
            message="No fires in this area"
            subtext="Every month from 2001 to now is zero here. Try a bigger area or a preset."
          />
        )}

        {!loading && !error && data && data.length > 0 && !allZero && (
          <div style={{ overflowX: 'auto', paddingBottom: '4px' }}>
            <div
              style={{ minWidth: '280px', display: 'flex', flexDirection: 'column', gap: '3px' }}
              role="grid"
              aria-label={`Burning activity heatmap ${FIRST_YEAR}–${CURRENT_YEAR}, one row per year`}
            >
              {/* Month header: one column per month */}
              <div style={{ display: 'grid', gridTemplateColumns: GRID_COLUMNS, gap: '3px' }} role="row">
                <div />
                {MONTH_LETTERS.map((letter, mIdx) => (
                  <div
                    key={mIdx}
                    role="columnheader"
                    aria-label={MONTH_NAMES[mIdx]}
                    style={{
                      fontSize: '0.6875rem',
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--color-text-tertiary)',
                      textAlign: 'center',
                      userSelect: 'none',
                    }}
                  >
                    {letter}
                  </div>
                ))}
              </div>

              {/* Matrix: one row per year, one column per month */}
              {YEARS.map((year, rowIdx) => (
                <div
                  key={year}
                  style={{ display: 'grid', gridTemplateColumns: GRID_COLUMNS, gap: '3px', alignItems: 'center' }}
                  role="row"
                >
                  <div
                    role="rowheader"
                    style={{
                      fontSize: '0.6875rem',
                      fontFamily: 'var(--font-mono)',
                      color: year === 2012 ? 'var(--color-text-secondary)' : 'var(--color-text-tertiary)',
                      userSelect: 'none',
                    }}
                  >
                    {year}
                  </div>

                  {MONTH_LETTERS.map((_, mIdx) => {
                    const monthStr = `${year}-${String(mIdx + 1).padStart(2, '0')}`;
                    if (monthStr > CURRENT_MONTH) {
                      return <div key={monthStr} style={{ height: `${CELL_HEIGHT}px` }} aria-hidden="true" />;
                    }

                    const cellData = calendarMap.get(monthStr);
                    const isSelected = selectedMonth === monthStr;

                    // No row = month not covered by the query — not a true zero
                    if (!cellData) {
                      return (
                        <div
                          key={monthStr}
                          role="gridcell"
                          aria-label={`${formatMonthName(monthStr)}: no data`}
                          title={`${formatMonthName(monthStr)}: no data`}
                          style={{
                            height: `${CELL_HEIGHT}px`,
                            border: '1px dashed rgba(255, 255, 255, 0.08)',
                            borderRadius: '2px',
                          }}
                        />
                      );
                    }

                    const count = cellData.count;
                    const isModis = cellData.source === 'modis_converted';
                    const isPartial = monthStr === CURRENT_MONTH;
                    const cellColor = getHeatmapColor(count, maxCount, colorScale);
                    const showTip = (el: HTMLElement) => {
                      const rect = el.getBoundingClientRect();
                      setHoveredCell({ row: cellData, x: rect.left + rect.width / 2, y: rect.top - 8 });
                    };

                    return (
                      <button
                        key={monthStr}
                        type="button"
                        role="gridcell"
                        aria-selected={isSelected}
                        onClick={() => setSelectedMonth(monthStr)}
                        onMouseEnter={(e) => showTip(e.currentTarget)}
                        onFocus={(e) => showTip(e.currentTarget)}
                        onMouseLeave={() => setHoveredCell(null)}
                        onBlur={() => setHoveredCell(null)}
                        className={`cell cell-stagger ${isModis ? 'hatched-cell' : ''}`}
                        style={{
                          height: `${CELL_HEIGHT}px`,
                          backgroundColor: cellColor,
                          border: isSelected
                            ? '1.5px solid var(--color-gold)'
                            : isPartial
                              ? '1px dashed var(--color-gold)'
                              : '1px solid rgba(255, 255, 255, 0.05)',
                          borderRadius: '2px',
                          padding: 0,
                          cursor: 'pointer',
                          animationDelay: `${rowIdx * 8}ms`,
                          position: 'relative',
                          zIndex: isSelected ? 4 : 1,
                        }}
                        aria-label={`${formatMonthName(monthStr)}${isPartial ? ' (month to date)' : ''}: ${formatCount(count)} fires (${
                          isModis
                            ? `estimated from MODIS, range ${formatCount(cellData.uncertainty_lo)}–${formatCount(cellData.uncertainty_hi)}`
                            : 'VIIRS 375m'
                        })`}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Legend */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 'var(--space-sm)',
          paddingTop: 'var(--space-sm)',
          borderTop: '1px solid var(--color-border-subtle)',
          fontSize: '0.75rem',
          color: 'var(--color-text-tertiary)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span>Fewer</span>
          <div style={{ display: 'flex', gap: '2px', alignItems: 'center' }}>
            {legendSteps.map((s, idx) => (
              <span
                key={idx}
                style={{
                  width: '12px',
                  height: '12px',
                  backgroundColor: s.color,
                  borderRadius: '2px',
                  border: '1px solid rgba(255,255,255,0.08)',
                }}
              />
            ))}
          </div>
          <span>More</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span
            className="hatched-cell"
            style={{
              width: '14px',
              height: '14px',
              border: '1px solid var(--color-border)',
              borderRadius: '2px',
              backgroundColor: 'var(--color-fire-3)',
              display: 'inline-block',
            }}
          />
          <span>Hatched: estimated from MODIS, 2001–2011</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span
            style={{
              width: '14px',
              height: '14px',
              border: '1px dashed rgba(255, 255, 255, 0.25)',
              borderRadius: '2px',
              display: 'inline-block',
            }}
          />
          <span>No data</span>
        </div>
      </div>

      {/* Tooltip */}
      {hoveredCell && (
        <div
          className="editorial-tooltip"
          style={{
            position: 'fixed',
            left: `${hoveredCell.x}px`,
            top: `${hoveredCell.y}px`,
            backgroundColor: 'rgba(16, 18, 30, 0.96)',
            backdropFilter: 'blur(6px)',
            border: '1px solid var(--color-gold)',
            borderRadius: 'var(--radius-sm)',
            padding: '8px 12px',
            fontSize: '0.75rem',
            zIndex: 1000,
            pointerEvents: 'none',
            boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
            minWidth: '180px',
          }}
        >
          <div style={{ fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: '2px' }}>
            {formatMonthName(hoveredCell.row.month)}
            {hoveredCell.row.month === CURRENT_MONTH && (
              <span style={{ color: 'var(--color-gold)', fontWeight: 400 }}> · month to date</span>
            )}
          </div>
          <div style={{ color: 'var(--color-gold)', fontFamily: 'var(--font-mono)', fontSize: '0.875rem' }}>
            {formatCount(hoveredCell.row.count)} hotspots
          </div>
          <div style={{ color: 'var(--color-text-tertiary)', fontSize: '0.6875rem', marginTop: '2px' }}>
            {hoveredCell.row.source === 'modis_converted'
              ? `Estimated from MODIS · range ${formatCount(hoveredCell.row.uncertainty_lo)}–${formatCount(hoveredCell.row.uncertainty_hi)}`
              : 'VIIRS 375 m detections'}
          </div>
        </div>
      )}
    </div>
  );
};
