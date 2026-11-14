/**
 * StoryHero: a 500vh scroll-scrubbed hero. A sticky 100vh stage shows one SVG whose state is a
 * pure function of scroll progress p (0..1). One passive scroll listener + rAF writes CSS
 * custom properties (--p on the stage, a few per-chart vars on each chart <g>); all motion is
 * CSS calc() on transform / opacity (plus stroke-dashoffset for the drawn lines). React renders
 * once per layout (wide / narrow), never per scroll frame.
 *
 * Every number comes from src/mocks/hero_*.json (pipeline/export_hero_mocks.py).
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import pbHrJson from '../mocks/hero_pb_hr.json';
import brazilJson from '../mocks/hero_brazil.json';
import californiaJson from '../mocks/hero_california.json';
import australiaJson from '../mocks/hero_australia.json';
import greeceJson from '../mocks/hero_greece.json';
import './StoryHero.css';

// ---------------------------------------------------------------------------------- data

interface HeroYear {
  year: number;
  raw: number;
  harmonized: number;
  lo: number;
  hi: number;
  source: string;
  partial?: boolean;
}
interface HeroSat {
  name: string;
  start: string;
  end: string | null;
}
interface HeroData {
  region: string;
  label: string;
  satellites: HeroSat[];
  years: HeroYear[];
  nov_mtd_2026?: number;
  nov_mtd_median?: number;
  pct?: number;
}

function asHero(x: unknown): HeroData {
  const h = x as HeroData;
  if (!h || typeof h.label !== 'string' || !Array.isArray(h.years) || h.years.length < 2) {
    throw new Error('StoryHero: hero JSON has an unexpected shape');
  }
  return h;
}

const FEATURE = asHero(pbHrJson);
const OTHERS = [brazilJson, californiaJson, australiaJson, greeceJson].map(asHero);
const HEROES = [FEATURE, ...OTHERS];

if (FEATURE.nov_mtd_2026 === undefined || FEATURE.nov_mtd_median === undefined) {
  throw new Error('StoryHero: hero_pb_hr.json is missing nov_mtd_2026 / nov_mtd_median');
}
const NOV_NOW = FEATURE.nov_mtd_2026;
const NOV_USUAL = FEATURE.nov_mtd_median;
const NOV_DROP = Math.round((1 - NOV_NOW / NOV_USUAL) * 100);

// Labels (not data).
const DATA_THROUGH = 'data through 13 Nov 2026';
const MTD_LABEL = '1–13 Nov';
const LINES = [
  'Since 2000, satellites have counted every fire.',
  'Then the record broke.',
  'The satellite changed, not the fire. We fixed it.',
  'For anywhere on Earth.',
  'And it tells you what’s unusual today.',
  'Satellites keep retiring. Our record doesn’t break.',
];
const BREAKS = [0, 0.15, 0.3, 0.45, 0.65, 0.85, 1];

const fmt = (v: number) => Math.round(v).toLocaleString('en-US');

// ------------------------------------------------------------------------------ geometry
// Each region chart is drawn in its own local box (W x 440), then placed with translate+scale.

const X0 = 40;
const X1 = 980;
const TOP = 40;
const BASE = 400;
const SWEEP_W = 90;

interface Bar {
  i: number;
  x: number;
  y: number;
  h: number;
  hy: number; // harmonized top (hatch)
  post: boolean;
  modis: boolean;
  sx: number; // shake direction
}
interface Ember {
  cx: number;
  cy: number;
  r: number;
  d: number;
  dx: number;
  dy: number;
}
interface Geo {
  n: number;
  band: number;
  bw: number;
  crackIdx: number;
  crackYear: number;
  bars: Bar[];
  xs: number[];
  cum: number[]; // cumulative harmonized-line length fraction at each point
  line: string;
  area: string;
  crack: string;
  crackX: number;
  embers: Ember[];
  focus: { x: number; w: number; y: number; h: number; ratio: number } | null;
  ticks: { x: number; label: string; anchor: 'start' | 'middle' | 'end'; now: boolean }[];
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildGeo(h: HeroData, seed: number, withExtras: boolean): Geo {
  const ys = h.years;
  const n = ys.length;
  const band = (X1 - X0) / n;
  const bw = band * 0.64;
  const first = ys.findIndex((y) => y.source === 'viirs');
  const crackIdx = first < 0 ? n : first;
  const vmax = Math.max(...ys.map((y) => Math.max(y.raw, y.hi))) * 1.04 || 1;
  const sy = (v: number) => BASE - (v / vmax) * (BASE - TOP);
  const rand = rng(seed);

  const bars: Bar[] = ys.map((y, i) => {
    const top = sy(y.raw);
    return {
      i,
      x: X0 + i * band + (band - bw) / 2,
      y: top,
      h: Math.max(0.5, BASE - top),
      hy: sy(y.harmonized),
      post: i >= crackIdx,
      modis: y.source !== 'viirs',
      sx: rand() < 0.5 ? -1 : 1,
    };
  });

  const xs = ys.map((_, i) => X0 + (i + 0.5) * band);
  const pts = ys.map((y, i) => [xs[i], sy(y.harmonized)] as const);
  const lens = [0];
  for (let i = 1; i < pts.length; i++) {
    lens.push(lens[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  }
  const total = lens[lens.length - 1] || 1;
  const cum = lens.map((l) => l / total);
  const f = (v: number) => v.toFixed(1);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${f(x)} ${f(y)}`).join('');
  const area =
    ys.map((y, i) => `${i ? 'L' : 'M'}${f(xs[i])} ${f(sy(y.hi))}`).join('') +
    ys
      .map((y, i) => [xs[i], sy(y.lo)] as const)
      .reverse()
      .map(([x, y]) => `L${f(x)} ${f(y)}`)
      .join('') +
    'Z';

  const crackX = X0 + crackIdx * band;
  const steps = 11;
  const crack = Array.from({ length: steps + 1 }, (_, k) => {
    const y = BASE + 14 - (k / steps) * (BASE + 14 - (TOP - 16));
    const jx = k === 0 || k === steps ? 0 : (k % 2 ? 1 : -1) * (3 + rand() * 9);
    return `${k ? 'L' : 'M'}${f(crackX + jx)} ${f(y)}`;
  }).join('');

  const embers: Ember[] = [];
  if (withExtras) {
    const preMax = Math.max(1, ...ys.slice(0, crackIdx).map((y) => y.raw));
    bars.slice(0, crackIdx).forEach((b) => {
      const count = 2 + Math.round((ys[b.i].raw / preMax) * 4);
      for (let k = 0; k < count; k++) {
        const endX = b.x + bw / 2 + (rand() - 0.5) * bw * 0.7;
        const startY = -150 + rand() * 70;
        const dx = (rand() - 0.5) * 40;
        embers.push({
          cx: endX - dx,
          cy: startY,
          r: 4 + rand() * 4,
          d: b.i - 0.95 + (k / count) * 0.8,
          dx,
          dy: b.y - startY - 2,
        });
      }
    });
  }

  let focus: Geo['focus'] = null;
  if (withExtras && h.nov_mtd_2026 !== undefined && h.nov_mtd_median) {
    // Own scale (labelled with its value): on the annual axis 1-13 Nov is only a few px tall.
    const w = band * 0.92;
    const y = BASE - 0.62 * (BASE - TOP);
    focus = { x: X0 + (n - 1) * band + (band - w) / 2, w, y, h: BASE - y, ratio: h.nov_mtd_2026 / h.nov_mtd_median };
  }

  const last = ys[n - 1];
  const ticks: Geo['ticks'] = [
    { x: X0 + (band - bw) / 2, label: String(ys[0].year), anchor: 'start', now: false },
    { x: X1 - (band - bw) / 2, label: `${last.year}${last.partial ? ' to date' : ''}`, anchor: 'end', now: true },
  ];
  if (crackIdx > 1 && crackIdx < n - 3) {
    ticks.splice(1, 0, { x: crackX, label: String(ys[crackIdx].year), anchor: 'middle', now: false });
  }

  return {
    n,
    band,
    bw,
    crackIdx,
    crackYear: ys[Math.min(crackIdx, n - 1)].year,
    bars,
    xs,
    cum,
    line,
    area,
    crack,
    crackX,
    embers,
    focus,
    ticks,
  };
}

/** Fraction of the harmonized line's length lying left of the sweep at `fx` year-units. */
function lenAt(g: Geo, fx: number): number {
  const x = X0 + fx * g.band;
  const { xs, cum } = g;
  if (x <= xs[0]) return 0;
  if (x >= xs[xs.length - 1]) return 1;
  let k = 0;
  while (k < xs.length - 2 && xs[k + 1] <= x) k++;
  const t = (x - xs[k]) / (xs[k + 1] - xs[k]);
  return cum[k] + t * (cum[k + 1] - cum[k]);
}

