// SVG export [user]: true millimetres, Y flipped, one named group per layer, real curve commands.
import type { Curve, Design, Dimension, Layer, Sketch, TextEntity, Vec2 } from '../model/types';
import { getPointPos } from '../model/document';
import { ownerLayer, pointLayer } from '../model/layers';
import { boundingBox, resolve, type ParamCurve } from '../geom/curves';
import { boxAdd, emptyBox, TAU, type Box } from '../geom/vec';
import { View } from '../app/view';
import { layoutDimension } from '../render/dimensions';
import { textContours, type Contour } from './text';
import { dataMarkup } from './svg-data';

/** Splines and conics stay within this of the true curve, in mm. A cubic span comes out exact. */
export const SVG_TOLERANCE = 0.01;
/** Clear space round the geometry, so a stroke is not cut by the edge of the sheet. */
export const SVG_MARGIN = 1;
export const SVG_STROKE = 0.25;
/** Screen dashes, as lengths on paper. */
export const SVG_DASH: Record<'construction' | 'centerline', string> = { construction: '2.1 1.5', centerline: '4.2 1.2 0.9 1.2' };
const DIM_STROKE = 0.13;
const DIM_TEXT = 3;
const POINT_R = 0.4;
/** Pixels per mm for a dimension's screen-sized parts: arrows, gaps. */
const DIM_PPM = 4;
const MAX_DEPTH = 9;
const MAX_CUBICS = 512;
const CHECKS = [0.125, 0.25, 0.375, 0.625, 0.75, 0.875];

export interface SvgOptions {
  /** Explicit sketch points. */
  points?: boolean;
  projected?: boolean;
  construction?: boolean;
  /** Centerlines. On unless turned off, as for DXF: an axis is part of the drawing. */
  centerlines?: boolean;
  /** Dimension lines and values. Constraint glyphs are never exported. */
  dimensions?: boolean;
  tolerance?: number;
  /** The whole design in <metadata>, so the file opens again as a drawing. Not drawn: what shows is the same either way. */
  data?: boolean;
}

export interface LayerGroup { layer: Layer; id: string; body: string }

/** Everything drawn. `box` is in sketch mm, Y up; the group bodies are in SVG space, Y negated. */
export interface Sheet {
  box: Box;
  groups: LayerGroup[];
}

const num = (v: number): string => {
  const s = v.toFixed(4).replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
};
const xy = (p: Vec2): string => `${num(p.x)} ${num(-p.y)}`;
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface Cubic { a: Vec2; c1: Vec2; c2: Vec2; b: Vec2 }

/** The cubic through four evenly spaced samples. A cubic polynomial comes back exactly. */
function cubicThrough(pc: ParamCurve, t0: number, t1: number): Cubic {
  const a = pc.at(t0);
  const p = pc.at(t0 + (t1 - t0) / 3);
  const q = pc.at(t0 + (2 * (t1 - t0)) / 3);
  const b = pc.at(t1);
  return {
    a, b,
    c1: { x: (-5 * a.x + 18 * p.x - 9 * q.x + 2 * b.x) / 6, y: (-5 * a.y + 18 * p.y - 9 * q.y + 2 * b.y) / 6 },
    c2: { x: (2 * a.x - 9 * p.x + 18 * q.x - 5 * b.x) / 6, y: (2 * a.y - 9 * p.y + 18 * q.y - 5 * b.y) / 6 },
  };
}

export function cubicAt(c: Cubic, s: number): Vec2 {
  const r = 1 - s;
  const [w0, w1, w2, w3] = [r * r * r, 3 * r * r * s, 3 * r * s * s, s * s * s];
  return { x: w0 * c.a.x + w1 * c.c1.x + w2 * c.c2.x + w3 * c.b.x, y: w0 * c.a.y + w1 * c.c1.y + w2 * c.c2.y + w3 * c.b.y };
}

function fit(pc: ParamCurve, t0: number, t1: number, tol: number, depth: number, out: Cubic[]): boolean {
  const c = cubicThrough(pc, t0, t1);
  const miss = Math.max(...CHECKS.map((s) => {
    const p = pc.at(t0 + (t1 - t0) * s);
    const q = cubicAt(c, s);
    return Math.hypot(p.x - q.x, p.y - q.y);
  }));
  if (miss <= tol) {
    out.push(c);
    return out.length <= MAX_CUBICS;
  }
  if (depth >= MAX_DEPTH) return false;
  const mid = (t0 + t1) / 2;
  return fit(pc, t0, mid, tol, depth + 1, out) && fit(pc, mid, t1, tol, depth + 1, out);
}

