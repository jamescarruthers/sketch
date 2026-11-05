// Default tool: selection, window and crossing boxes, and dragging geometry through the solver.
import type { Id, Vec2 } from '../model/types';
import { AXIS_X, AXIS_Y, ORIGIN } from '../model/types';
import { coincidentClasses, curvePoints, findChain, getPointPos } from '../model/document';
import { slideOnPath } from '../io/text';
import { dist, sub, add } from '../geom/vec';
import { EPS_JOIN } from '../geom/tolerance';
import { COLORS } from '../render/style';
import { dragCurvatureHandle, grabCurvatureHandle, type HandleGrab } from './spline';
import type { Hit, Preview, SnapOptions, Tool, ToolContext, ToolDef, ToolPointer } from './tool';

/** How near its target (mm) a dragged point has to end for its snap to count. */
const LANDED = 1e-3;

export interface BoxSelect {
  /** Call from `down` on empty canvas. */
  begin(e: ToolPointer): void;
  /** True while a box is live. Call from `move`. */
  move(e: ToolPointer): boolean;
  /** Finishes the box. Returns the ids inside, or null if no box was dragged. */
  end(e: ToolPointer): Id[] | null;
  cancel(): void;
  draw(p: Preview): void;
}

/** The rubber band, shared with dialog selection fields [ref Mirror tutorial]. */
export function createBoxSelect(ctx: ToolContext, select: (a: Vec2, b: Vec2, crossing: boolean) => Id[]): BoxSelect {
  let start: Vec2 | null = null;
  let end: Vec2 | null = null;
  return {
    begin(e) {
      start = e.screen;
      end = null;
    },
    move(e) {
      if (!start) return false;
      if (e.dragging) end = e.screen;
      return !!end;
    },
    end(e) {
      const from = start;
      const live = !!end;
      start = null;
      end = null;
      if (!from || !live) return null;
      const crossing = e.screen.x < from.x;
      return select(ctx.view.toWorld(from), ctx.view.toWorld(e.screen), crossing);
    },
    cancel() {
      start = null;
      end = null;
    },
    draw(p) {
      if (!start || !end) return;
      const a = start;
      const b = end;
      const crossing = b.x < a.x;
      p.raw((g) => {
        g.strokeStyle = crossing ? COLORS.crossingBox : COLORS.windowBox;
        g.fillStyle = crossing ? COLORS.crossingFill : COLORS.windowFill;
        g.lineWidth = 1;
        g.setLineDash(crossing ? [6, 4] : []);
        g.beginPath();
        g.rect(Math.min(a.x, b.x) + 0.5, Math.min(a.y, b.y) + 0.5, Math.abs(b.x - a.x), Math.abs(b.y - a.y));
        g.fill();
        g.stroke();
      });
    },
  };
}

interface DragState {
  grab: Vec2;
  /** Start position of every dragged point. */
  points: Map<Id, Vec2>;
  /** Circle rim drag: radius follows the cursor, centre held. */
  rim: { curve: Id; center: Id } | null;
  /** A single point being dragged: it snaps to what it passes over and joins it on release [ref]. */
  snap: { point: Id; options: SnapOptions } | null;
  moved: boolean;
}

/** What a dragged point can land on. */
const SNAPS = new Set(['point', 'midpoint', 'onCurve', 'quadrant']);

const reserved = (id: Id): boolean => id === ORIGIN || id === AXIS_X || id === AXIS_Y;