// ------------------------------------------------------------------------------- layouts

interface Pt {
  x: number;
  y: number;
}
interface Layout {
  name: 'wide' | 'narrow';
  w: number;
  h: number;
  full: Pt;
  tiles: Pt[]; // 5 tiles, [0] = feature region
  k: number; // tile scale
  fly: Pt; // offset the other tiles fly in from
  labelPx: number; // tile label size in viewBox units
  fs: number; // chart text scale
}
const WIDE: Layout = {
  name: 'wide',
  w: 1200,
  h: 700,
  full: { x: 100, y: 200 },
  tiles: [
    { x: 50, y: 165 },
    { x: 430, y: 165 },
    { x: 810, y: 165 },
    { x: 240, y: 430 },
    { x: 620, y: 430 },
  ],
  k: 0.34,
  fly: { x: 640, y: 260 },
  labelPx: 18,
  fs: 1,
};
const NARROW: Layout = {
  name: 'narrow',
  w: 1040,
  h: 1180,
  full: { x: 20, y: 400 },
  tiles: [
    { x: 20, y: 190 },
    { x: 550, y: 190 },
    { x: 20, y: 490 },
    { x: 550, y: 490 },
    { x: 285, y: 790 },
  ],
  k: 0.47,
  fly: { x: 560, y: 420 },
  labelPx: 32,
  fs: 1.5,
};

