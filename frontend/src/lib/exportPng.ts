/**
 * PNG export for the calendar and before/after chart. No dependencies:
 * the calendar is drawn straight onto a canvas from the same data + colour ramp,
 * the Recharts chart is serialised SVG (CSS vars/classes inlined) → Image → canvas.
 */
import type { CalendarRow } from '../api/types';
import { getHeatmapColor, getRampLegendSteps, type ColorScaleType } from './colorRamp';

export const PNG_SCALE = 2;

// Resolved design tokens (canvas and SVG-as-image can't read CSS variables)
const C = {
  bg: '#141625',
  text: '#e8e9f2',
  text2: '#b8bcd0',
  text3: '#8c92a8',
  gold: '#b89c6b',
  border: '#323754',
};
const SERIF = '"Fraunces", Georgia, serif';
const SANS = '"Inter", -apple-system, "Segoe UI", Roboto, sans-serif';
const MONO = '"JetBrains Mono", ui-monospace, Menlo, monospace';

const PAD = 32;

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function footerText(): string {
  return `Prometheus 375 · NASA FIRMS MODIS/VIIRS, harmonized · ${todayIso()}`;
}

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/\(.*?\)/g, '')
      .replace(/&/g, 'and')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'area'
  );
}

export function pngFilename(kind: 'calendar' | 'before-after', area: string, start: string, end: string): string {
  return `prometheus375_${kind}_${slugify(area)}_${start}_${end}.png`;
}

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * PNG_SCALE);
  canvas.height = Math.round(h * PNG_SCALE);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D not supported');
  ctx.scale(PNG_SCALE, PNG_SCALE);
  ctx.fillStyle = C.bg; // solid, never transparent
  ctx.fillRect(0, 0, w, h);
  ctx.textBaseline = 'alphabetic';
  return [canvas, ctx];
}

export async function downloadCanvas(canvas: HTMLCanvasElement, filename: string): Promise<void> {
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
  if (!blob) throw new Error('PNG encoding failed');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function drawHeader(ctx: CanvasRenderingContext2D, title: string, subtitle: string, w: number): number {
  ctx.fillStyle = C.text;
  ctx.font = `500 20px ${SERIF}`;
  ctx.fillText(title, PAD, PAD + 18, w - 2 * PAD);
  ctx.fillStyle = C.gold;
  ctx.font = `12px ${MONO}`;
  ctx.fillText(subtitle, PAD, PAD + 40, w - 2 * PAD);
  return PAD + 58; // y where content starts
}

function drawFooter(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.strokeStyle = C.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD, h - PAD - 18);
  ctx.lineTo(w - PAD, h - PAD - 18);
  ctx.stroke();
  ctx.fillStyle = C.text3;
  ctx.font = `11px ${MONO}`;
  ctx.fillText(footerText(), PAD, h - PAD, w - 2 * PAD);
}

/** Same 45° white stripes as the .hatched-cell CSS (2px on, 2px off). */
function hatch(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 1.4;
  for (let i = -h; i < w + h; i += 4) {
    ctx.beginPath();
    ctx.moveTo(x + i, y + h);
    ctx.lineTo(x + i + h, y);
    ctx.stroke();
  }
  ctx.restore();
}

function dashedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  ctx.save();
  ctx.setLineDash([2, 2]);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.restore();
}

/** Legend row; returns its height. Wraps items onto new lines when narrow. */
function drawLegendItems(
  items: { width: number; draw: (x: number, y: number) => void }[],
  y: number,
  w: number
): number {
  let x = PAD;
  let row = 0;
  const rowH = 22;
  for (const it of items) {
    if (x + it.width > w - PAD && x > PAD) {
      x = PAD;
      row++;
    }
    it.draw(x, y + row * rowH);
    x += it.width + 24;
  }
  return (row + 1) * rowH;
}

function textItem(ctx: CanvasRenderingContext2D, swatchW: number, label: string, drawSwatch: (x: number, y: number) => void) {
  ctx.font = `12px ${SANS}`;
  const tw = ctx.measureText(label).width;
  return {
    width: swatchW + 6 + tw,
    draw: (x: number, y: number) => {
      drawSwatch(x, y);
      ctx.fillStyle = C.text3;
      ctx.font = `12px ${SANS}`;
      ctx.fillText(label, x + swatchW + 6, y + 11);
    },
  };
}

