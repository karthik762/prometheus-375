// Rishitha – F6 before/after chart: raw hotspot counts vs harmonized series, plain SVG, no extra deps.
// Input mirrors /validation `before_after` rows, plus optional uncertainty bounds.
// A month with uncertainty_lo/hi set is treated as estimated from MODIS (modis_converted).
import { useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'

export interface BeforeAfterPoint {
  month: string // YYYY-MM
  raw: number
  harmonized: number
  uncertainty_lo?: number
  uncertainty_hi?: number
}

export interface BeforeAfterChartProps {
  data: BeforeAfterPoint[]
  title?: string
}

const HARMONIZED = '#00336f' // cividis dark blue
const RAW = '#6b7280' // neutral grey
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MARKERS = [
  { month: '2012-02', label: 'S-NPP joins' },
  { month: '2018-04', label: 'NOAA-20 joins' },
] as const

// Layout (SVG user units; the SVG scales to its container width).
const W = 760
const H = 360
const M = { top: 28, right: 16, bottom: 74, left: 62 }
const PW = W - M.left - M.right
const PH = H - M.top - M.bottom

const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US')

function fmtTick(n: number): string {
  if (n < 1000) return String(Math.round(n))
  const k = n / 1000
  return `${k < 10 ? k.toFixed(1).replace(/\.0$/, '') : Math.round(k)}k`
}

/** Nice step so the y axis gets ~5 round ticks. */
function niceStep(max: number, target = 5): number {
  if (max <= 0) return 1
  const raw = max / target
  const p = Math.pow(10, Math.floor(Math.log10(raw)))
  const f = raw / p
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p
}

function monthLabel(ym: string): string {
  const [y, m] = ym.split('-')
  return `${MONTHS[Number(m) - 1]} ${y}`
}

const isEstimated = (p: BeforeAfterPoint) => p.uncertainty_lo != null && p.uncertainty_hi != null

function describe(p: BeforeAfterPoint): string {
  const base = `${monthLabel(p.month)} · raw ${fmtInt(p.raw)} · harmonized ${fmtInt(p.harmonized)}`
  return isEstimated(p) ? `${base} (estimated from MODIS)` : `${base} (VIIRS measured)`
}

export default function BeforeAfterChart({
  data,
  title = 'Raw counts jump when satellites join. Harmonized doesn’t.',
}: BeforeAfterChartProps) {
  const uid = useId().replace(/:/g, '')
  const titleId = `ba-title-${uid}`
  const descId = `ba-desc-${uid}`
  const svgRef = useRef<SVGSVGElement>(null)

  const points = useMemo(() => [...data].sort((a, b) => a.month.localeCompare(b.month)), [data])
  const n = points.length

  const { yMax, yTicks } = useMemo(() => {
    let max = 0
    for (const p of points) max = Math.max(max, p.raw, p.harmonized, p.uncertainty_hi ?? 0)
    const step = niceStep(max)
    const top = Math.max(step, Math.ceil(max / step) * step)
    const ticks: number[] = []
    for (let v = 0; v <= top + step / 2; v += step) ticks.push(v)
    return { yMax: top, yTicks: ticks }
  }, [points])

  const x = (i: number) => M.left + (n <= 1 ? PW / 2 : (i / (n - 1)) * PW)
  const y = (v: number) => M.top + PH - (v / yMax) * PH

  const { rawPath, harmPath, bandPaths, yearTicks, markerXs } = useMemo(() => {
    const line = (get: (p: BeforeAfterPoint) => number) =>
      points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(get(p)).toFixed(1)}`).join('')

    // One closed area per contiguous run of estimated (MODIS-converted) months.
    const bands: string[] = []
    let run: number[] = []
    const flush = () => {
      if (!run.length) return
      const top = run.map((i, k) => `${k ? 'L' : 'M'}${x(i).toFixed(1)},${y(points[i].uncertainty_hi!).toFixed(1)}`)
      const bot = [...run].reverse().map((i) => `L${x(i).toFixed(1)},${y(points[i].uncertainty_lo!).toFixed(1)}`)
      bands.push(`${top.join('')}${bot.join('')}Z`)
      run = []
    }
    points.forEach((p, i) => (isEstimated(p) ? run.push(i) : flush()))
    flush()

    const years: { i: number; year: string }[] = []
    points.forEach((p, i) => {
      const [yr, m] = p.month.split('-')
      if (m === '01' && Number(yr) % 2 === 0) years.push({ i, year: yr })
    })

    const idx = new Map(points.map((p, i) => [p.month, i]))
    const mx = MARKERS.filter((mk) => idx.has(mk.month)).map((mk) => ({ ...mk, x: x(idx.get(mk.month)!) }))

    return { rawPath: line((p) => p.raw), harmPath: line((p) => p.harmonized), bandPaths: bands, yearTicks: years, markerXs: mx }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, yMax])

  // Roving tabindex: the chart is one tab stop; arrow keys move between months.
  const [active, setActive] = useState(() => Math.max(0, n - 1))
  const [shown, setShown] = useState<number | null>(null)
  const activeIdx = Math.min(active, Math.max(0, n - 1))

  const focusPoint = (i: number) => {
    const c = Math.min(n - 1, Math.max(0, i))
    setActive(c)
    setShown(c)
    svgRef.current?.querySelector<SVGCircleElement>(`[data-pt="${c}"]`)?.focus()
  }

  const onKeyDown = (e: KeyboardEvent<SVGCircleElement>, i: number) => {
    const moves: Record<string, number> = {
      ArrowLeft: i - 1, ArrowRight: i + 1, ArrowDown: i - 1, ArrowUp: i + 1,
      PageUp: i - 12, PageDown: i + 12, Home: 0, End: n - 1,
    }
    if (e.key in moves) {
      e.preventDefault()
      focusPoint(moves[e.key])
    } else if (e.key === 'Escape') {
      setShown(null)
    }
  }

  // Pointer → nearest month (works for mouse, pen and touch).
  const onPointerMove = (e: PointerEvent<SVGRectElement>) => {
    const svg = svgRef.current
    const ctm = svg?.getScreenCTM()
    if (!svg || !ctm || n === 0) return
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse())
    const i = Math.round(((pt.x - M.left) / PW) * (n - 1))
    setShown(Math.min(n - 1, Math.max(0, i)))
  }

  if (n === 0) {
    return (
      <figure style={{ margin: 0 }}>
        <figcaption style={{ fontWeight: 600 }}>{title}</figcaption>
        <p>No data for this area.</p>
      </figure>
    )
  }

  const tipPt = shown != null ? points[shown] : null
  const tip = tipPt && shown != null
    ? {
        text: describe(tipPt),
        left: (x(shown) / W) * 100,
        top: (Math.min(y(tipPt.harmonized), y(tipPt.raw)) / H) * 100,
        align: x(shown) > W * 0.75 ? '-100%' : x(shown) < W * 0.25 ? '0%' : '-50%',
      }
    : null

  const legendY = H - 22

  return (
    <figure style={{ position: 'relative', margin: 0, color: 'inherit' }}>
      <figcaption id={titleId} style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>
        {title}
      </figcaption>
      <p id={descId} style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
        Monthly active-fire counts from {monthLabel(points[0].month)} to {monthLabel(points[n - 1].month)}.
        Grey dashed line: raw hotspot totals, which step up when S-NPP joins in February 2012 and NOAA-20 in April 2018.
        Blue solid line: harmonized series in VIIRS-equivalent units, with a shaded band where values are estimated from MODIS.
        Use the arrow keys to move between months, Page Up and Page Down to jump a year.
      </p>

      <div style={{ position: 'relative' }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="group"
        aria-labelledby={titleId}
        aria-describedby={descId}
        style={{ display: 'block', overflow: 'visible', fontFamily: 'inherit' }}
      >
        {/* Grid + y axis */}
        <g fontSize={10} fill="currentColor">
          {yTicks.map((v) => (
            <g key={v} transform={`translate(0, ${y(v)})`}>
              <line x1={M.left} x2={W - M.right} stroke="currentColor" opacity={v === 0 ? 0.5 : 0.12} />
              <text x={M.left - 6} dy="0.32em" textAnchor="end" opacity={0.8}>{fmtTick(v)}</text>
            </g>
          ))}
          <text
            transform={`translate(14, ${M.top + PH / 2}) rotate(-90)`}
            textAnchor="middle"
            opacity={0.8}
          >
            Active fires per month
          </text>
        </g>

        {/* x axis */}
        <g fontSize={10} fill="currentColor">
          {yearTicks.map(({ i, year }) => (
            <g key={year} transform={`translate(${x(i)}, ${M.top + PH})`}>
              <line y2={4} stroke="currentColor" opacity={0.5} />
              <text y={15} textAnchor="middle" opacity={0.8}>{year}</text>
            </g>
          ))}
          <text x={M.left + PW / 2} y={M.top + PH + 32} textAnchor="middle" opacity={0.8}>Month</text>
        </g>

        {/* Satellite-join markers */}
        {markerXs.map((mk) => (
          <g key={mk.month} aria-hidden="true">
            <line
              x1={mk.x}
              x2={mk.x}
              y1={M.top - 4}
              y2={M.top + PH}
              stroke="currentColor"
              strokeWidth={1}
              strokeDasharray="2 3"
              opacity={0.6}
            />
            <text x={mk.x + 4} y={M.top + 6} fontSize={10} fill="currentColor" opacity={0.9}>
              {mk.label}
            </text>
          </g>
        ))}

        {/* Uncertainty band, raw line, harmonized line */}
        {bandPaths.map((d, k) => (
          <path key={k} d={d} fill={HARMONIZED} opacity={0.2} stroke="none" aria-hidden="true" />
        ))}
        <path d={rawPath} fill="none" stroke={RAW} strokeWidth={1.25} strokeDasharray="4 3" aria-hidden="true" />
        <path d={harmPath} fill="none" stroke={HARMONIZED} strokeWidth={1.75} strokeLinejoin="round" aria-hidden="true" />

        {/* Hover capture */}
        <rect
          x={M.left}
          y={M.top}
          width={PW}
          height={PH}
          fill="transparent"
          onPointerMove={onPointerMove}
          onPointerLeave={() => setShown(null)}
          aria-hidden="true"
        />

        {/* Hover/focus guide */}
        {shown != null && (
          <g pointerEvents="none" aria-hidden="true">
            <line x1={x(shown)} x2={x(shown)} y1={M.top} y2={M.top + PH} stroke="currentColor" opacity={0.25} />
            <circle cx={x(shown)} cy={y(points[shown].raw)} r={3.5} fill="#fff" stroke={RAW} strokeWidth={1.5} />
          </g>
        )}

        {/* Focusable points on the harmonized line (one tab stop, arrow keys move) */}
        <g>
          {points.map((p, i) => {
            const on = shown === i
            return (
              <circle
                key={p.month}
                data-pt={i}
                cx={x(i)}
                cy={y(p.harmonized)}
                r={on ? 4.5 : 2.5}
                fill={on ? HARMONIZED : 'transparent'}
                stroke={on ? '#fff' : 'none'}
                strokeWidth={1.5}
                tabIndex={i === activeIdx ? 0 : -1}
                role="img"
                aria-label={describe(p)}
                onFocus={() => {
                  setActive(i)
                  setShown(i)
                }}
                onBlur={() => setShown(null)}
                onKeyDown={(e) => onKeyDown(e, i)}
                onPointerEnter={() => setShown(i)}
                style={{ outline: 'none' }}
              />
            )
          })}
        </g>

        {/* Legend */}
        <g transform={`translate(${M.left}, ${legendY})`} fontSize={10} fill="currentColor" aria-hidden="true">
          <line x1={0} x2={22} y1={0} y2={0} stroke={RAW} strokeWidth={1.5} strokeDasharray="4 3" />
          <text x={28} dy="0.32em">Raw hotspot count</text>

          <g transform="translate(140, 0)">
            <line x1={0} x2={22} y1={0} y2={0} stroke={HARMONIZED} strokeWidth={2} />
            <text x={28} dy="0.32em">Harmonized (VIIRS-equivalent)</text>
          </g>

          <g transform="translate(330, 0)">
            <rect x={0} y={-5} width={22} height={10} fill={HARMONIZED} opacity={0.2} />
            <text x={28} dy="0.32em">Uncertainty (estimated from MODIS)</text>
          </g>

          <g transform="translate(540, 0)">
            <line x1={11} x2={11} y1={-6} y2={6} stroke="currentColor" strokeDasharray="2 3" opacity={0.6} />
            <text x={20} dy="0.32em">Satellite joins</text>
          </g>
        </g>
      </svg>

      {tip && (
        <div
          role="tooltip"
          aria-hidden="true" /* the focused point's aria-label already carries this text */
          style={{
            position: 'absolute',
            left: `${tip.left}%`,
            top: `${tip.top}%`,
            transform: `translate(${tip.align}, calc(-100% - 10px))`,
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
    </figure>
  )
}
