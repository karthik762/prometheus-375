// Rishitha – F3 burning calendar heatmap (year × month), plain SVG, no extra deps.
// Input is the /calendar response (AGENTS.md contract).
import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'

export interface CalendarPoint {
  month: string // YYYY-MM
  count: number
  source: 'viirs' | 'modis_converted'
  uncertainty_lo: number
  uncertainty_hi: number
}

export interface CalendarHeatmapProps {
  data: CalendarPoint[]
  startYear?: number
  endYear?: number
  /** Month shown as "month to date". Defaults to the latest month in `data`. */
  partialMonth?: string
  /** Accessible name for the whole grid. */
  title?: string
}

// Cividis, 9 evenly spaced stops (matplotlib/d3). Colour-blind safe, perceptually uniform.
const CIVIDIS = [
  '#00204d', '#00336f', '#39486b', '#575d6d', '#707173',
  '#8a8779', '#a69d75', '#c4b56c', '#ffea46',
] as const
const EMPTY_FILL = '#e5e7eb'
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Layout (SVG user units; the SVG scales to its container width).
const CELL_W = 34
const CELL_H = 16
const GAP = 2
const LEFT = 40
const TOP = 18
const LEGEND_GAP = 20
const LEGEND_H = 46

function hexToRgb(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const CIVIDIS_RGB = CIVIDIS.map(hexToRgb)

/** t in [0,1] → cividis colour, linear interpolation between the 9 stops. */
function cividis(t: number): string {
  const x = Math.min(1, Math.max(0, t)) * (CIVIDIS_RGB.length - 1)
  const i = Math.min(CIVIDIS_RGB.length - 2, Math.floor(x))
  const f = x - i
  const a = CIVIDIS_RGB[i]
  const b = CIVIDIS_RGB[i + 1]
  const c = a.map((v, k) => Math.round(v + (b[k] - v) * f))
  return `rgb(${c[0]},${c[1]},${c[2]})`
}

const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US')

/** Short tick labels: 0, 12, 160, 2.1k, 68k. */
function fmtTick(n: number): string {
  if (n < 1000) return String(Math.round(n))
  const k = n / 1000
  return `${k < 10 ? k.toFixed(1).replace(/\.0$/, '') : Math.round(k)}k`
}

/** Round to 2 significant figures so legend ticks read cleanly. */
function niceRound(n: number): number {
  if (n < 10) return Math.round(n)
  const p = Math.pow(10, Math.floor(Math.log10(n)) - 1)
  return Math.round(n / p) * p
}

function monthLabel(ym: string): string {
  const [y, m] = ym.split('-')
  return `${MONTHS[Number(m) - 1]} ${y}`
}

function describe(ym: string, p: CalendarPoint | undefined, partial: boolean): string {
  const when = monthLabel(ym)
  if (!p) return `${when} · no data`
  const mtd = partial ? ', month to date' : ''
  const fires = `${fmtInt(p.count)} fire${Math.round(p.count) === 1 ? '' : 's'}`
  if (p.source === 'modis_converted') {
    return `${when} · ${fires} (estimated from MODIS, ${fmtInt(p.uncertainty_lo)}–${fmtInt(p.uncertainty_hi)}${mtd})`
  }
  return `${when} · ${fires} (VIIRS measured${mtd})`
}

export default function CalendarHeatmap({
  data,
  startYear = 2000,
  endYear = 2026,
  partialMonth,
  title = 'Monthly burning calendar',
}: CalendarHeatmapProps) {
  const uid = useId().replace(/:/g, '')
  const hatchId = `hatch-${uid}`
  const gradId = `grad-${uid}`
  const svgRef = useRef<SVGSVGElement>(null)

  const { byMonth, maxLog, latest } = useMemo(() => {
    const m = new Map<string, CalendarPoint>()
    let max = 0
    let last = ''
    for (const p of data) {
      m.set(p.month, p)
      if (p.count > max) max = p.count
      if (p.month > last) last = p.month
    }
    return { byMonth: m, maxLog: Math.log1p(max), latest: last }
  }, [data])

  const mtdMonth = partialMonth ?? latest
  const years = useMemo(
    () => Array.from({ length: endYear - startYear + 1 }, (_, i) => startYear + i),
    [startYear, endYear],
  )

  // Roving tabindex: one tab stop for the grid, arrow keys move between cells.
  const [active, setActive] = useState<[number, number]>([years.length - 1, 9]) // latest Oct
  const [shown, setShown] = useState<[number, number] | null>(null)

  const gridW = 12 * (CELL_W + GAP) - GAP
  const gridH = years.length * (CELL_H + GAP) - GAP
  const width = LEFT + gridW + 4
  const legendY = TOP + gridH + LEGEND_GAP
  const height = legendY + LEGEND_H

  const colorFor = (count: number) => cividis(maxLog > 0 ? Math.log1p(count) / maxLog : 0)
  const keyOf = (r: number, c: number) => `${years[r]}-${String(c + 1).padStart(2, '0')}`

  const ticks = useMemo(
    () =>
      [0, 0.25, 0.5, 0.75, 1].map((t) => {
        const value = t === 0 ? 0 : niceRound(Math.expm1(t * maxLog))
        const pos = maxLog > 0 ? Math.log1p(value) / maxLog : t
        return { value, pos: Math.min(1, pos) }
      }),
    [maxLog],
  )

  const focusCell = (r: number, c: number) => {
    setActive([r, c])
    setShown([r, c])
    const el = svgRef.current?.querySelector<SVGRectElement>(`[data-cell="${r}-${c}"]`)
    el?.focus()
  }

  const onKeyDown = (e: KeyboardEvent<SVGRectElement>, r: number, c: number) => {
    let nr = r
    let nc = c
    switch (e.key) {
      case 'ArrowRight': nc = Math.min(11, c + 1); break
      case 'ArrowLeft': nc = Math.max(0, c - 1); break
      case 'ArrowDown': nr = Math.min(years.length - 1, r + 1); break
      case 'ArrowUp': nr = Math.max(0, r - 1); break
      case 'Home': nc = 0; break
      case 'End': nc = 11; break
      case 'Escape': setShown(null); return
      default: return
    }
    e.preventDefault()
    focusCell(nr, nc)
  }

  const tip = shown
    ? (() => {
        const [r, c] = shown
        const ym = keyOf(r, c)
        return {
          text: describe(ym, byMonth.get(ym), ym === mtdMonth),
          left: ((LEFT + c * (CELL_W + GAP) + CELL_W / 2) / width) * 100,
          top: ((TOP + r * (CELL_H + GAP)) / height) * 100,
          flip: c >= 8,
        }
      })()
    : null

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        role="group"
        aria-label={`${title}, ${startYear}–${endYear}. Use arrow keys to move between months.`}
        style={{ display: 'block', fontFamily: 'inherit', overflow: 'visible' }}
        onMouseLeave={() => setShown(null)}
      >
        <defs>
          {/* Two-tone diagonal hatch: visible on both the dark and light ends of cividis. */}
          <pattern id={hatchId} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke="rgba(255,255,255,0.7)" strokeWidth="1.4" />
            <line x1="1.4" y1="0" x2="1.4" y2="6" stroke="rgba(0,0,0,0.35)" strokeWidth="1" />
          </pattern>
          <linearGradient id={gradId} x1="0" x2="1" y1="0" y2="0">
            {CIVIDIS.map((c, i) => (
              <stop key={c} offset={i / (CIVIDIS.length - 1)} stopColor={c} />
            ))}
          </linearGradient>
        </defs>

        {/* Month header */}
        {MONTHS.map((m, c) => (
          <text
            key={m}
            x={LEFT + c * (CELL_W + GAP) + CELL_W / 2}
            y={TOP - 6}
            textAnchor="middle"
            fontSize={9}
            fill="currentColor"
            opacity={0.75}
            aria-hidden="true"
          >
            {m}
          </text>
        ))}

        {years.map((y, r) => {
          const rowY = TOP + r * (CELL_H + GAP)
          return (
            <g key={y}>
              <text
                x={LEFT - 6}
                y={rowY + CELL_H / 2}
                textAnchor="end"
                dominantBaseline="central"
                fontSize={9}
                fill="currentColor"
                opacity={y % 5 === 0 || r === years.length - 1 ? 0.85 : 0.5}
                aria-hidden="true"
              >
                {y}
              </text>
              {MONTHS.map((_, c) => {
                const ym = keyOf(r, c)
                const p = byMonth.get(ym)
                const x = LEFT + c * (CELL_W + GAP)
                const isActive = active[0] === r && active[1] === c
                const label = describe(ym, p, ym === mtdMonth)
                return (
                  <g key={ym}>
                    <rect
                      data-cell={`${r}-${c}`}
                      x={x}
                      y={rowY}
                      width={CELL_W}
                      height={CELL_H}
                      rx={2}
                      fill={p ? colorFor(p.count) : EMPTY_FILL}
                      tabIndex={isActive ? 0 : -1}
                      role="img"
                      aria-label={label}
                      onMouseEnter={() => setShown([r, c])}
                      onFocus={() => {
                        setActive([r, c])
                        setShown([r, c])
                      }}
                      onBlur={() => setShown(null)}
                      onKeyDown={(e) => onKeyDown(e, r, c)}
                      style={{ outline: 'none', cursor: 'default' }}
                    />
                    {p?.source === 'modis_converted' && (
                      <rect
                        x={x}
                        y={rowY}
                        width={CELL_W}
                        height={CELL_H}
                        rx={2}
                        fill={`url(#${hatchId})`}
                        pointerEvents="none"
                        aria-hidden="true"
                      />
                    )}
                    {ym === mtdMonth && p && (
                      <rect
                        x={x + 0.75}
                        y={rowY + 0.75}
                        width={CELL_W - 1.5}
                        height={CELL_H - 1.5}
                        rx={2}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={1}
                        strokeDasharray="3 2"
                        pointerEvents="none"
                        aria-hidden="true"
                      />
                    )}
                  </g>
                )
              })}
            </g>
          )
        })}

        {/* Hover / focus ring drawn on top so it is never hidden by neighbours */}
        {shown && (
          <rect
            x={LEFT + shown[1] * (CELL_W + GAP) - 1.5}
            y={TOP + shown[0] * (CELL_H + GAP) - 1.5}
            width={CELL_W + 3}
            height={CELL_H + 3}
            rx={3}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            pointerEvents="none"
            aria-hidden="true"
          />
        )}

        {/* Legend */}
        <g transform={`translate(${LEFT}, ${legendY})`} fontSize={9} fill="currentColor">
          <text x={0} y={0} opacity={0.75}>Active fires per month (log scale)</text>
          <rect x={0} y={6} width={200} height={10} rx={2} fill={`url(#${gradId})`} />
          {ticks.map(({ value, pos }) => (
            <g key={`${value}-${pos}`} transform={`translate(${pos * 200}, 16)`}>
              <line y1={0} y2={4} stroke="currentColor" opacity={0.6} />
              <text y={14} textAnchor="middle" opacity={0.85}>{fmtTick(value)}</text>
            </g>
          ))}

          <g transform="translate(232, 6)">
            <rect width={18} height={10} rx={2} fill={CIVIDIS[4]} />
            <rect width={18} height={10} rx={2} fill={`url(#${hatchId})`} />
            <text x={24} y={8.5}>estimated from MODIS</text>
          </g>
          <g transform="translate(232, 22)">
            <rect width={18} height={10} rx={2} fill={EMPTY_FILL} />
            <text x={24} y={8.5}>no data</text>
          </g>
          <g transform="translate(340, 22)">
            <rect x={0.75} y={0.75} width={16.5} height={8.5} rx={2} fill="none" stroke="currentColor" strokeDasharray="3 2" />
            <text x={24} y={8.5}>month to date</text>
          </g>
        </g>
      </svg>

      {tip && (
        <div
          role="tooltip"
          aria-hidden="true" /* the focused cell's aria-label already carries this text */
          style={{
            position: 'absolute',
            left: `${tip.left}%`,
            top: `${tip.top}%`,
            transform: `translate(${tip.flip ? '-100%' : '-50%'}, calc(-100% - 6px))`,
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            background: 'rgba(17,17,27,0.92)',
            color: '#fff',
            fontSize: 12,
            lineHeight: 1.3,
            padding: '5px 8px',
            borderRadius: 4,
            boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
            zIndex: 10,
          }}
        >
          {tip.text}
        </div>
      )}
    </div>
  )
}
