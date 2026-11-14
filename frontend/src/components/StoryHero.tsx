/**
 * StoryHero: a 900vh scroll-scrubbed hero. A sticky 100vh stage shows one SVG whose state is a
 * pure function of a damped scroll progress p (0..1), remapped by beatProgress() into 6 beats
 * (eased transition, then a still hold where that beat's line reads). A passive scroll listener
 * kicks a rAF loop (it stops once p settles) that writes CSS
 * custom properties (--p on the stage, a few per-chart vars on each chart <g>); all motion is
 * CSS calc() on transform / opacity (plus stroke-dashoffset for the drawn lines). React renders
 * once per layout (wide / narrow), never per scroll frame.
 *
 * Every number comes from src/mocks/hero_*.json (pipeline/export_hero_mocks.py).
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react';
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

// ------------------------------------------------------------------------------- timing
// Tune the story here. BEATS are the 6 beat boundaries in scroll progress (0..1). Inside each
// beat the first MOVE share is the (eased) transition; the rest is a hold where nothing moves
// and that beat's line is readable. The line fades in over the first FADE_IN of the hold and
// out over the last FADE_OUT, so text never swaps mid-motion.
const BEATS = [0, 0.15, 0.3, 0.45, 0.65, 0.85, 1] as const;
const MOVE = 0.6;
const FADE_IN = 0.15;
const FADE_OUT = 0.1;
// Scroll damping: per-60Hz-frame approach rate, max per-frame step, and the settle threshold.
const DAMP = 0.08;
const MAX_STEP = 0.012;
const SETTLE = 0.0005;
const FRAME_MS = 1000 / 60;

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

// --------------------------------------------------------------------------- backdrop
// Decorative only (aria-hidden, pointer-events: none), painted under the copy and the chart.
// Coordinates live in a per-layout box drawn with preserveAspectRatio="xMidYMid slice".

interface BgOrbit {
  key: 'terra' | 'aqua' | 'snpp' | 'noaa';
  d: string; // open arc that enters and leaves off-screen, so the loop is seamless
  dur: number; // s per pass
  sats: { name: string; vis: string; begin: number }[]; // vis = CSS custom property gating it
}
interface BgGeo {
  w: number;
  h: number;
  font: number;
  orbits: BgOrbit[];
  grid: { x0: number; y0: number; x1: number; y1: number; step: number; fade: [number, number, number, number] };
  ticks: { x: number; y: number; text: string; anchor: 'start' | 'end' }[];
  planets: { x: number; y: number; r: number; near: boolean }[];
  embers: { x0: number; x1: number; y: number; rise: number };
}

const SAT_VIS = { all: '1', snpp: 'var(--bg-snpp, 0)', n20: 'var(--bg-n20, 0)', n21: 'var(--bg-n21, 0)' };

const BG_WIDE: BgGeo = {
  w: 1600,
  h: 900,
  font: 11,
  orbits: [
    { key: 'terra', d: 'M1180 -40 A700 380 -20 0 0 1660 330', dur: 34, sats: [{ name: 'Terra', vis: SAT_VIS.all, begin: -6 }] },
    { key: 'aqua', d: 'M-60 560 A620 340 15 0 1 520 940', dur: 30, sats: [{ name: 'Aqua', vis: SAT_VIS.all, begin: -19 }] },
    { key: 'snpp', d: 'M900 -40 A900 520 -20 0 0 1660 540', dur: 46, sats: [{ name: 'S-NPP', vis: SAT_VIS.snpp, begin: -28 }] },
    {
      key: 'noaa',
      d: 'M1040 940 A720 380 10 0 1 1660 560',
      dur: 40,
      sats: [
        { name: 'NOAA-20', vis: SAT_VIS.n20, begin: -8 },
        { name: 'NOAA-21', vis: SAT_VIS.n21, begin: -28 },
      ],
    },
  ],
  // 0.25° graticule on the right (text sits left); fades in from x 820 to 1160.
  grid: { x0: 820, y0: 0, x1: 1600, y1: 900, step: 44, fade: [820, 0, 1160, 0] },
  ticks: [
    { x: 820 + 13 * 44 - 6, y: 4 * 44 - 6, text: '31.0°N', anchor: 'end' },
    { x: 820 + 13 * 44 - 6, y: 8 * 44 - 6, text: '30.0°N', anchor: 'end' },
    { x: 820 + 8 * 44 + 6, y: 15 * 44 - 6, text: '75.0°E', anchor: 'start' },
  ],
  planets: [
    { x: 1310, y: 540, r: 30, near: false }, // right of the chart, clear of the stat block
    { x: 150, y: 780, r: 22, near: true },
  ],
  embers: { x0: 330, x1: 1270, y: 830, rise: 320 },
};

const BG_NARROW: BgGeo = {
  w: 400,
  h: 860,
  font: 9,
  orbits: [
    { key: 'terra', d: 'M250 -30 A300 200 -20 0 0 430 180', dur: 30, sats: [{ name: 'Terra', vis: SAT_VIS.all, begin: -6 }] },
    { key: 'aqua', d: 'M-30 660 A260 200 15 0 1 190 890', dur: 26, sats: [{ name: 'Aqua', vis: SAT_VIS.all, begin: -15 }] },
    { key: 'snpp', d: 'M140 -30 A380 260 -20 0 0 430 300', dur: 38, sats: [{ name: 'S-NPP', vis: SAT_VIS.snpp, begin: -20 }] },
    {
      key: 'noaa',
      d: 'M250 890 A300 200 10 0 1 430 650',
      dur: 30,
      sats: [
        { name: 'NOAA-20', vis: SAT_VIS.n20, begin: -4 },
        { name: 'NOAA-21', vis: SAT_VIS.n21, begin: -19 },
      ],
    },
  ],
  // Text is on top and the chart fills the middle, so the graticule lives in the strip below
  // the chart and fades in going down; tick labels stay clear of the chart and the rail.
  grid: { x0: 0, y0: 440, x1: 400, y1: 860, step: 28, fade: [0, 440, 0, 640] },
  ticks: [
    { x: 6, y: 440 + 9 * 28 - 4, text: '31.0°N', anchor: 'start' },
    { x: 6, y: 440 + 13 * 28 - 4, text: '30.0°N', anchor: 'start' },
    { x: 8 * 28 + 4, y: 440 + 12 * 28 - 4, text: '75.0°E', anchor: 'start' },
  ],
  planets: [
    { x: 340, y: 250, r: 18, near: false },
    { x: 40, y: 600, r: 14, near: true },
  ],
  embers: { x0: 30, x1: 370, y: 670, rise: 240 },
};

interface BgStar {
  x: number;
  y: number;
  r: number;
  o: number;
  warm: boolean;
  tw: boolean;
  delay: number;
}
interface BgEmber {
  x: number;
  r: number;
  dx: number;
  dur: number;
  delay: number;
}

function makeBackdrop(g: BgGeo, small: boolean) {
  const rand = rng(g.w * 7 + (small ? 1 : 0));
  const H = g.h + 90; // star layers are taller than the stage so parallax never runs dry
  const star = (near: boolean): BgStar => ({
    x: rand() * g.w,
    y: rand() * H,
    r: near ? 0.8 + rand() * 0.7 : 0.5 + rand() * 0.5, // ~1–2 px rendered
    o: near ? 0.15 + rand() * 0.2 : 0.08 + rand() * 0.12,
    warm: rand() < 0.1, // ≤10% get a faint amber tint
    tw: rand() < 0.15,
    delay: rand() * 6,
  });
  const total = small ? 70 : 120;
  const far = Array.from({ length: Math.round(total * 0.6) }, () => star(false));
  const near = Array.from({ length: total - far.length }, () => star(true));
  const embers: BgEmber[] = Array.from({ length: small ? 14 : 26 }, () => ({
    x: g.embers.x0 + rand() * (g.embers.x1 - g.embers.x0),
    r: 0.9 + rand() * 1.3,
    dx: (rand() - 0.5) * 60,
    dur: 6 + rand() * 6,
    delay: -rand() * 12,
  }));
  return { H, far, near, embers };
}

/** 4-point sparkle like the logo's, centred on 0,0. */
const sparkle = (s: number) =>
  `M0 ${-s}Q${s * 0.12} ${-s * 0.12} ${s} 0Q${s * 0.12} ${s * 0.12} 0 ${s}Q${-s * 0.12} ${s * 0.12} ${-s} 0Q${-s * 0.12} ${-s * 0.12} 0 ${-s}Z`;