interface Star {
  x: number;
  y: number;
  r: number;
  tw: boolean;
  delay: number;
}
function makeStars(l: Layout): Star[] {
  const rand = rng(l.name === 'wide' ? 7 : 11);
  return Array.from({ length: 80 }, () => ({
    x: rand() * l.w,
    y: rand() * l.h * 0.85,
    r: 0.6 + rand() * 1.4,
    tw: rand() < 0.35,
    delay: rand() * 4,
  }));
}

// --------------------------------------------------------------------------- scroll math

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const seg = (v: number, a: number, b: number) => clamp01((v - a) / (b - a));
const ease = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function lineIndex(p: number): number {
  for (let i = BREAKS.length - 2; i > 0; i--) if (p >= BREAKS[i]) return i;
  return 0;
}

const NARROW_Q = '(max-width: 640px)';
const REDUCED_Q = '(prefers-reduced-motion: reduce)';
const mq = (q: string) => typeof window !== 'undefined' && window.matchMedia(q).matches;

function useMedia(q: string): boolean {
  const [on, setOn] = useState(() => mq(q));
  useEffect(() => {
    const m = window.matchMedia(q);
    const fn = () => setOn(m.matches);
    fn();
    m.addEventListener('change', fn);
    return () => m.removeEventListener('change', fn);
  }, [q]);
  return on;
}

const vars = (o: Record<string, string | number>) => o as CSSProperties;

// ------------------------------------------------------------------------------- chart

interface ChartProps {
  hero: HeroData;
  geo: Geo;
  uid: string;
  feature: boolean;
  layout: Layout;
  setRef: (el: SVGGElement | null) => void;
}

