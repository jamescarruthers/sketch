// Trim, Extend and Break [ref SKT-TRIM-EXTEND, SKT-BREAK]: hover to preview, click to apply, Enter ends.
import type { Hit, Preview, Tool, ToolContext, ToolDef, ToolPointer } from './tool';
import type { Curve, Id, Sketch, Vec2 } from '../model/types';
import { closestPoint } from '../geom/curves';
import {
  breakCurve, breakPreview, extend, extendTarget, preview, trim, trimPreview, type OpResult,
} from '../geom/modify';
import { dist } from '../geom/vec';
import { COLORS } from '../render/style';

const SWEEP_STEP_PX = 4;
/** A trim point left on a split curve still lies on one of the pieces, to this tolerance (mm). */
const ON_PIECE = 1e-3;

const editable = (c: Curve | undefined): boolean => !!c && c.type !== 'text' && !c.projected;

const accept = (ctx: ToolContext) => (h: Hit): boolean => h.kind === 'curve' && editable(ctx.sketch.curves[h.id]);

const changedAnything = (r: OpResult): boolean => r.created.length + r.changed.length + r.removed.length > 0;

interface Segment { curve: Id; at: Vec2; pts: Vec2[]; key: string }

const segmentKey = (pts: Vec2[]): string => {
  const end = (p: Vec2): string => `${p.x.toFixed(4)},${p.y.toFixed(4)}`;
  return [end(pts[0]), end(pts[pts.length - 1])].sort().join('|');
};

/** The curve holding a position now: an earlier trim in this sweep may have split the original. */
function curveHolding(sketch: Sketch, wanted: Id, at: Vec2, layer: Id): Id | null {
  const c = sketch.curves[wanted];
  if (c && closestPoint(sketch, c, at).dist < ON_PIECE) return wanted;
  for (const other of Object.values(sketch.curves)) {
    if (editable(other) && other.layer === layer && closestPoint(sketch, other, at).dist < ON_PIECE) return other.id;
  }
  return null;
}