interface BackdropProps {
  uid: string;
  narrow: boolean;
  small: boolean;
  reduced: boolean;
}

function StoryBackdrop({ uid, narrow, small, reduced }: BackdropProps) {
  const g = narrow ? BG_NARROW : BG_WIDE;
  const bd = useMemo(() => makeBackdrop(g, small), [g, small]);
  const id = (s: string) => `${uid}-bg-${s}`;

  const starLayer = (near: boolean) => (
    <div className={`sh-bg-layer ${near ? 'is-near' : 'is-far'}`}>
      <svg viewBox={`0 0 ${g.w} ${bd.H}`} preserveAspectRatio="xMidYMin slice">
        {(near ? bd.near : bd.far).map((s, i) => (
          <circle
            key={i}
            className={s.tw && !reduced ? 'sh-bg-star is-tw' : 'sh-bg-star'}
            cx={s.x.toFixed(1)}
            cy={s.y.toFixed(1)}
            r={s.r.toFixed(2)}
            fill={s.warm ? '#FBCB9A' : '#C9CCD8'}
            style={vars({ '--so': s.o.toFixed(3), animationDelay: `${(-s.delay).toFixed(2)}s` })}
          />
        ))}
        {g.planets
          .filter((pl) => pl.near === near)
          .map((pl, i) => (
            <g key={`pl${i}`} transform={`translate(${pl.x} ${pl.y})`}>
              <circle r={pl.r} fill={`url(#${id(near ? 'glow-n' : 'glow-f')})`} />
              <path d={sparkle(pl.r * 0.42)} fill="#F4B37A" opacity="0.22" />
            </g>
          ))}
        <defs>
          <radialGradient id={id(near ? 'glow-n' : 'glow-f')}>
            {/* Warm amber haze, peak 0.12: keeps #B89C6B labels ≥ 4.5:1 where it sits under them. */}
            <stop offset="0" stopColor="#E6863F" stopOpacity="0.12" />
            <stop offset="1" stopColor="#E6863F" stopOpacity="0" />
          </radialGradient>
        </defs>
      </svg>
    </div>
  );

  const { grid } = g;
  const vLines: number[] = [];
  for (let x = grid.x0; x <= grid.x1; x += grid.step) vLines.push(x);
  const hLines: number[] = [];
  for (let y = grid.y0; y <= grid.y1; y += grid.step) hLines.push(y);

  return (
    <div className="sh-bg" aria-hidden="true">
      {starLayer(false)}
      {starLayer(true)}
      <svg className="sh-bg-main" viewBox={`0 0 ${g.w} ${g.h}`} preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient
            id={id('gridfade')}
            gradientUnits="userSpaceOnUse"
            x1={grid.fade[0]}
            y1={grid.fade[1]}
            x2={grid.fade[2]}
            y2={grid.fade[3]}
          >
            <stop offset="0" stopColor="#fff" stopOpacity="0" />
            <stop offset="1" stopColor="#fff" stopOpacity="1" />
          </linearGradient>
          <mask id={id('gridmask')} maskUnits="userSpaceOnUse" x="0" y="0" width={g.w} height={g.h}>
            <rect x="0" y="0" width={g.w} height={g.h} fill={`url(#${id('gridfade')})`} />
          </mask>
          <radialGradient id={id('satglow')}>
            <stop offset="0" stopColor="#E6863F" stopOpacity="0.9" />
            <stop offset="1" stopColor="#E6863F" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={id('ember')}>
            <stop offset="0" stopColor="#F4B37A" />
            <stop offset="0.45" stopColor="#F4B37A" />
            <stop offset="1" stopColor="#E6863F" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* 4. graticule */}
        <g className="sh-bg-grid" mask={`url(#${id('gridmask')})`}>
          {vLines.map((x) => (
            <line key={`v${x}`} x1={x} x2={x} y1={grid.y0} y2={grid.y1} />
          ))}
          {hLines.map((y) => (
            <line key={`h${y}`} x1={grid.x0} x2={grid.x1} y1={y} y2={y} />
          ))}
        </g>
        {!reduced && (
          <g className="sh-bg-ticks" fontSize={g.font}>
            {g.ticks.map((t) => (
              <text key={t.text} x={t.x} y={t.y} textAnchor={t.anchor}>
                {t.text}
              </text>
            ))}
          </g>
        )}

        {!reduced && (
          <>
            {/* 2. satellite tracks */}
            {g.orbits.map((o) => (
              <g key={o.key} className={`sh-bg-orbit is-${o.key}`}>
                <path className="sh-bg-track" d={o.d} />
                {o.sats.map((s) => (
                  <g key={s.name} className="sh-bg-sat" style={vars({ '--vis': s.vis })}>
                    <animateMotion dur={`${o.dur}s`} begin={`${s.begin}s`} repeatCount="indefinite" path={o.d} />
                    <circle r={g.font * 0.55} fill={`url(#${id('satglow')})`} className="sh-bg-sat-glow" />
                    <circle r={g.font * 0.2} className="sh-bg-sat-core" />
                    {o.key === 'snpp' && <circle r={g.font * 0.2} className="sh-bg-sat-dead" />}
                    <text className="sh-bg-sat-lab" x={g.font * 0.8} y={-g.font * 0.6} fontSize={g.font}>
                      {s.name}
                    </text>
                    {o.key === 'snpp' && (
                      <text className="sh-bg-sat-ret" x={g.font * 0.8} y={g.font * 0.6} fontSize={g.font}>
                        retired
                      </text>
                    )}
                  </g>
                ))}
              </g>
            ))}

            {/* 5. embers rising off the chart baseline; the wrapper gates density by beat */}
            <g className="sh-bg-embers">
              {bd.embers.map((e, i) => (
                <g
                  key={i}
                  className="sh-bg-emw"
                  style={vars({ '--t': (i / bd.embers.length).toFixed(3), '--q': bd.embers.length })}
                >
                  <circle
                    className="sh-bg-ember"
                    cx={e.x.toFixed(1)}
                    cy={g.embers.y}
                    r={(e.r * 1.8).toFixed(2)}
                    fill={`url(#${id('ember')})`}
                    style={vars({
                      '--dx': `${e.dx.toFixed(1)}px`,
                      '--rise': `${-g.embers.rise}px`,
                      animationDuration: `${e.dur.toFixed(2)}s`,
                      animationDelay: `${e.delay.toFixed(2)}s`,
                    })}
                  />
                </g>
              ))}
            </g>
          </>
        )}
      </svg>
    </div>
  );
}

