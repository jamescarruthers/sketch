// Screen-space drawing in sketch coordinates: line weights and text stay the same at any zoom.
import type { Curve, Design, Dimension, Sketch, Vec2 } from '../model/types';
import { sampleForRender } from '../geom/curves';
import type { View } from '../app/view';
import { drawDimension, layoutDimension } from './dimensions';
import { COLORS, FONT } from './style';

export interface Stroke {
  color?: string;
  width?: number;
  dash?: number[];
  fill?: string;
}

/** What a tool's `draw` receives. All positions are in sketch mm unless the name says screen. */
export interface Preview {
  readonly view: View;
  line(a: Vec2, b: Vec2, s?: Stroke): void;
  poly(pts: readonly Vec2[], closed?: boolean, s?: Stroke): void;
  circle(c: Vec2, r: number, s?: Stroke): void;
  /** `start` and `sweep` in radians; a negative sweep runs clockwise. */
  arc(c: Vec2, r: number, start: number, sweep: number, s?: Stroke): void;
  /** Point marker of constant screen size. */
  dot(p: Vec2, s?: Stroke, radiusPx?: number): void;
  /** Screen-size text centred on p, with a background so it reads over geometry. */
  text(p: Vec2, text: string, color?: string): void;
  /** Draw stored curves as they resolve in `sketch`, typically a copy from modify `preview`. */
  curves(sketch: Sketch, curves: Iterable<Curve>, s?: Stroke): void;
  /** Dimension-style leader between two points with a value at the middle. */
  measure(a: Vec2, b: Vec2, text: string): void;
  /** Draw a dimension that is not in the document yet. */
  dimension(design: Design, sketch: Sketch, d: Dimension): void;
  /** Draw with the raw canvas in screen coordinates. Restored afterwards. */
  raw(fn: (g: CanvasRenderingContext2D) => void): void;
}

export class Painter implements Preview {
  constructor(readonly g: CanvasRenderingContext2D, readonly view: View, private readonly base: Stroke = {}) {}

  private apply(s: Stroke | undefined): void {
    const { g } = this;
    g.strokeStyle = s?.color ?? this.base.color ?? COLORS.preview;
    g.lineWidth = s?.width ?? this.base.width ?? 1.5;
    g.setLineDash(s?.dash ?? this.base.dash ?? []);
    g.lineCap = 'round';
    g.lineJoin = 'round';
  }

  line(a: Vec2, b: Vec2, s?: Stroke): void {
    this.poly([a, b], false, s);
  }

  poly(pts: readonly Vec2[], closed = false, s?: Stroke): void {
    if (pts.length < 2) return;
    const { g, view } = this;
    this.apply(s);
    g.beginPath();
    pts.forEach((p, i) => {
      const q = view.toScreen(p);
      if (i === 0) g.moveTo(q.x, q.y);
      else g.lineTo(q.x, q.y);
    });
    if (closed) g.closePath();
    if (s?.fill) {
      g.fillStyle = s.fill;
      g.fill();
    }
    g.stroke();
  }

  circle(c: Vec2, r: number, s?: Stroke): void {
    this.arc(c, r, 0, Math.PI * 2, s);
  }

  arc(c: Vec2, r: number, start: number, sweep: number, s?: Stroke): void {
    const { g, view } = this;
    const q = view.toScreen(c);
    this.apply(s);
    g.beginPath();
    g.arc(q.x, q.y, r * view.ppm, -start, -(start + sweep), sweep > 0);
    if (s?.fill) {
      g.fillStyle = s.fill;
      g.fill();
    }
    g.stroke();
  }

  dot(p: Vec2, s?: Stroke, radiusPx = 3): void {
    const { g, view } = this;
    const q = view.toScreen(p);
    this.apply({ ...s, width: s?.width ?? 1.25, dash: [] });
    g.fillStyle = s?.fill ?? COLORS.dotHole;
    g.beginPath();
    g.arc(q.x, q.y, radiusPx, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }

  text(p: Vec2, text: string, color: string = COLORS.dimension): void {
    const { g, view } = this;
    const q = view.toScreen(p);
    g.font = FONT;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const w = g.measureText(text).width;
    g.fillStyle = COLORS.tipBg;
    g.fillRect(q.x - w / 2 - 3, q.y - 8, w + 6, 16);
    g.fillStyle = color;
    g.fillText(text, q.x, q.y);
  }

  curves(sketch: Sketch, curves: Iterable<Curve>, s?: Stroke): void {
    for (const c of curves) {
      const pts = sampleForRender(sketch, c, this.view.ppm);
      this.poly(pts, false, s);
    }
  }

  measure(a: Vec2, b: Vec2, text: string): void {
    this.line(a, b, { color: COLORS.guide, width: 1, dash: [4, 3] });
    this.text({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, text);
  }

  dimension(design: Design, sketch: Sketch, d: Dimension): void {
    const layout = layoutDimension(design, sketch, d, this.view);
    if (layout) drawDimension(this, layout, { color: COLORS.selected });
  }

  raw(fn: (g: CanvasRenderingContext2D) => void): void {
    this.g.save();
    fn(this.g);
    this.g.restore();
  }
}
