// Draws one frame. Frames are requested on change only (App.invalidate); the camera's swing between
// planes (App.play) asks for one per animation frame, and draws the 3D scene instead of the plan.
import type { Curve, Dimension, Id, Point, Sketch, Vec3 } from '../model/types';
import { ORIGIN } from '../model/types';
import { PLANE_FRAMES, toWorld, v3 } from '../model/frames';
import { FrameView, project, type Camera } from '../app/camera';
import { curveEnds, curvePoints } from '../model/document';
import { ownerLayer, pointLayer } from '../model/layers';
import { isLost } from '../io/projection';
import type { App } from '../app/app';
import { visiblePoints } from '../app/hit';
import { fixOverlay } from '../tools/constraints';
import { OVERLAYS } from '../tools/registry';
import { dashOf, COLORS, FONT } from './style';
import { dimensionColor, drawDimension, labelSize, layoutDimension, type DimLayout } from './dimensions';
import { drawAxes, drawGrid } from './grid';
import { drawBadge, drawInference, drawOrigin, layoutBadges, type Badge } from './glyphs';
import { Painter, type Stroke } from './painter';

export type Label = DimLayout & { w: number; h: number };

const WIDTH = 1.6;
const SELECTED_WIDTH = 3;
const HOVER_WIDTH = 8;

export class Renderer {
  private readonly g: CanvasRenderingContext2D;
  private layoutKey = '';
  private cached: { badges: Badge[]; labels: Label[] } = { badges: [], labels: [] };

  constructor(private readonly canvas: HTMLCanvasElement, private readonly app: App) {
    this.g = canvas.getContext('2d', { alpha: false }) as CanvasRenderingContext2D;
  }

  /** Badge and label positions for the active sketch, shared with hit testing. */
  layouts(sketch: Sketch): { badges: Badge[]; labels: Label[] } {
    const { app, g } = this;
    const key = `${sketch.id}:${app.geomVersion}:${app.view.version}:${app.settings.showConstraints}:${app.settings.showDimensions}:${app.settings.showConstruction}:${app.design.activeLayer}:${app.analysisOf(sketch.id).unsatisfied.size}`;
    if (key === this.layoutKey) return this.cached;
    this.layoutKey = key;
    const badges = app.settings.showConstraints
      ? layoutBadges(sketch, app.view, { constraint: (k) => app.annotationShown(sketch, k), feature: (f) => app.featureShown(f) })
      : [];
    const labels: Label[] = [];
    if (app.settings.showDimensions) {
      for (const d of Object.values(sketch.dimensions)) {
        if (!app.annotationShown(sketch, d)) continue;
        const l = layoutDimension(app.design, sketch, d, app.view);
        if (l) labels.push({ ...l, ...labelSize(g, l.text) });
      }
    }
    this.cached = { badges, labels };
    return this.cached;
  }

  render(): void {
    const { app, g, canvas } = this;
    const { view } = app;
    g.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    g.fillStyle = COLORS.background;
    g.fillRect(0, 0, canvas.width, canvas.height);
    if (app.scene) {
      this.renderScene(app.scene);
      return;
    }
    if (app.settings.grid) drawGrid(g, view);
    drawAxes(g, view);

    const p = new Painter(g, view);
    const active = app.activeSketch;
    if (active) this.drawPlaneLines(p);
    // Each as the plane looked at sees it: whole from the same plane, else only what lies in this one.
    for (const s of app.otherSketches()) {
      if (!active) this.drawProfiles(p, s);
      this.drawCurves(p, s, active !== null);
      if (s !== app.design.sketches[s.id]) this.drawLoosePoints(p, s);
      else if (app.dimensionsInDesign.has(s.id)) this.drawDimensions(p, s, false);
    }
    if (active) {
      if (app.settings.showProfile) this.drawProfiles(p, active);
      this.drawCurves(p, active, false);
      if (app.settings.showPoints) this.drawPoints(p, active);
      if (app.settings.showDimensions) this.drawDimensions(p, active, true);
      if (app.settings.showConstraints) this.drawBadges(active);
    }
    const originHover = app.hover?.id === ORIGIN || app.selection.has(ORIGIN);
    drawOrigin(g, view.toScreen({ x: 0, y: 0 }), originHover);

    if (active) {
      // Show Constraints governs the Fix lock too [ref GUID-4183A4B7].
      app.drawToolLayer(p, app.settings.showConstraints ? OVERLAYS : OVERLAYS.filter((o) => o !== fixOverlay));
      this.drawInference(p);
    }
  }