// --------------------------------------------------------------------------- scroll math

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Height of the app's sticky NavBar (--nav-height, set by App); 0 when there is none. */
const navHeight = (el: Element) => parseFloat(getComputedStyle(el).getPropertyValue('--nav-height')) || 0;
const seg = (v: number, a: number, b: number) => clamp01((v - a) / (b - a));
const ease = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

const BEAT_COUNT = BEATS.length - 1;
const holdStart = (i: number) => BEATS[i] + MOVE * (BEATS[i + 1] - BEATS[i]);
/** First p at which beat i's line is fully readable (hold start + fade-in). */
const readableAt = (i: number) => {
  const h0 = holdStart(i);
  return i === 0 ? h0 : h0 + FADE_IN * (BEATS[i + 1] - h0);
};

interface BeatState {
  /** Per-beat eased transition progress: 0 before the beat, 1 from its hold onward. */
  s: number[];
  /** Index of the beat containing p. */
  beat: number;
  /** Per-beat line opacity (0..1). */
  text: number[];
}

/** The whole scroll→story remap: p (damped scroll progress) → per-beat motion + text. */
function beatProgress(p: number): BeatState {
  const s: number[] = [];
  const text: number[] = [];
  let beat = 0;
  for (let i = 0; i < BEAT_COUNT; i++) {
    const a = BEATS[i];
    const b = BEATS[i + 1];
    const h0 = holdStart(i);
    const hold = b - h0;
    if (p >= a) beat = i;
    s.push(easeInOutCubic(seg(p, a, h0)));
    // Line 0 is up from the start (nothing precedes it); the last line never fades out.
    const fadeIn = i === 0 ? 1 : seg(p, h0, h0 + FADE_IN * hold);
    const fadeOut = i === BEAT_COUNT - 1 ? 1 : 1 - seg(p, b - FADE_OUT * hold, b);
    text.push(Math.min(fadeIn, fadeOut));
  }
  return { s, beat: Math.min(beat, BEAT_COUNT - 1), text };
}