function createTrim(ctx: ToolContext): Tool {
  let hover: Segment | null = null;
  let sweep: Segment[] | null = null;
  let last: Vec2 | null = null;

  const probe = (screen: Vec2): Segment | null => {
    const hit = ctx.hit(screen, { kinds: ['curve'], accept: accept(ctx) });
    const seg = hit ? trimPreview(ctx.sketch, hit.id, hit.pos) : null;
    return hit && seg ? { curve: hit.id, at: hit.pos, pts: seg.pts, key: segmentKey(seg.pts) } : null;
  };
  /** The red segment is the highlight, so the whole-curve hover glow stays off. */
  const look = (screen: Vec2): void => {
    hover = probe(screen);
    ctx.invalidate();
  };
  /** The mouse jumps between events, so walk the path to catch every segment it crossed. */
  const touch = (from: Vec2, to: Vec2): void => {
    const steps = Math.max(1, Math.ceil(dist(from, to) / SWEEP_STEP_PX));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const s = probe({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
      if (s && sweep && !sweep.some((k) => k.key === s.key)) sweep.push(s);
    }
  };
  const apply = (segments: Segment[]): void => {
    ctx.commit('Trim', (c) => {
      let any = false;
      for (const s of segments) {
        const id = curveHolding(c.sketch, s.curve, s.at, c.design.activeLayer);
        if (id && changedAnything(trim(c.design, c.sketch, id, s.at))) any = true;
      }
      return any;
    });
    hover = null;
    if (ctx.pointer) look(ctx.pointer.screen);
  };

  return {
    start() {
      ctx.selection.clear();
      ctx.status('Click a segment to trim it, or press and drag across several');
    },
    move(e) {
      if (sweep) {
        if (e.dragging && last) {
          touch(last, e.screen);
          last = e.screen;
        }
        return;
      }
      look(e.screen);
    },
    down(e) {
      if (e.button !== 0) return;
      sweep = [];
      last = e.screen;
    },
    up(e) {
      const list = sweep;
      sweep = null;
      last = null;
      if (e.dragging && list?.length) apply(list);
    },
    click(e) {
      const s = probe(e.screen);
      if (s) apply([s]);
    },
    escape() {
      if (!sweep) return false;
      sweep = null;
      return true;
    },
    draw(p: Preview) {
      for (const s of sweep ?? (hover ? [hover] : [])) p.poly(s.pts, false, { color: COLORS.error, width: 3 });
    },
    docChanged() {
      hover = null;
      sweep = null;
    },
  };
}

function createExtend(ctx: ToolContext): Tool {
  let hover: { curve: Id; at: Vec2 } | null = null;
  let ghost: { sketch: Sketch; end: Vec2 } | null = null;

  const look = (screen: Vec2): void => {
    const hit = ctx.hit(screen, { kinds: ['curve'], accept: accept(ctx) });
    ctx.setHover(hit);
    hover = hit ? { curve: hit.id, at: hit.pos } : null;
    const target = hit ? extendTarget(ctx.sketch, hit.id, hit.pos) : null;
    ghost = hit && target
      ? { sketch: preview(ctx.design, ctx.sketch, (d, s) => extend(d, s, hit.id, hit.pos)).sketch, end: target.p }
      : null;
  };

  return {
    start() {
      ctx.selection.clear();
      ctx.status('Click near a curve end to extend it to the next intersection');
    },
    stop() {
      ctx.setHover(null);
    },
    move(e) {
      look(e.screen);
    },
    click(e) {
      look(e.screen);
      if (!hover) return;
      if (!ghost) {
        ctx.message('There is no intersection to extend to', 'warn');
        return;
      }
      const { curve, at } = hover;
      ctx.commit('Extend', (c) => changedAnything(extend(c.design, c.sketch, curve, at)));
      if (ctx.pointer) look(ctx.pointer.screen);
    },
    draw(p: Preview) {
      if (!ghost || !hover) return;
      const c = ghost.sketch.curves[hover.curve];
      if (c) p.curves(ghost.sketch, [c], { color: COLORS.preview, width: 2, dash: [6, 4] });
      p.dot(ghost.end, { color: COLORS.preview });
    },
    docChanged() {
      hover = null;
      ghost = null;
    },
  };
}

function createBreak(ctx: ToolContext): Tool {
  let hover: { curve: Id; at: Vec2; pts: Vec2[] } | null = null;

  const look = (e: ToolPointer): Hit | null => {
    const hit = ctx.hit(e.screen, { kinds: ['curve'], accept: accept(ctx) });
    ctx.setHover(hit);
    const seg = hit ? breakPreview(ctx.sketch, hit.id, hit.pos) : null;
    hover = hit && seg ? { curve: hit.id, at: hit.pos, pts: seg.pts } : null;
    return hit;
  };

  return {
    start() {
      ctx.selection.clear();
      ctx.status('Click a curve to break it where other geometry crosses it');
    },
    stop() {
      ctx.setHover(null);
    },
    move(e) {
      look(e);
    },
    click(e) {
      const hit = look(e);
      if (hit && !hover) {
        ctx.message('Nothing crosses this curve', 'warn');
        return;
      }
      if (!hover) return;
      const { curve, at } = hover;
      ctx.commit('Break', (c) => changedAnything(breakCurve(c.design, c.sketch, curve, at)));
      hover = null;
      if (ctx.pointer) look(ctx.pointer);
    },
    draw(p: Preview) {
      if (!hover) return;
      p.poly(hover.pts, false, { color: COLORS.preview, width: 2.5, dash: [6, 4] });
      for (const at of [hover.pts[0], hover.pts[hover.pts.length - 1]]) {
        const r = ctx.view.px(5);
        const stroke = { color: COLORS.error, width: 2 };
        p.line({ x: at.x - r, y: at.y - r }, { x: at.x + r, y: at.y + r }, stroke);
        p.line({ x: at.x - r, y: at.y + r }, { x: at.x + r, y: at.y - r }, stroke);
      }
    },
    docChanged() {
      hover = null;
    },
  };
}

export const trimTools: ToolDef[] = [
  { meta: { id: 'trim', label: 'Trim', panel: 'modify', shortcut: 'T' }, create: createTrim },
  { meta: { id: 'extend', label: 'Extend', panel: 'modify' }, create: createExtend },
  { meta: { id: 'break', label: 'Break', panel: 'modify' }, create: createBreak },
];