function Chart({ hero, geo, uid, feature, layout, setRef }: ChartProps) {
  const fs = layout.fs;
  const snpp = hero.satellites.find((s) => s.start.startsWith(String(geo.crackYear)));
  const pre = geo.bars.filter((b) => !b.post);
  const post = geo.bars.filter((b) => b.post);
  const barEls = (b: Bar) => (
    <g key={b.i}>
      <rect
        className={b.post ? 'sh-bar is-post' : 'sh-bar'}
        x={b.x}
        y={b.y}
        width={geo.bw}
        height={b.h}
        fill={`url(#${uid}-${b.post ? 'post' : 'pre'})`}
        style={vars({ '--i': b.i, '--sx': b.sx })}
      />
      <rect className="sh-ghost" x={b.x} y={b.y} width={geo.bw} height={b.h} style={vars({ '--i': b.i })} />
    </g>
  );

  return (
    <g className="sh-chart" ref={setRef}>
      {feature && (
        <text className="sh-title" x={X0} y={-66} fontSize={24 * fs}>
          Fires detected per year · {hero.label}
        </text>
      )}
      <text className="sh-label" x={X0} y={-12 / layout.k} fontSize={layout.labelPx / layout.k}>
        {hero.label}
      </text>

      {feature && (
        <g className="sh-legend" fontSize={18 * fs}>
          <rect className="sh-legend-ghost" x={X0} y={-38 * fs + 6} width={16 * fs} height={16 * fs} />
          <text x={X0 + 26 * fs} y={-24 * fs + 6}>raw, all satellites</text>
          <line className="sh-legend-line" x1={X0 + 230 * fs} x2={X0 + 262 * fs} y1={-30 * fs + 6} y2={-30 * fs + 6} />
          <text x={X0 + 272 * fs} y={-24 * fs + 6}>harmonized</text>
          <rect x={X0 + 400 * fs} y={-38 * fs + 6} width={16 * fs} height={16 * fs} fill={`url(#${uid}-hatch)`} />
          <text x={X0 + 426 * fs} y={-24 * fs + 6}>MODIS, converted</text>
        </g>
      )}

      <line className="sh-baseline" x1={X0 - 10} x2={X1 + 10} y1={BASE} y2={BASE} />

      {geo.bars
        .filter((b) => b.modis)
        .map((b) => (
          <rect
            key={b.i}
            className="sh-hatch"
            x={b.x}
            y={b.hy}
            width={geo.bw}
            height={Math.max(0.5, BASE - b.hy)}
            fill={`url(#${uid}-hatch)`}
            style={vars({ '--i': b.i })}
          />
        ))}

      <g className="sh-pre">{pre.map(barEls)}</g>
      <g className="sh-post">{post.map(barEls)}</g>

      <path className="sh-band" d={geo.area} />
      <path className="sh-hline-glow" d={geo.line} pathLength={1} />
      <path className="sh-hline" d={geo.line} pathLength={1} />

      {geo.crackIdx < geo.n && (
        <g className="sh-crackg">
          <path className="sh-crack-glow" d={geo.crack} pathLength={1} />
          <path className="sh-crack" d={geo.crack} pathLength={1} />
          {feature && (
            <text className="sh-crack-lab" x={geo.crackX + 14} y={TOP - 6} fontSize={20 * fs}>
              {snpp ? `${snpp.name} joins · ${geo.crackYear}` : `sensor change · ${geo.crackYear}`}
            </text>
          )}
        </g>
      )}

      <rect
        className="sh-sweep"
        x={-SWEEP_W / 2}
        y={TOP - 30}
        width={SWEEP_W}
        height={BASE - TOP + 30}
        fill={`url(#${uid}-sweep)`}
      />

      {geo.focus && (
        <g className="sh-focusg">
          <rect
            className="sh-focus"
            x={geo.focus.x}
            y={geo.focus.y}
            width={geo.focus.w}
            height={geo.focus.h}
            fill={`url(#${uid}-focus)`}
            style={vars({ '--ratio': geo.focus.ratio.toFixed(5) })}
          />
          <line
            className="sh-median"
            x1={geo.focus.x - 26}
            x2={geo.focus.x + geo.focus.w + 6}
            y1={geo.focus.y}
            y2={geo.focus.y}
          />
          <text className="sh-focus-lab" x={geo.focus.x - 34} y={geo.focus.y + 7 * fs} fontSize={20 * fs} textAnchor="end">
            usual {MTD_LABEL} · {fmt(hero.nov_mtd_median ?? 0)}
          </text>
        </g>
      )}

      {geo.embers.map((e, i) => (
        <circle
          key={i}
          className="sh-ember"
          cx={e.cx}
          cy={e.cy}
          r={e.r}
          fill={`url(#${uid}-ember)`}
          style={vars({ '--d': e.d.toFixed(3), '--dx': e.dx.toFixed(1), '--dy': e.dy.toFixed(1) })}
        />
      ))}

      <g className="sh-axis" fontSize={20 * fs}>
        {geo.ticks.map((t) => (
          <text key={t.label} className={t.now ? 'is-now' : undefined} x={t.x} y={BASE + 30 * fs} textAnchor={t.anchor}>
            {t.label}
          </text>
        ))}
      </g>
    </g>
  );
}