export interface CalendarPngInput {
  data: CalendarRow[];
  colorScale: ColorScaleType;
  areaName: string;
  startMonth: string;
  endMonth: string;
  firstYear: number;
  currentMonth: string;
}

export async function calendarToCanvas(input: CalendarPngInput): Promise<HTMLCanvasElement> {
  await document.fonts?.ready;
  const { data, colorScale, areaName, startMonth, endMonth, firstYear, currentMonth } = input;
  const byMonth = new Map(data.map((r) => [r.month, r]));
  const maxCount = data.reduce((m, r) => Math.max(m, r.count), 0);
  const lastYear = Number(currentMonth.slice(0, 4));
  const years = Array.from({ length: lastYear - firstYear + 1 }, (_, i) => firstYear + i);

  const W = 820;
  const labelW = 44;
  const gap = 3;
  const cellH = 16;
  const cellW = (W - 2 * PAD - labelW - 11 * gap) / 12;
  const gridH = 18 + years.length * (cellH + gap);
  const legendH = 44; // up to two wrapped rows at 820px
  const H = PAD + 58 + gridH + 16 + legendH + 30 + PAD;

  const [canvas, ctx] = makeCanvas(W, H);
  let y = drawHeader(
    ctx,
    `Burning activity calendar — ${areaName}`,
    `${startMonth} → ${endMonth} · monthly fire counts (harmonized to VIIRS 375 m)`,
    W
  );

  // Month header
  ctx.font = `11px ${MONO}`;
  ctx.fillStyle = C.text3;
  ctx.textAlign = 'center';
  'JFMAMJJASOND'.split('').forEach((l, m) => {
    ctx.fillText(l, PAD + labelW + m * (cellW + gap) + cellW / 2, y + 11);
  });
  ctx.textAlign = 'left';
  y += 18;

  for (const year of years) {
    ctx.fillStyle = year === 2012 ? C.text2 : C.text3;
    ctx.font = `11px ${MONO}`;
    ctx.fillText(String(year), PAD, y + 12);
    for (let m = 0; m < 12; m++) {
      const month = `${year}-${String(m + 1).padStart(2, '0')}`;
      if (month > currentMonth) continue;
      const x = PAD + labelW + m * (cellW + gap);
      const row = byMonth.get(month);
      if (!row || month < startMonth || month > endMonth) {
        dashedRect(ctx, x, y, cellW, cellH, 'rgba(255,255,255,0.14)');
        continue;
      }
      ctx.fillStyle = getHeatmapColor(row.count, maxCount, colorScale);
      ctx.fillRect(x, y, cellW, cellH);
      if (row.source === 'modis_converted') hatch(ctx, x, y, cellW, cellH);
      if (month === currentMonth) dashedRect(ctx, x, y, cellW, cellH, C.gold);
    }
    y += cellH + gap;
  }
  y += 16;

  // Legend
  const steps = getRampLegendSteps(colorScale);
  ctx.font = `12px ${SANS}`;
  const fewerW = ctx.measureText('Fewer').width;
  const moreW = ctx.measureText('More').width;
  const rampItem = {
    width: fewerW + 6 + steps.length * 16 + 6 + moreW,
    draw: (x: number, yy: number) => {
      ctx.fillStyle = C.text3;
      ctx.font = `12px ${SANS}`;
      ctx.fillText('Fewer', x, yy + 11);
      steps.forEach((s, i) => {
        ctx.fillStyle = s.color;
        ctx.fillRect(x + fewerW + 6 + i * 16, yy, 14, 14);
      });
      ctx.fillStyle = C.text3;
      ctx.fillText('More', x + fewerW + 6 + steps.length * 16 + 6, yy + 11);
    },
  };
  const hatchItem = textItem(ctx, 14, 'Hatched: estimated from MODIS, 2001–2011', (x, yy) => {
    ctx.fillStyle = steps[3].color;
    ctx.fillRect(x, yy, 14, 14);
    hatch(ctx, x, yy, 14, 14);
  });
  const partialItem = textItem(ctx, 14, 'Dashed gold: month to date', (x, yy) => {
    ctx.fillStyle = steps[2].color;
    ctx.fillRect(x, yy, 14, 14);
    dashedRect(ctx, x, yy, 14, 14, C.gold);
  });
  const noDataItem = textItem(ctx, 14, 'No data', (x, yy) => dashedRect(ctx, x, yy, 14, 14, 'rgba(255,255,255,0.3)'));
  drawLegendItems([rampItem, hatchItem, partialItem, noDataItem], y, W);

  drawFooter(ctx, W, H);
  return canvas;
}