  /**
   * Every visible sketch through its frame, orthographic, with the origin planes and axes faint: the swing
   * between planes and the Orbit view. Points go through the camera one by one and are stroked on screen,
   * so lines keep their weight, and circles and arcs seen at a slant are ellipses.
   */
  private renderScene(cam: Camera): void {
    const { app, g } = this;
    const { view } = app;
    const at = (q: Vec3) => project(cam, q, view.width, view.height);
    const size = app.sceneSize();
    g.save();
    g.setLineDash([]);
    g.lineWidth = 1;
    for (const frame of Object.values(PLANE_FRAMES)) {
      g.beginPath();
      [[0, 0], [size, 0], [size, size], [0, size]].forEach(([x, y], i) => {
        const s = at(toWorld(frame, { x, y }));
        if (i === 0) g.moveTo(s.x, s.y);
        else g.lineTo(s.x, s.y);
      });
      g.closePath();
      g.globalAlpha = 0.35;
      g.fillStyle = COLORS.gridMinor;
      g.fill();
      g.globalAlpha = 0.8;
      g.strokeStyle = COLORS.gridMajor;
      g.stroke();
    }
    g.globalAlpha = 0.75;
    g.font = FONT;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const axes: [Vec3, string, string][] = [[v3(1, 0, 0), COLORS.axisX, 'X'], [v3(0, 1, 0), COLORS.axisY, 'Y'], [v3(0, 0, 1), COLORS.axisZ, 'Z']];
    for (const [d, color, name] of axes) {
      const a = at(v3(0, 0, 0));
      const b = at(v3(d.x * size * 1.25, d.y * size * 1.25, d.z * size * 1.25));
      g.strokeStyle = color;
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
      g.stroke();
      const c = at(v3(d.x * size * 1.35, d.y * size * 1.35, d.z * size * 1.35));
      g.fillStyle = color;
      g.fillText(name, c.x, c.y);
    }
    g.restore();
    const active = app.activeSketch;
    for (const id of app.design.order) {
      const s = app.design.sketches[id];
      if (!s?.visible) continue;
      const p = new Painter(g, new FrameView(cam, s.frame, view));
      if (app.orbitHover === id) {
        for (const c of Object.values(s.curves)) if (app.curveVisible(c) && c.type !== 'text') p.poly(app.polyline(s, c), false, { color: COLORS.hover, width: HOVER_WIDTH });
      }
      if (app.settings.showProfile) this.drawProfiles(p, s);
      this.drawCurves(p, s, s !== active);
    }
    drawOrigin(g, at(v3(0, 0, 0)), false);
  }

  /** Where other sketches' planes meet this one, right across the view and under the geometry. */
  private drawPlaneLines(p: Painter): void {
    const { app } = this;
    const { view } = app;
    const lit = app.planeHover?.ids.join();
    for (const line of app.planeLines()) {
      // Far enough each way from the point of the line nearest the view's centre to leave the canvas.
      const t = (view.cx - line.p.x) * line.d.x + (view.cy - line.p.y) * line.d.y;
      const reach = Math.hypot(view.width, view.height) / view.ppm;
      const at = (k: number) => ({ x: line.p.x + line.d.x * (t + k * reach), y: line.p.y + line.d.y * (t + k * reach) });
      if (line.ids.join() === lit) p.line(at(-1), at(1), { color: COLORS.hover, width: HOVER_WIDTH });
      p.line(at(-1), at(1), { color: COLORS.planeLine, width: 1.25 });
    }
  }