/** Cubic Béziers for a curve within `tol`, split at its polynomial joins. Null when it will not converge. */
export function cubicsOf(pc: ParamCurve, tol: number): Cubic[] | null {
  const breaks = pc.shape.kind === 'spline' && pc.shape.breaks?.length ? pc.shape.breaks : [0, 1];
  const out: Cubic[] = [];
  for (let i = 0; i + 1 < breaks.length; i++) {
    if (!fit(pc, breaks[i], breaks[i + 1], tol, 0, out)) return null;
  }
  return out;
}

const cubicPath = (cubics: Cubic[], closed: boolean): string =>
  `M${xy(cubics[0].a)}${cubics.map((c) => ` C${xy(c.c1)} ${xy(c.c2)} ${xy(c.b)}`).join('')}${closed ? ' Z' : ''}`;

/** Sampled in steps short enough for `tol`: the fallback for a curve no few cubics fit. */
function polylinePath(pc: ParamCurve, tol: number): string {
  const steps = Math.min(2048, Math.ceil(1 / Math.sqrt(tol)) * 64);
  const pts = Array.from({ length: steps + 1 }, (_, i) => pc.at(i / steps));
  return `M${pts.map(xy).join(' L')}`;
}

const degrees = (r: number): number => (r * 180) / Math.PI;

/** One curve as an element. `attrs` carries its dash. */
function curveElement(pc: ParamCurve, attrs: string, tol: number): string {
  const s = pc.shape;
  if (s.kind === 'line') {
    return `<line x1="${num(s.a.x)}" y1="${num(-s.a.y)}" x2="${num(s.b.x)}" y2="${num(-s.b.y)}"${attrs}/>`;
  }
  if (s.kind === 'arc') {
    if (pc.closed || Math.abs(s.sweep) >= TAU - 1e-9) return `<circle cx="${num(s.c.x)}" cy="${num(-s.c.y)}" r="${num(s.r)}"${attrs}/>`;
    // Counter-clockwise with Y up stays so on screen, which is SVG's sweep flag 0.
    const large = Math.abs(s.sweep) > Math.PI ? 1 : 0;
    const sweep = s.sweep > 0 ? 0 : 1;
    return `<path d="M${xy(pc.at(0))} A${num(s.r)} ${num(s.r)} 0 ${large} ${sweep} ${xy(pc.at(1))}"${attrs}/>`;
  }
  if (s.kind === 'ellipse') {
    const rot = num(-degrees(s.rot));
    if (pc.closed || Math.abs(s.sweep) >= TAU - 1e-9) {
      return `<ellipse cx="${num(s.c.x)}" cy="${num(-s.c.y)}" rx="${num(s.rx)}" ry="${num(s.ry)}" transform="rotate(${rot} ${num(s.c.x)} ${num(-s.c.y)})"${attrs}/>`;
    }
    const large = Math.abs(s.sweep) > Math.PI ? 1 : 0;
    const sweep = s.sweep > 0 ? 0 : 1;
    return `<path d="M${xy(pc.at(0))} A${num(s.rx)} ${num(s.ry)} ${rot} ${large} ${sweep} ${xy(pc.at(1))}"${attrs}/>`;
  }
  const cubics = cubicsOf(pc, tol);
  return `<path d="${cubics ? cubicPath(cubics, pc.closed) : polylinePath(pc, tol)}"${attrs}/>`;
}

function contourPath(contours: Contour[]): string {
  return contours.filter((c) => c.length).map((c) => {
    const segs = c.map((s) => (s.kind === 'L' ? ` L${xy(s.b)}` : ` C${xy(s.c1)} ${xy(s.c2)} ${xy(s.b)}`));
    return `M${xy(c[0].a)}${segs.join('')} Z`;
  }).join(' ');
}

function textElement(design: Design, sketch: Sketch, c: TextEntity, color: string, box: Box): string {
  const contours = textContours(c, sketch, { design });
  for (const contour of contours) {
    for (const s of contour) {
      boxAdd(box, s.a);
      boxAdd(box, s.b);
    }
  }
  return contours.length ? `<path d="${contourPath(contours)}" fill="${color}" stroke="none" fill-rule="nonzero"/>` : '';
}