// ---------- SVG (Recharts) export ----------

const SVG_STYLE_PROPS = [
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-dasharray',
  'stroke-opacity',
  'opacity',
  'font-family',
  'font-size',
  'font-weight',
  'text-anchor',
  'dominant-baseline',
  'visibility',
  'display',
];

/** Clone the SVG with every computed style inlined, so var(--…) and classes survive as an <img>. */
function inlineSvg(svg: SVGSVGElement): { markup: string; width: number; height: number } {
  const rect = svg.getBoundingClientRect();
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const src = [svg, ...Array.from(svg.querySelectorAll<SVGElement>('*'))];
  const dst = [clone, ...Array.from(clone.querySelectorAll<SVGElement>('*'))];
  src.forEach((el, i) => {
    const cs = getComputedStyle(el);
    const target = dst[i];
    SVG_STYLE_PROPS.forEach((p) => {
      const v = cs.getPropertyValue(p);
      if (v) target.style.setProperty(p, v);
    });
    // Attributes like fill="var(--color-gold)" are invalid in a standalone image
    ['fill', 'stroke'].forEach((a) => {
      const v = target.getAttribute(a);
      if (v && v.includes('var(')) target.setAttribute(a, cs.getPropertyValue(a));
    });
  });
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(rect.width));
  clone.setAttribute('height', String(rect.height));
  clone.removeAttribute('style');
  return { markup: new XMLSerializer().serializeToString(clone), width: rect.width, height: rect.height };
}

function loadImage(markup: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml;charset=utf-8' }));
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('SVG render failed'));
    };
    img.src = url;
  });
}

export interface BeforeAfterPngInput {
  svg: SVGSVGElement;
  areaName: string;
  startLabel: string;
  endLabel: string;
  note?: string | null;
}

export async function beforeAfterToCanvas(input: BeforeAfterPngInput): Promise<HTMLCanvasElement> {
  await document.fonts?.ready;
  const { markup, width, height } = inlineSvg(input.svg);
  const img = await loadImage(markup);

  // Callers pass a fixed-size SVG, so the PNG layout doesn't depend on the viewport
  const W = Math.round(width) + 2 * PAD;
  const chartW = width;
  const chartH = height;
  const legendH = 44;
  const noteH = input.note ? 20 : 0;
  const H = PAD + 58 + legendH + 8 + chartH + 8 + noteH + 30 + PAD;

  const [canvas, ctx] = makeCanvas(W, H);
  let y = drawHeader(
    ctx,
    `Before / after harmonization — ${input.areaName}`,
    `${input.startLabel} → ${input.endLabel} · raw sensor counts vs harmonized series`,
    W
  );

  const band = textItem(ctx, 22, 'Uncertainty (80% range, MODIS-estimated years)', (x, yy) => {
    ctx.fillStyle = 'rgba(184,156,107,0.28)';
    ctx.fillRect(x, yy + 1, 22, 12);
  });
  const raw = textItem(ctx, 22, 'Raw sensor count (cliff at 2012)', (x, yy) => {
    ctx.save();
    ctx.strokeStyle = '#8a91a6';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(x, yy + 7);
    ctx.lineTo(x + 22, yy + 7);
    ctx.stroke();
    ctx.restore();
  });
  const harm = textItem(ctx, 22, 'Prometheus 375 harmonized', (x, yy) => {
    ctx.strokeStyle = C.gold;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(x, yy + 7);
    ctx.lineTo(x + 22, yy + 7);
    ctx.stroke();
  });
  y += drawLegendItems([harm, raw, band], y, W) + 8;

  ctx.drawImage(img, PAD, y, chartW, chartH);
  y += chartH + 8;

  if (input.note) {
    ctx.fillStyle = C.text3;
    ctx.font = `11px ${SANS}`;
    ctx.fillText(input.note, PAD, y + 12, W - 2 * PAD);
  }

  drawFooter(ctx, W, H);
  return canvas;
}