  /** A sketch on another plane shows its points on this one even where their curves do not lie in it. */
  private drawLoosePoints(p: Painter, sketch: Sketch): void {
    const { app } = this;
    for (const pt of visiblePoints(sketch, app.curveVisible, (q) => app.pointVisible(q, sketch))) {
      if (!pt.shown) continue;
      if (app.hover?.id === pt.id) p.dot(pt, { color: COLORS.hover, fill: COLORS.hover, width: 1 }, 8);
      p.dot(pt, { color: COLORS.template, fill: COLORS.template }, 2.5);
    }
  }

  private drawProfiles(p: Painter, sketch: Sketch): void {
    if (!this.app.settings.showProfile) return;
    const { g, view } = p;
    const profiles = this.app.profilesOf(sketch);
    if (!profiles.length) return;
    g.fillStyle = COLORS.profile;
    for (const profile of profiles) {
      g.beginPath();
      for (const loop of [profile.outer, ...profile.holes]) {
        loop.pts.forEach((pt, i) => {
          const s = view.toScreen(pt);
          if (i === 0) g.moveTo(s.x, s.y);
          else g.lineTo(s.x, s.y);
        });
        g.closePath();
      }
      g.fill('evenodd');
    }
  }

  /** Bottom of the layer list first, so the top of the list is drawn last. */
  private inLayerOrder(sketch: Sketch): Curve[] {
    const curves = Object.values(sketch.curves);
    const { layers } = this.app.design;
    if (layers.length < 2) return curves;
    const buckets = new Map<Id, Curve[]>(layers.map((l) => [l.id, []]));
    for (const c of curves) buckets.get(c.layer)?.push(c);
    return [...layers].reverse().flatMap((l) => buckets.get(l.id) ?? []);
  }

  /** Status colours are for the active layer with Show Constrained Lines on. Everything else is its layer's colour. */
  private plainColor(c: Curve): string | null {
    const { app } = this;
    return app.settings.showConstrained && c.layer === app.design.activeLayer ? null : app.layerColor(c.layer);
  }

  private stroke(sketch: Sketch, c: Curve): Stroke {
    const a = this.app.analysisOf(sketch.id);
    const dash = dashOf(c.lineType);
    const onActive = c.layer === this.app.design.activeLayer;
    if (a.badCurves.has(c.id) && (onActive || a.crossCurves.has(c.id))) return { color: COLORS.error, width: WIDTH, dash };
    const plain = this.plainColor(c);
    if (plain) return { color: plain, width: c.lineType === 'normal' || c.projected ? WIDTH : 1.3, dash };
    if (c.projected) {
      // A link whose source was deleted shows orange [ref Manage Lost Projections].
      if (isLost(this.app.design, c, sketch)) return { color: COLORS.lost, width: WIDTH + 0.6, dash };
      return { color: COLORS.projected, width: WIDTH, dash };
    }
    if (c.fixed) return { color: COLORS.fixed, width: WIDTH, dash };
    // Fully constrained construction turns black like everything else, and keeps its dashes [ref SKT-3D-SKETCH].
    if (c.lineType !== 'normal') return { color: a.freeCurves.has(c.id) ? COLORS.construction : COLORS.constrained, width: 1.3, dash };
    return { color: a.freeCurves.has(c.id) ? COLORS.free : COLORS.constrained, width: WIDTH };
  }

  private drawCurves(p: Painter, sketch: Sketch, muted: boolean): void {
    const { app } = this;
    const lit = this.litIds(sketch);
    const hover = app.hover?.id;
    for (const c of this.inLayerOrder(sketch)) {
      if (!app.curveVisible(c)) continue;
      const pts = app.polyline(sketch, c);
      if (muted) {
        if (hover === c.id) p.poly(pts, false, { color: COLORS.hover, width: HOVER_WIDTH });
        if (c.type === 'text') {
          this.drawText(p, sketch, c, lit.has(c.id) ? COLORS.selected : COLORS.template);
          continue;
        }
        p.poly(pts, false, lit.has(c.id)
          ? { color: COLORS.selected, width: SELECTED_WIDTH }
          : { color: COLORS.template, width: 1.2, dash: dashOf(c.lineType) });
        continue;
      }
      if (c.type === 'text') {
        const glow = hover === c.id;
        this.drawText(p, sketch, c, lit.has(c.id) || glow ? COLORS.selected : this.stroke(sketch, c).color ?? COLORS.free);
        continue;
      }
      if (hover === c.id) p.poly(pts, false, { color: COLORS.hover, width: HOVER_WIDTH });
      const s = this.stroke(sketch, c);
      p.poly(pts, false, lit.has(c.id) ? { color: COLORS.selected, width: SELECTED_WIDTH, dash: s.dash } : s);
    }
  }