function dimensionElements(design: Design, sketch: Sketch, d: Dimension, color: string, box: Box): string {
  const view = new View();
  view.ppm = DIM_PPM;
  const l = layoutDimension(design, sketch, d, view);
  if (!l) return '';
  const out: string[] = [];
  const add = (a: Vec2, b: Vec2): void => {
    boxAdd(box, a);
    boxAdd(box, b);
    out.push(`<line x1="${num(a.x)}" y1="${num(-a.y)}" x2="${num(b.x)}" y2="${num(-b.y)}"/>`);
  };
  for (const [a, b] of [...l.extensions, ...l.lines]) add(a, b);
  for (const a of l.arcs) {
    const steps = Math.max(2, Math.ceil(Math.abs(a.sweep) / 0.15));
    const at = (i: number): Vec2 => {
      const t = a.start + (a.sweep * i) / steps;
      return { x: a.c.x + a.r * Math.cos(t), y: a.c.y + a.r * Math.sin(t) };
    };
    for (let i = 0; i < steps; i++) add(at(i), at(i + 1));
  }
  const size = 1.6;
  for (const { at, dir } of l.arrows) {
    const back = { x: -dir.x * size, y: -dir.y * size };
    const side = { x: -dir.y * size * 0.3, y: dir.x * size * 0.3 };
    add(at, { x: at.x + back.x + side.x, y: at.y + back.y + side.y });
    add(at, { x: at.x + back.x - side.x, y: at.y + back.y - side.y });
  }
  const half = (l.text.length * DIM_TEXT * 0.3);
  boxAdd(box, { x: l.label.x - half, y: l.label.y - DIM_TEXT });
  boxAdd(box, { x: l.label.x + half, y: l.label.y + DIM_TEXT });
  const text = `<text x="${num(l.label.x)}" y="${num(-l.label.y)}" font-family="Inter, Helvetica, Arial, sans-serif" font-size="${DIM_TEXT}" text-anchor="middle" dominant-baseline="middle" fill="${color}" stroke="none">${esc(l.text)}</text>`;
  return `<g class="dimension" stroke-width="${DIM_STROKE}">${out.join('')}${text}</g>`;
}

/** As for DXF: construction only if asked, centerlines unless told not to. */
const included = (c: Curve, o: SvgOptions): boolean => (c.lineType !== 'construction' || !!o.construction)
  && (c.lineType !== 'centerline' || o.centerlines !== false) && (!c.projected || !!o.projected);

function groupId(layer: Layer, used: Set<string>): string {
  const stem = `layer-${layer.name.trim().replace(/[^A-Za-z0-9_-]+/g, '-') || layer.id}`;
  let id = stem;
  for (let i = 2; used.has(id); i++) id = `${stem}-${i}`;
  used.add(id);
  return id;
}

/** What an editable SVG holds that its drawing does not show, for the line in the Save as SVG dialog. */
export interface EmbedSummary {
  hiddenLayers: number;
  /** Construction lines the file draws nowhere: all of them unless Construction Geometry is on, and always those on a hidden layer. */
  constructionLines: number;
  /** The same for construction curves that are not lines. */
  constructionCurves: number;
  /** Sketches of the design that are not in this file's drawing. */
  otherSketches: number;
}

