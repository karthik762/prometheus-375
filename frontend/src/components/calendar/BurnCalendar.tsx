import React, { useMemo, useState } from 'react';
import { useCalendar } from '../../hooks/useCalendar';
import { useSelection, CURRENT_MONTH } from '../../hooks/useSelection';
import { getHeatmapColor, getRampLegendSteps } from '../../lib/colorRamp';
import { formatCount, formatMonthName } from '../../lib/format';
import { LoadingState, EmptyState, ErrorState } from '../ui/States';
import { SampleDataBadge } from '../ui/SampleDataBadge';
import type { CalendarRow } from '../../api/types';

const MONTH_LETTERS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const FIRST_YEAR = 2000; // Terra MODIS from Nov 2000
const CURRENT_YEAR = Number(CURRENT_MONTH.slice(0, 4));
const YEARS = Array.from({ length: CURRENT_YEAR - FIRST_YEAR + 1 }, (_, i) => FIRST_YEAR + i);
// Sensor milestones worth labelling on the x-axis (+ first/last year)
const LABELLED_YEARS = new Set([FIRST_YEAR, 2005, 2012, 2018, 2023, CURRENT_YEAR]);
const GRID_COLUMNS = `24px repeat(${YEARS.length}, 1fr)`;

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
            message="Failed to load calendar data"
            subtext={error.message}
            onRetry={refetch}
          />
        )}

        {!loading && !error && (!data || data.length === 0) && (
          <EmptyState
            height="260px"
            message="No fire data for this area yet"
            subtext="No active fire records were returned for this spatial query."
          />
        )}

        {!loading && !error && data && data.length > 0 && (
          <div style={{ overflowX: 'auto', paddingBottom: '4px' }}>
            <div
              style={{
                minWidth: '640px',
                display: 'flex',
                flexDirection: 'column',
                gap: '3px',
              }}
              role="grid"
              aria-label={`Burning activity heatmap ${FIRST_YEAR}–${CURRENT_YEAR}`}
            >
              {/* Matrix: 12 Months down, 26 Years across */}
              {MONTH_LETTERS.map((letter, mIdx) => {
                const monthNum = mIdx + 1;
                return (
                  <div
                    key={`${letter}-${mIdx}`}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: GRID_COLUMNS,
                      gap: '3px',
                      alignItems: 'center',
                    }}
                    role="row"
                  >
                    {/* Month Label */}
                    <div
                      style={{
                        fontSize: '0.6875rem',
                        fontFamily: 'var(--font-mono)',
                        color: 'var(--color-text-tertiary)',
                        textAlign: 'left',
                        userSelect: 'none',
                      }}
                      role="rowheader"
                    >
                      {letter}
                    </div>

                    {/* Year Cells */}
                    {YEARS.map((year, colIdx) => {
                      const monthStr = `${year}-${String(monthNum).padStart(2, '0')}`;
                      if (monthStr > CURRENT_MONTH) {
                        return (
                          <div
                            key={`${year}-${monthNum}`}
                            style={{
                              height: '18px',
                              backgroundColor: 'transparent',
                              borderRadius: '2px',
                            }}
                            aria-hidden="true"
                          />
                        );
                      }

                      const cellData = calendarMap.get(monthStr);
                      const isSelected = selectedMonth === monthStr;

                      // No row = month not covered (before Terra, or outside the query) — not a true zero
                      if (!cellData) {
                        return (
                          <div
                            key={monthStr}
                            role="gridcell"
                            aria-label={`${formatMonthName(monthStr)}: no data`}
                            title={`${formatMonthName(monthStr)}: no data`}
                            style={{
                              height: '18px',
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
                          onClick={() => setSelectedMonth(monthStr)}
                          onMouseEnter={(e) => showTip(e.currentTarget)}
                          onFocus={(e) => showTip(e.currentTarget)}
                          onMouseLeave={() => setHoveredCell(null)}
                          onBlur={() => setHoveredCell(null)}
                          className={`cell cell-stagger ${isModis ? 'hatched-cell' : ''}`}
                          style={{
                            height: '18px',
                            backgroundColor: cellColor,
                            border: isSelected
                              ? '1.5px solid var(--color-gold)'
                              : isPartial
                                ? '1px dashed var(--color-gold)'
                                : '1px solid rgba(255, 255, 255, 0.05)',
                            borderRadius: '2px',
                            padding: 0,
                            cursor: 'pointer',
                            animationDelay: `${colIdx * 8}ms`,
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
                );
              })}

              {/* Year Labels */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: GRID_COLUMNS,
                  gap: '3px',
                  textAlign: 'center',
                  marginTop: '6px',
                }}
              >
                <div />
                {YEARS.map((y) => (
                  <div
                    key={y}
                    style={{
                      fontSize: '0.625rem',
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--color-text-tertiary)',
                      userSelect: 'none',
                    }}
                  >
                    {LABELLED_YEARS.has(y) ? `'${String(y).slice(2)}` : ''}
                  </div>
                ))}
              </div>
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
          <span>Hatched: estimated from MODIS (before VIIRS)</span>
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