// ---------------------------------------------------------------------------- component

export default function StoryHero() {
  const uid = 'sh' + useId().replace(/[^a-zA-Z0-9]/g, '');
  const narrow = useMedia(NARROW_Q);
  const reduced = useMedia(REDUCED_Q);
  const layout = narrow ? NARROW : WIDE;

  const geos = useMemo(() => HEROES.map((h, i) => buildGeo(h, 375 + i * 31, i === 0)), []);
  const stars = useMemo(() => makeStars(layout), [layout]);

  const sectionRef = useRef<HTMLElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const chartRefs = useRef<(SVGGElement | null)[]>([]);
  const counterRef = useRef<HTMLSpanElement | null>(null);
  const liveRef = useRef<HTMLParagraphElement | null>(null);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    const section = sectionRef.current;
    if (!stage || !section) return;

    const cache = new WeakMap<Element, Map<string, string>>();
    const setVar = (el: HTMLElement | SVGElement | null, name: string, v: number) => {
      if (!el) return;
      let m = cache.get(el);
      if (!m) cache.set(el, (m = new Map()));
      const s = (Math.abs(v) < 1e-4 ? 0 : v).toFixed(4);
      if (m.get(name) === s) return;
      m.set(name, s);
      el.style.setProperty(name, s);
    };
    const announced = new Set<number>();
    let counterVal = NaN;
    let active = '';

    const g0 = geos[0];
    const render = (p: number, inView: boolean) => {
      setVar(stage, '--p', p);
      const [s1, s2, s3, s4, s5, s6] = BREAKS.slice(0, -1).map((a, i) => seg(p, a, BREAKS[i + 1]));

      const shrink = ease(seg(s4, 0, 0.3));
      const expand = ease(seg(s5, 0, 0.3));
      const m = shrink * (1 - expand);

      // Feature chart (Punjab + Haryana): embers -> raw bars -> crack -> sweep/fix -> tile -> focus.
      const c = g0.crackIdx;
      const r0 = s2 > 0 ? c + Math.min(1, s2 * 1.12) * (g0.n - c) : -0.3 + s1 * (c + 0.3);
      const fx0 = s3 * g0.n;
      const el0 = chartRefs.current[0];
      const T0 = layout.tiles[0];
      setVar(el0, '--tx', lerp(layout.full.x, T0.x, m));
      setVar(el0, '--ty', lerp(layout.full.y, T0.y, m));
      setVar(el0, '--k', lerp(1, layout.k, m));
      setVar(el0, '--o', 1);
      setVar(el0, '--lab', m);
      setVar(el0, '--r', r0);
      setVar(el0, '--crack', ease(seg(r0, c, c + 3)));
      setVar(el0, '--fix', s3);
      setVar(el0, '--fx', fx0);
      setVar(el0, '--draw', lenAt(g0, fx0));
      setVar(el0, '--sw', X0 + fx0 * g0.band);
      setVar(el0, '--shk', s3 > 0 ? 0 : Math.sin(p * 2400));
      setVar(el0, '--dim', seg(s5, 0.25, 0.45));
      setVar(el0, '--focus', seg(s5, 0.2, 0.35));
      const sink = ease(seg(s5, 0.4, 0.9));
      setVar(el0, '--sink', sink);

      // The other four regions fly in and run their own crack -> fix in a cascade.
      for (let j = 0; j < OTHERS.length; j++) {
        const el = chartRefs.current[j + 1];
        const g = geos[j + 1];
        const T = layout.tiles[j + 1];
        const fly = ease(seg(s4, 0.08 + j * 0.1, 0.3 + j * 0.1));
        const u = seg(s4, 0.2 + j * 0.12, 0.62 + j * 0.12);
        const fix = seg(u, 0.55, 1);
        const fx = fix * g.n;
        setVar(el, '--tx', T.x + (1 - fly) * layout.fly.x);
        setVar(el, '--ty', T.y + (1 - fly) * layout.fly.y);
        setVar(el, '--k', layout.k);
        setVar(el, '--o', fly * (1 - expand));
        setVar(el, '--lab', 1);
        setVar(el, '--r', clamp01(u / 0.45) * g.n);
        setVar(el, '--crack', ease(seg(u, 0.25, 0.5)));
        setVar(el, '--fix', fix);
        setVar(el, '--fx', fx);
        setVar(el, '--draw', lenAt(g, fx));
        setVar(el, '--sw', X0 + fx * g.band);
        setVar(el, '--shk', fix > 0 ? 0 : Math.sin(p * 2400 + j * 1.7));
      }

      setVar(stage, '--stat', seg(s5, 0.15, 0.3));
      setVar(stage, '--lock', seg(s5, 0.88, 0.98));
      const v = Math.round(lerp(NOV_USUAL, NOV_NOW, sink));
      if (v !== counterVal && counterRef.current) {
        counterVal = v;
        counterRef.current.textContent = fmt(v);
      }
      const act = s6 > 0.2 ? '1' : '0';
      if (act !== active) {
        active = act;
        stage.dataset.active = act;
      }

      const idx = lineIndex(p);
      if (inView && !announced.has(idx) && liveRef.current) {
        announced.add(idx);
        liveRef.current.textContent = LINES[idx];
      }
    };

    if (reduced) {
      render(1, false);
      return;
    }

    let raf = 0;
    const update = () => {
      raf = 0;
      const rect = section.getBoundingClientRect();
      const vh = window.innerHeight;
      const span = Math.max(1, rect.height - vh);
      render(clamp01(-rect.top / span), rect.bottom > 0 && rect.top < vh);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [reduced, layout, geos]);

  // Keyboard users tabbing to the buttons jump to the settled state.
  const onActionsFocus = () => {
    const section = sectionRef.current;
    if (reduced || !section) return;
    const rect = section.getBoundingClientRect();
    const span = rect.height - window.innerHeight;
    if (-rect.top / span < 0.9) window.scrollTo({ top: window.scrollY + rect.top + span * 0.97 });
  };

  const headlineId = `${uid}-headline`;
  const summary =
    `Yearly fire detections in ${FEATURE.label}, ${FEATURE.years[0].year}–${FEATURE.years[FEATURE.years.length - 1].year}. ` +
    `Raw counts jump in ${geos[0].crackYear} when a new satellite joins; the harmonized series stays continuous. ` +
    `${MTD_LABEL} ${FEATURE.years[FEATURE.years.length - 1].year}: ${fmt(NOV_NOW)} fires vs a usual ${fmt(NOV_USUAL)} (−${NOV_DROP}%). ` +
    `Also shown: ${OTHERS.map((h) => h.label).join(', ')}.`;

  return (
    <section
      ref={sectionRef}
      className={`sh-section${reduced ? ' is-static' : ''}`}
      aria-labelledby={headlineId}
    >
      <div ref={stageRef} className="sh-stage">
        <div className="sh-copy">
          <div className="sh-main">
            <div className="sh-lines">
              {LINES.slice(0, -1).map((t, i) => (
                <p
                  key={i}
                  className="sh-line"
                  aria-hidden={reduced ? undefined : true}
                  style={vars({ '--a': i === 0 ? -1 : BREAKS[i], '--b': BREAKS[i + 1] })}
                >
                  {t}
                </p>
              ))}
              <h2
                id={headlineId}
                className="sh-line sh-headline"
                style={vars({ '--a': BREAKS[BREAKS.length - 2], '--b': 2 })}
              >
                {LINES[LINES.length - 1]}
              </h2>
            </div>
            <div className="sh-actions" onFocus={onActionsFocus}>
              <a className="sh-btn sh-btn--primary" href="#explore">
                Pick any area
              </a>
              <a className="sh-btn" href="#proof">
                See the data
              </a>
            </div>
          </div>

          <div className="sh-stat">
            <div className="sh-stat-row">
              <span className="sh-stat-num" ref={counterRef}>
                {fmt(reduced ? NOV_NOW : NOV_USUAL)}
              </span>
              <span className="sh-stat-pct">−{NOV_DROP}%</span>
            </div>
            <p className="sh-stat-cap">
              fires, {FEATURE.label} · {MTD_LABEL} {FEATURE.years[FEATURE.years.length - 1].year}
              <br />
              usual for these days: {fmt(NOV_USUAL)}
            </p>
          </div>
        </div>

        <svg
          className={`sh-svg sh-svg--${layout.name}`}
          viewBox={`0 0 ${layout.w} ${layout.h}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={summary}
        >
          <defs>
            <linearGradient id={`${uid}-pre`} x1="0" y1="1" x2="0" y2="0">
              <stop offset="0" stopColor="#5A1F00" />
              <stop offset="1" stopColor="#8F3A0A" />
            </linearGradient>
            <linearGradient id={`${uid}-post`} x1="0" y1="1" x2="0" y2="0">
              <stop offset="0" stopColor="#8F3A0A" />
              <stop offset="0.7" stopColor="#C45A1E" />
              <stop offset="1" stopColor="#E6863F" />
            </linearGradient>
            <linearGradient id={`${uid}-focus`} x1="0" y1="1" x2="0" y2="0">
              <stop offset="0" stopColor="#E6863F" />
              <stop offset="1" stopColor="#FFE3C4" />
            </linearGradient>
            <linearGradient id={`${uid}-sweep`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#FFE3C4" stopOpacity="0" />
              <stop offset="0.5" stopColor="#FFE3C4" stopOpacity="0.5" />
              <stop offset="1" stopColor="#FFE3C4" stopOpacity="0" />
            </linearGradient>
            <radialGradient id={`${uid}-ember`}>
              <stop offset="0" stopColor="#FFE3C4" />
              <stop offset="0.35" stopColor="#F4B37A" stopOpacity="0.9" />
              <stop offset="1" stopColor="#E6863F" stopOpacity="0" />
            </radialGradient>
            <pattern id={`${uid}-hatch`} width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="9" stroke="#E6863F" strokeWidth="2.5" />
            </pattern>
          </defs>

          <g className="sh-sky">
            {stars.map((s, i) => (
              <circle
                key={i}
                className={s.tw ? 'sh-star is-tw' : 'sh-star'}
                cx={s.x}
                cy={s.y}
                r={s.r}
                style={s.tw ? vars({ animationDelay: `${s.delay.toFixed(2)}s` }) : undefined}
              />
            ))}
          </g>

          {/* Others first so the feature chart paints on top while it resizes. */}
          {OTHERS.map((h, j) => (
            <Chart
              key={h.region}
              hero={h}
              geo={geos[j + 1]}
              uid={uid}
              feature={false}
              layout={layout}
              setRef={(el) => {
                chartRefs.current[j + 1] = el;
              }}
            />
          ))}
          <Chart
            hero={FEATURE}
            geo={geos[0]}
            uid={uid}
            feature
            layout={layout}
            setRef={(el) => {
              chartRefs.current[0] = el;
            }}
          />
        </svg>

        <p className="sh-through">{DATA_THROUGH}</p>
        <p className="sh-sr" aria-live="polite" ref={liveRef} />
      </div>
    </section>
  );
}