/** The data is the whole design, so this counts the whole design, less what the drawing shows anyway. */
export function embedSummary(design: Design, sketches: Sketch[], opts: SvgOptions = {}): EmbedSummary {
  const visible = new Set(design.layers.filter((l) => l.visible).map((l) => l.id));
  const drawn = new Set(sketches.map((s) => s.id));
  const out: EmbedSummary = {
    hiddenLayers: design.layers.length - visible.size, constructionLines: 0, constructionCurves: 0,
    otherSketches: Object.keys(design.sketches).filter((id) => !drawn.has(id)).length,
  };
  for (const sketch of Object.values(design.sketches)) {
    for (const c of Object.values(sketch.curves)) {
      if (c.lineType !== 'construction') continue;
      if (drawn.has(sketch.id) && visible.has(c.layer) && included(c, opts)) continue;
      if (c.type === 'line') out.constructionLines++;
      else out.constructionCurves++;
    }
  }
  return out;
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** One plain sentence for the dialog: what the file carries beyond what is drawn. */
export function embedSentence(s: EmbedSummary): string {
  const parts = [
    s.hiddenLayers && plural(s.hiddenLayers, 'hidden layer'),
    s.constructionLines && plural(s.constructionLines, 'construction line'),
    s.constructionCurves && `${s.constructionCurves} other construction ${s.constructionCurves === 1 ? 'curve' : 'curves'}`,
    s.otherSketches && `${s.otherSketches} other ${s.otherSketches === 1 ? 'sketch' : 'sketches'}`,
  ].filter((p): p is string => !!p);
  if (!parts.length) return 'Includes the whole design: no hidden layers and no construction lines.';
  const last = parts.pop() as string;
  return `Includes ${parts.length ? `${parts.join(', ')} and ${last}` : last}.`;
}

/** Bottom of the layer list first, as the canvas paints, and hidden layers left out. */
export function svgSheet(design: Design, sketches: Sketch[], opts: SvgOptions = {}): Sheet {
  const tol = opts.tolerance ?? SVG_TOLERANCE;
  const box = emptyBox();
  const used = new Set<string>();
  const groups: LayerGroup[] = [];
  for (const layer of [...design.layers].reverse()) {
    if (!layer.visible) continue;
    const parts: string[] = [];
    for (const sketch of sketches) {
      for (const c of Object.values(sketch.curves)) {
        if (c.layer !== layer.id || !included(c, opts)) continue;
        if (c.type === 'text') {
          parts.push(textElement(design, sketch, c, layer.color, box));
          continue;
        }
        const b = boundingBox(sketch, c);
        boxAdd(box, { x: b.minX, y: b.minY });
        boxAdd(box, { x: b.maxX, y: b.maxY });
        const dash = c.lineType === 'normal' ? '' : ` stroke-dasharray="${SVG_DASH[c.lineType]}"`;
        parts.push(curveElement(resolve(sketch, c), dash, tol));
      }
      if (opts.points) {
        for (const p of Object.values(sketch.points)) {
          if (!p.explicit || pointLayer(sketch, p) !== layer.id) continue;
          const at = getPointPos(sketch, p.id);
          boxAdd(box, at);
          parts.push(`<circle cx="${num(at.x)}" cy="${num(-at.y)}" r="${POINT_R}" fill="${layer.color}" stroke="none"/>`);
        }
      }
      if (opts.dimensions) {
        for (const d of Object.values(sketch.dimensions)) {
          if (ownerLayer(sketch, d) === layer.id) parts.push(dimensionElements(design, sketch, d, layer.color, box));
        }
      }
    }
    groups.push({ layer, id: groupId(layer, used), body: parts.filter(Boolean).join('\n    ') });
  }
  return { box, groups };
}

export const groupMarkup = (g: LayerGroup): string =>
  `<g id="${esc(g.id)}" data-layer="${esc(g.layer.name)}" inkscape:label="${esc(g.layer.name)}" inkscape:groupmode="layer" fill="none" stroke="${g.layer.color}" stroke-width="${SVG_STROKE}" stroke-linecap="round" stroke-linejoin="round">
    <title>${esc(g.layer.name)}</title>
    ${g.body}
  </g>`;

/** A whole SVG file. width and height are real mm and the viewBox matches them, so 1 unit is 1 mm. */
export function exportSvg(design: Design, sketches: Sketch[], opts: SvgOptions = {}): string {
  const { box, groups } = svgSheet(design, sketches, opts);
  const empty = !Number.isFinite(box.minX);
  const minX = (empty ? 0 : box.minX) - SVG_MARGIN;
  const maxX = (empty ? 0 : box.maxX) + SVG_MARGIN;
  const minY = (empty ? 0 : box.minY) - SVG_MARGIN;
  const maxY = (empty ? 0 : box.maxY) + SVG_MARGIN;
  const w = maxX - minX;
  const h = maxY - minY;
  const title = sketches.map((s) => s.name).join(', ');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" version="1.1" width="${num(w)}mm" height="${num(h)}mm" viewBox="${num(minX)} ${num(-maxY)} ${num(w)} ${num(h)}">
  <title>${esc(title)}</title>
  <desc>Units are mm. Splines and conics are cubic Beziers within ${opts.tolerance ?? SVG_TOLERANCE} mm of the sketch.</desc>${opts.data ? `\n  ${dataMarkup(design)}` : ''}
  ${groups.map(groupMarkup).join('\n  ')}
</svg>
`;
}