  private drawText(p: Painter, sketch: Sketch, c: Extract<Curve, { type: 'text' }>, color: string): void {
    const { g, view } = p;
    const shape = this.app.textShape(sketch, c);
    if (!shape) return;
    g.fillStyle = color;
    g.beginPath();
    for (const { pts } of shape.loops) {
      pts.forEach((pt, i) => {
        const s = view.toScreen(pt);
        if (i === 0) g.moveTo(s.x, s.y);
        else g.lineTo(s.x, s.y);
      });
      g.closePath();
    }
    g.fill('nonzero');
  }

  /** Selection plus what a selected glyph or dimension refers to [ref]. */
  private litIds(sketch: Sketch): Set<Id> {
    const { app } = this;
    const lit = new Set<Id>(app.highlight);
    for (const id of app.selection.ids()) {
      lit.add(id);
      const refs = sketch.constraints[id]?.refs ?? sketch.dimensions[id]?.refs;
      refs?.forEach((r) => lit.add(r));
    }
    return lit;
  }

  private drawPoints(p: Painter, sketch: Sketch): void {
    const { app } = this;
    const a = app.analysisOf(sketch.id);
    const lit = this.litIds(sketch);
    const joined = new Set<Id>();
    for (const k of Object.values(sketch.constraints)) {
      if (k.type === 'coincident' || k.type === 'midpoint') k.refs.forEach((r) => joined.add(r));
    }
    const interior = new Set<Id>();
    const centres = new Set<Id>();
    for (const c of Object.values(sketch.curves)) {
      if (c.type === 'fitSpline') {
        const ends = curveEnds(c);
        for (const id of c.pts) if (!ends?.includes(id)) interior.add(id);
      } else if (c.type === 'controlSpline' && !c.blend) {
        curvePoints(c).slice(1, -1).forEach((id) => interior.add(id));
      } else if (c.type === 'circle' || c.type === 'arc' || c.type === 'ellipse' || c.type === 'ellipticalArc') {
        centres.add(c.c);
      }
    }
    for (const pt of visiblePoints(sketch, app.curveVisible, (q) => app.pointVisible(q, sketch))) {
      const layer = pointLayer(sketch, pt);
      if (layer !== app.design.activeLayer) {
        // Template geometry has no status dots. A point the Point tool made is geometry, though.
        if (app.hover?.id === pt.id) p.dot(pt, { color: COLORS.hover, fill: COLORS.hover, width: 1 }, 8);
        if (lit.has(pt.id)) p.dot(pt, { color: COLORS.selected, fill: COLORS.selected }, 4);
        else if (pt.explicit) p.dot(pt, { color: app.layerColor(layer as Id), fill: app.layerColor(layer as Id) }, 2.5);
        continue;
      }
      this.drawPoint(p, pt, {
        lit: lit.has(pt.id), hover: app.hover?.id === pt.id, free: a.freePoints.has(pt.id),
        joined: joined.has(pt.id), interior: interior.has(pt.id), centre: centres.has(pt.id),
        plain: app.settings.showConstrained ? null : app.layerColor(layer),
      });
    }
  }

  /** Which of the active sketch's points get a status dot now. For tests. */
  drawnPoints(sketch: Sketch): Id[] {
    const { app } = this;
    if (!app.settings.showPoints) return [];
    return visiblePoints(sketch, app.curveVisible, (q) => app.pointVisible(q, sketch))
      .filter((pt) => pointLayer(sketch, pt) === app.design.activeLayer).map((pt) => pt.id);
  }