function createSelect(ctx: ToolContext): Tool {
  let press: Hit | null = null;
  let pressAt: Vec2 | null = null;
  let onLabel: { id: Id; offset: Vec2 } | null = null;
  let drag: DragState | null = null;
  /** Text on a path slides along it. */
  let sliding: { id: Id; at: Vec2 } | null = null;
  /** A curvature handle end in the hand, and whether it has moved. */
  let grabbed: (HandleGrab & { moved: boolean }) | null = null;
  /** A press on a handle that never travelled is not a click on the canvas. */
  let swallowClick = false;
  const box = createBoxSelect(ctx, (a, b, crossing) => ctx.boxSelect(a, b, crossing));

  const pointsToDrag = (hit: Hit): Id[] => {
    const { sketch } = ctx;
    const owned = (id: Id): Id[] => {
      if (sketch.curves[id]) return curvePoints(sketch.curves[id]);
      return sketch.points[id] ? [id] : [];
    };
    if (ctx.selection.size > 1 && ctx.selection.has(hit.id)) return [...new Set(ctx.selection.ids().flatMap(owned))];
    return owned(hit.id);
  };

  /** Free things only: fully constrained entities stay put [ref]. */
  const draggable = (hit: Hit): boolean => {
    if (reserved(hit.id)) return false;
    const { freeCurves, freePoints } = ctx.analysis;
    if (hit.kind === 'point') return freePoints.has(hit.id);
    if (hit.kind !== 'curve') return false;
    const c = ctx.sketch.curves[hit.id];
    if (!c || c.projected || !freeCurves.has(hit.id)) return false;
    // An offset whose dimension was deleted has a free distance to drag [ref SKT-OFFSET].
    const feature = c.derivedFrom ? ctx.sketch.features[c.derivedFrom] : undefined;
    return !c.derivedFrom || (feature?.type === 'offset' && !feature.dimension);
  };

  const beginDrag = (hit: Hit, grab: Vec2): void => {
    const { sketch } = ctx;
    const curve = sketch.curves[hit.id];
    const selected = ctx.selection.size > 1 && ctx.selection.has(hit.id);
    if (curve?.type === 'circle' && !selected && !curve.derivedFrom) {
      drag = { grab, points: new Map(), rim: { curve: curve.id, center: curve.c }, snap: null, moved: false };
      return;
    }
    const points = new Map<Id, Vec2>();
    for (const id of pointsToDrag(hit)) if (sketch.points[id]) points.set(id, getPointPos(sketch, id));
    drag = { grab, points, rim: null, snap: hit.kind === 'point' && !selected ? snapFor(hit.id) : null, moved: false };
  };

  /** Ignore the dragged point's own class and the curves through it, so it cannot snap to itself. */
  const snapFor = (point: Id): { point: Id; options: SnapOptions } | null => {
    const { sketch } = ctx;
    if (!sketch.points[point]) return null;
    const rep = coincidentClasses(sketch);
    const mine = Object.keys(sketch.points).filter((id) => rep(id) === rep(point));
    const curves = Object.values(sketch.curves).filter((c) => curvePoints(c).some((p) => mine.includes(p))).map((c) => c.id);
    return { point, options: { exclude: mine, excludeCurves: curves } };
  };

  const stepDrag = (e: ToolPointer): void => {
    if (!drag) return;
    const { sketch } = ctx;
    drag.moved = true;
    if (drag.rim) {
      const c = sketch.curves[drag.rim.curve];
      if (c?.type !== 'circle') return;
      const m = getPointPos(sketch, c.c);
      c.r = Math.max(dist(m, e.world), ctx.view.px(2));
      ctx.solver.drag([], [drag.rim.center]);
      return;
    }
    const delta = sub(e.world, drag.grab);
    const targets = [...drag.points].map(([point, p]) => ({ point, ...add(p, delta) }));
    if (drag.snap && e.snapped.kind !== 'none') {
      const t = targets.find((x) => x.point === drag?.snap?.point);
      if (t) Object.assign(t, e.snapped.pos);
    }
    ctx.solver.drag(targets);
  };

  const hover = (e: ToolPointer): void => {
    ctx.setHover(ctx.hit(e.screen, { reserved: true, accept: (h) => h.kind !== 'curve' || !reserved(h.id) }));
  };

  return {
    start() {
      ctx.status('Select geometry, or pick a tool');
    },
    stop() {
      box.cancel();
      ctx.setHover(null);
    },
    snap() {
      return drag?.snap?.options ?? null;
    },
    move(e) {
      if (grabbed) {
        if (e.dragging) {
          grabbed.moved = true;
          dragCurvatureHandle(ctx, grabbed, e.world);
        }
        return;
      }
      if (drag) {
        stepDrag(e);
        return;
      }
      if (sliding) {
        const t = ctx.sketch.curves[sliding.id];
        if (t?.type === 'text') slideOnPath(t, ctx.sketch, sliding.at, e.world);
        sliding.at = e.world;
        ctx.solver.drag([]);
        return;
      }
      if (onLabel && e.dragging) {
        const d = ctx.sketch.dimensions[onLabel.id];
        if (d) d.label = add(e.world, onLabel.offset);
        return;
      }
      if (box.move(e)) return;
      if (press && e.dragging) {
        const text = press.kind === 'curve' ? ctx.sketch.curves[press.id] : undefined;
        if (text?.type === 'text' && text.mode === 'path') {
          sliding = { id: text.id, at: pressAt ?? e.world };
          press = null;
          return;
        }
        if (draggable(press)) beginDrag(press, pressAt ?? e.world);
        press = null;
        if (drag) stepDrag(e);
        return;
      }
      if (e.button < 0) hover(e);
    },
    down(e) {
      if (e.button !== 0) return;
      const handle = grabCurvatureHandle(ctx, e.screen);
      if (handle) {
        grabbed = { ...handle, moved: false };
        return;
      }
      const hit = ctx.hit(e.screen, { reserved: true, accept: (h) => h.kind !== 'curve' || !reserved(h.id) });
      if (hit?.kind === 'dimension') {
        const d = ctx.sketch.dimensions[hit.id];
        onLabel = d ? { id: hit.id, offset: sub(d.label, e.world) } : null;
      }
      press = hit;
      pressAt = e.world;
      if (!hit) box.begin(e);
    },
    up(e) {
      if (grabbed) {
        if (grabbed.moved) ctx.commit('Drag Curvature Handle', () => undefined, { coalesce: 'curvature-handle' });
        else swallowClick = true;
        grabbed = null;
        return;
      }
      if (sliding) {
        sliding = null;
        ctx.commit('Move Text', () => undefined);
        return;
      }
      if (drag) {
        const { moved, snap } = drag;
        drag = null;
        if (!moved) return;
        // Cmd/Ctrl suppresses the snap, so `snapped` is already empty then.
        const landed = snap && SNAPS.has(e.snapped.kind) ? { pos: e.snapped.pos, inference: e.snapped } : null;
        ctx.commit('Drag', (c) => {
          // A point that could not get there, held by a joined end on another layer, has not landed on anything.
          if (snap && landed && dist(getPointPos(c.sketch, snap.point), landed.pos) < LANDED) c.infer(snap.point, landed);
        });
        return;
      }
      if (onLabel) {
        const moved = e.dragging;
        onLabel = null;
        if (moved) {
          ctx.commit('Move Dimension', () => undefined);
          press = null;
          return;
        }
      }
      const inside = box.end(e);
      if (inside) {
        if (e.shift) ctx.selection.add(inside);
        else ctx.selection.set(inside);
      }
      press = null;
    },
    click(e) {
      if (swallowClick) {
        swallowClick = false;
        return;
      }
      const hit = ctx.hit(e.screen, { reserved: true, accept: (h) => h.kind !== 'curve' || !reserved(h.id) });
      if (!hit) {
        if (!e.shift) ctx.selection.clear();
        return;
      }
      if (e.shift) ctx.selection.toggle(hit.id);
      else ctx.selection.set([hit.id]);
    },
    dblclick(e) {
      const hit = ctx.hit(e.screen);
      if (!hit) return;
      if (ctx.runDoubleClick(hit)) return;
      if (hit.kind === 'dimension') {
        ctx.editDimension(hit.id);
      } else if (hit.kind === 'curve') {
        const chain = findChain(ctx.sketch, hit.id, (a, b) => dist(a, b) < EPS_JOIN);
        ctx.selection.set(chain.links.map((l) => l.curve).filter(ctx.editable));
      }
    },
    escape() {
      if (drag || sliding || grabbed) {
        drag = null;
        sliding = null;
        grabbed = null;
        ctx.revert();
        return true;
      }
      if (ctx.selection.size) ctx.selection.clear();
      return true;
    },
    enter: () => true,
    draw(p) {
      box.draw(p);
    },
  };
}

export const selectTool: ToolDef = {
  meta: { id: 'select', label: 'Select', panel: 'select', repeatable: false },
  create: createSelect,
};