const NARROW_Q = '(max-width: 640px)';
const SMALL_Q = '(max-width: 900px)'; // fewer backdrop particles
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
  const small = useMedia(SMALL_Q);
  const layout = narrow ? NARROW : WIDE;

  const geos = useMemo(() => HEROES.map((h, i) => buildGeo(h, 375 + i * 31, i === 0)), []);

  const sectionRef = useRef<HTMLElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const chartRefs = useRef<(SVGGElement | null)[]>([]);
  const counterRef = useRef<HTMLSpanElement | null>(null);
  const liveRef = useRef<HTMLParagraphElement | null>(null);
  const lineRefs = useRef<(HTMLElement | null)[]>([]);
  const dotRefs = useRef<(HTMLButtonElement | null)[]>([]);

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
    let curBeat = -1;

    const g0 = geos[0];
    const render = (p: number, inView: boolean) => {
      setVar(stage, '--p', p);
      const { s, beat, text } = beatProgress(p);
      const [s1, s2, s3, s4, s5, s6] = s;

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

      // Backdrop: satellites join with their beats (S-NPP at the 2012 crack, NOAA-20 with the
      // fix, NOAA-21 with "anywhere"); S-NPP retires in the last beat. Embers are densest
      // through crack + fix and nearly gone by 2026 (the quiet season). Grid tick labels show
      // in the Punjab + Haryana beats (full-size chart), and clear out before the stat lands.
      setVar(stage, '--bg-snpp', s2);
      setVar(stage, '--bg-n20', s3);
      setVar(stage, '--bg-n21', s4);
      setVar(stage, '--bg-retire', s6);
      setVar(stage, '--bg-ember', clamp01(0.35 + 0.65 * s2 - 0.5 * s4 - 0.45 * s5));
      setVar(stage, '--bg-tick', (1 - m) * (1 - seg(s5, 0, 0.15)));

      setVar(stage, '--stat', seg(s5, 0.15, 0.3));
      // Beat 6's motion: the "−N%" locks in, then the headline + buttons arrive in its hold.
      setVar(stage, '--lock', s6);
      const v = Math.round(lerp(NOV_USUAL, NOV_NOW, sink));
      if (v !== counterVal && counterRef.current) {
        counterVal = v;
        counterRef.current.textContent = fmt(v);
      }

      const last = BEAT_COUNT - 1;
      for (let i = 0; i < BEAT_COUNT; i++) setVar(lineRefs.current[i], '--lo', text[i]);
      setVar(stage, '--ao', text[last]);
      const act = text[last] > 0.5 ? '1' : '0';
      if (act !== active) {
        active = act;
        stage.dataset.active = act;
      }

      if (beat !== curBeat) {
        curBeat = beat;
        dotRefs.current.forEach((d, i) => {
          if (!d) return;
          if (i === beat) d.setAttribute('aria-current', 'step');
          else d.removeAttribute('aria-current');
        });
      }

      const shown = text.findIndex((o) => o > 0.5);
      if (inView && shown >= 0 && !announced.has(shown) && liveRef.current) {
        announced.add(shown);
        liveRef.current.textContent = LINES[shown];
      }
    };

    if (reduced) {
      render(1, false);
      return;
    }

    // pRaw is where the scrollbar is; pDisp chases it (damped + speed-capped) and drives
    // render(). The rAF loop runs only while they differ, and restarts on scroll/resize.
    let pRaw = 0;
    let pDisp = 0;
    let inView = false;
    let raf = 0;
    let last = 0;
    const measure = () => {
      const rect = section.getBoundingClientRect();
      const nav = navHeight(section);
      const vh = window.innerHeight - nav; // the stage sticks just below the NavBar
      pRaw = clamp01((nav - rect.top) / Math.max(1, rect.height - vh));
      inView = rect.bottom > nav && rect.top < window.innerHeight;
    };
    const tick = (now: number) => {
      measure();
      const f = Math.min(last ? now - last : FRAME_MS, 4 * FRAME_MS) / FRAME_MS;
      last = now;
      const d = pRaw - pDisp;
      if (Math.abs(d) < SETTLE) {
        pDisp = pRaw;
        render(pDisp, inView);
        raf = 0;
        last = 0;
        return;
      }
      const cap = MAX_STEP * f;
      const step = d * (1 - Math.pow(1 - DAMP, f));
      pDisp += step > cap ? cap : step < -cap ? -cap : step;
      render(pDisp, inView);
      raf = requestAnimationFrame(tick);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(tick);
    };
    measure();
    pDisp = pRaw; // no catch-up animation on load or after a layout switch
    render(pDisp, inView);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [reduced, layout, geos]);

  /** Absolute scrollY at which scroll progress equals p. */
  const scrollYAt = (p: number) => {
    const section = sectionRef.current;
    if (!section) return null;
    const rect = section.getBoundingClientRect();
    const nav = navHeight(section);
    return window.scrollY + rect.top - nav + Math.max(0, rect.height - (window.innerHeight - nav)) * p;
  };
  // 'instant', not 'auto': global.css sets html { scroll-behavior: smooth }, which 'auto' obeys.
  const behavior: ScrollBehavior = reduced ? 'instant' : 'smooth';

  // Rail: land where the beat's hold is settled and its line fully faded in.
  const goToBeat = (i: number) => {
    const top = scrollYAt(readableAt(i));
    if (top !== null) window.scrollTo({ top, behavior });
  };

  /** Scroll a section to just below the sticky NavBar and move focus there. */
  const jumpTo = (id: string) => {
    const target = document.getElementById(id);
    if (!target) return false;
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    // Layout position (offsetTop ignores transforms): sections wrapped in <Reveal> start
    // translated 14px down and slide up as they appear, which would skew a rect-based target.
    let docTop = 0;
    for (let el: HTMLElement | null = target; el; el = el.offsetParent as HTMLElement | null) docTop += el.offsetTop;
    const top = docTop - navHeight(target);
    window.scrollTo({ top, behavior });
    target.focus({ preventScroll: true });
    return true;
  };
  const onJumpClick = (e: ReactMouseEvent<HTMLAnchorElement>) => {
    const id = e.currentTarget.hash.slice(1);
    if (id && jumpTo(id)) {
      e.preventDefault();
      history.replaceState(null, '', `#${id}`);
    }
  };

  const skipIntro = () => {
    if (jumpTo('explore')) return;
    const top = scrollYAt(1);
    if (top !== null) window.scrollTo({ top: top + window.innerHeight, behavior });
  };

  // Keyboard users tabbing to the buttons jump to the settled state.
  const onActionsFocus = () => {
    if (reduced) return;
    const section = sectionRef.current;
    if (!section) return;
    const rect = section.getBoundingClientRect();
    const nav = navHeight(section);
    const span = rect.height - (window.innerHeight - nav);
    const target = readableAt(BEAT_COUNT - 1);
    if ((nav - rect.top) / span < target) {
      window.scrollTo({ top: window.scrollY + rect.top - nav + span * target, behavior: 'instant' });
    }
  };

  const headlineId = `${uid}-headline`;
  const summary =
    `Yearly fire detections in ${FEATURE.label}, ${FEATURE.years[0].year}–${FEATURE.years[FEATURE.years.length - 1].year}. ` +
    `Raw counts jump in ${geos[0].crackYear} when a new satellite joins; the harmonized series stays continuous. ` +
    `${MTD_LABEL} ${FEATURE.years[FEATURE.years.length - 1].year}: ${fmt(NOV_NOW)} fires vs a usual ${fmt(NOV_USUAL)} (−${NOV_DROP}%). ` +
    `Also shown: ${OTHERS.map((h) => h.label).join(', ')}.`;

  return (
    <section
      id="top"
      ref={sectionRef}
      className={`sh-section${reduced ? ' is-static' : ''}`}
      aria-labelledby={headlineId}
    >
      <div ref={stageRef} className="sh-stage">
        <StoryBackdrop uid={uid} narrow={narrow} small={small} reduced={reduced} />
        <div className="sh-copy">
          <div className="sh-main">
            <div className="sh-lines">
              {LINES.slice(0, -1).map((t, i) => (
                <p
                  key={i}
                  className="sh-line"
                  aria-hidden={reduced ? undefined : true}
                  ref={(el) => {
                    lineRefs.current[i] = el;
                  }}
                >
                  {t}
                </p>
              ))}
              <h2
                id={headlineId}
                className="sh-line sh-headline"
                ref={(el) => {
                  lineRefs.current[LINES.length - 1] = el;
                }}
              >
                {LINES[LINES.length - 1]}
              </h2>
            </div>
            <div className="sh-actions" onFocus={onActionsFocus}>
              <a className="sh-btn sh-btn--primary" href="#explore" onClick={onJumpClick}>
                Pick any area
              </a>
              <a className="sh-btn" href="#proof" onClick={onJumpClick}>
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
              <stop offset="0" stopColor="#F4B37A" />
              <stop offset="0.35" stopColor="#F4B37A" stopOpacity="0.9" />
              <stop offset="1" stopColor="#E6863F" stopOpacity="0" />
            </radialGradient>
            <pattern id={`${uid}-hatch`} width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="9" stroke="#E6863F" strokeWidth="2.5" />
            </pattern>
          </defs>

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

        <button type="button" className="sh-skip" onClick={skipIntro}>
          Skip intro <span aria-hidden="true">↓</span>
        </button>

        {!reduced && (
          <nav className="sh-rail" aria-label="Story steps">
            {LINES.map((t, i) => (
              <button
                key={i}
                type="button"
                className="sh-dot"
                aria-label={`Step ${i + 1} of ${LINES.length}: ${t}`}
                onClick={() => goToBeat(i)}
                ref={(el) => {
                  dotRefs.current[i] = el;
                }}
              />
            ))}
          </nav>
        )}

        <p className="sh-through">{DATA_THROUGH}</p>
        <p className="sh-sr" aria-live="polite" ref={liveRef} />
      </div>
    </section>
  );
}