  /** How a curve of the active sketch is drawn. For tests. */
  appearance(id: Id): { color: string; width: number; dash: number[] } | null {
    const { app } = this;
    const sketch = app.activeSketch;
    const c = sketch?.curves[id];
    if (!sketch || !c || !app.curveVisible(c)) return null;
    const s = this.stroke(sketch, c);
    return { color: s.color ?? COLORS.free, width: s.width ?? WIDTH, dash: s.dash ?? [] };
  }

  private drawPoint(p: Painter, pt: Point, s: { lit: boolean; hover: boolean; free: boolean; joined: boolean; interior: boolean; centre: boolean; plain: string | null }): void {
    if (s.hover) p.dot(pt, { color: COLORS.hover, fill: COLORS.hover, width: 1 }, 8);
    if (s.lit) {
      p.dot(pt, { color: COLORS.selected, fill: COLORS.selected }, 4);
      return;
    }
    if (s.plain) {
      if (s.joined && !s.hover && !pt.explicit) return;
      p.dot(pt, { color: s.plain, fill: s.free ? COLORS.dotHole : s.plain }, s.free ? 3 : 2);
      return;
    }
    if (pt.projected) {
      p.dot(pt, { color: COLORS.projected, fill: COLORS.projected }, 3);
      return;
    }
    if (pt.fixed) {
      p.dot(pt, { color: COLORS.fixed, fill: COLORS.fixed }, 3);
      return;
    }
    if (s.interior) {
      p.dot(pt, { color: COLORS.interiorEdge, fill: COLORS.interiorFill }, 3);
      return;
    }
    // A joined point shows nothing [ref]; a loose one is white while free, solid once determined.
    if (s.joined && !s.hover) return;
    if (pt.explicit) {
      p.dot(pt, { color: COLORS.construction, fill: s.free ? COLORS.dotHole : COLORS.construction }, 2.5);
      return;
    }
    if (s.free) p.dot(pt, { color: COLORS.free, fill: COLORS.dotHole }, s.centre ? 2.5 : 3);
    else p.dot(pt, { color: COLORS.constrained, fill: COLORS.constrained }, 2);
  }

  private drawDimensions(p: Painter, sketch: Sketch, interactive: boolean): void {
    const { app } = this;
    const a = app.analysisOf(sketch.id);
    p.g.font = FONT;
    for (const d of Object.values(sketch.dimensions)) {
      if (interactive ? !app.annotationShown(sketch, d) : this.ownerHidden(sketch, d)) continue;
      const layout = layoutDimension(app.design, sketch, d, app.view);
      if (!layout) continue;
      drawDimension(p, layout, this.dimensionState(d, a.unsatisfied.has(d.id), interactive));
    }
  }

  private ownerHidden(sketch: Sketch, d: Dimension): boolean {
    const owner = ownerLayer(sketch, d);
    return owner !== null && !this.app.design.layers.some((l) => l.id === owner && l.visible);
  }

  private dimensionState(d: Dimension, bad: boolean, interactive: boolean): { color: string; bold?: boolean; halo?: string } {
    const { app } = this;
    if (bad || app.badNames.has(d.name)) return { color: COLORS.error };
    if (interactive && app.selection.has(d.id)) return { color: COLORS.selected, bold: true };
    if (interactive && app.hover?.id === d.id) return { color: COLORS.selected, halo: COLORS.hoverHalo };
    return { color: dimensionColor(d) };
  }

  private drawBadges(sketch: Sketch): void {
    const { app, g } = this;
    for (const b of this.layouts(sketch).badges) {
      const state = app.selection.has(b.constraint) ? 'selected' : app.hover?.id === b.constraint ? 'hover' : 'idle';
      drawBadge(g, b.type, b.x, b.y, state, { cross: b.cross, bad: b.cross && app.analysisOf(sketch.id).unsatisfied.has(b.constraint) });
    }
  }

  private drawInference(p: Painter): void {
    const { app, g } = this;
    const inf = app.inference;
    if (!inf) return;
    for (const guide of inf.guides) p.line(guide.a, guide.b, { color: COLORS.guide, width: 1, dash: [4, 4] });
    const at = app.view.toScreen(inf.pos);
    const cursor = app.view.toScreen(app.cursorWorld);
    drawInference(g, inf.kind, at, cursor);
  }
}
