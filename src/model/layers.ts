// Layers: which layer each thing is on, and what a solve may move. Geometry-free, like document.ts.
import type { Constraint, Design, Dimension, Id, Layer, Point, Sketch } from './types';
import { allocId, curvePoints } from './document';

/** Hues a new layer takes in turn, picked to stay apart from each other and from the Fusion status colours. */
export const LAYER_COLORS = ['#c2255c', '#0b7285', '#b08900', '#5c940d', '#364fc7', '#a0522d', '#087f5b', '#862e9c'];

export const layerById = (design: Design, id: Id): Layer | undefined => design.layers.find((l) => l.id === id);

export const activeLayerOf = (design: Design): Layer => layerById(design, design.activeLayer) ?? design.layers[0];

export function pointLayer(sketch: Sketch, p: Point): Id | null {
  const owner = p.owner ? sketch.curves[p.owner] : undefined;
  return owner?.layer ?? p.layer ?? null;
}

/** The layer of a constraint or dimension ref. The origin, the axes and 'major'/'minor' have none. */
export function refLayer(sketch: Sketch, id: Id): Id | null {
  const c = sketch.curves[id];
  if (c) return c.layer;
  const p = sketch.points[id];
  return p ? pointLayer(sketch, p) : null;
}

export function layersOfRefs(sketch: Sketch, refs: Id[]): Set<Id> {
  const out = new Set<Id>();
  for (const r of refs) {
    const l = refLayer(sketch, r);
    if (l) out.add(l);
  }
  return out;
}

/** The layer a constraint or dimension is shown on and deleted from. Null when it references only reserved ids. */
export function ownerLayer(sketch: Sketch, k: Constraint | Dimension): Id | null {
  if (k.dependentLayer) return k.dependentLayer;
  for (const r of k.refs) {
    const l = refLayer(sketch, r);
    if (l) return l;
  }
  return null;
}

/**
 * Keep `dependentLayer` true to the refs, after anything that could change them: a constraint that
 * spans layers and has no dependent takes `layer`, the one being edited, and one that no longer
 * spans them loses it. An existing dependent stays, so a link does not reverse when layers change.
 */
export function stampCrossLayer(sketch: Sketch, layer: Id): void {
  for (const group of [sketch.constraints, sketch.dimensions]) {
    for (const k of Object.values(group)) {
      const on = layersOfRefs(sketch, k.refs);
      if (on.size < 2) delete k.dependentLayer;
      else if (!k.dependentLayer || !on.has(k.dependentLayer)) k.dependentLayer = on.has(layer) ? layer : [...on][0];
    }
  }
}

/** Reference layer -> dependent layer, over the sketch's cross-layer constraints and dimensions. */
function followers(sketch: Sketch): Map<Id, Set<Id>> {
  const edges = new Map<Id, Set<Id>>();
  const add = (k: Constraint | Dimension): void => {
    if (!k.dependentLayer) return;
    for (const l of layersOfRefs(sketch, k.refs)) {
      if (l === k.dependentLayer) continue;
      const set = edges.get(l);
      if (set) set.add(k.dependentLayer);
      else edges.set(l, new Set([k.dependentLayer]));
    }
  };
  Object.values(sketch.constraints).forEach(add);
  Object.values(sketch.dimensions).forEach(add);
  return edges;
}

/** What a solve must not touch, and the constraints it must leave out. */
export interface Freeze {
  /** Hard fixed in the solver. */
  points: Set<Id>;
  curves: Set<Id>;
  /**
   * Links from something moving to a locked dependent. Left in, the locked side would pin the
   * reference, when the reference should move on and the link should go red.
   */
  broken: Set<Id>;
}

/**
 * The layers that may move: the active one, plus `also`, plus the transitive closure of what is
 * constrained to them. A locked layer stops the closure. Null when nothing needs freezing.
 */
export function planFreeze(design: Design, sketch: Sketch, also: Id[] = []): Freeze | null {
  const locked = new Set(design.layers.filter((l) => l.locked).map((l) => l.id));
  if (design.layers.length < 2 && locked.size === 0) return null;
  const edges = followers(sketch);
  const moving = new Set<Id>();
  const stack = [design.activeLayer, ...also];
  while (stack.length) {
    const l = stack.pop() as Id;
    if (locked.has(l) || moving.has(l)) continue;
    moving.add(l);
    stack.push(...(edges.get(l) ?? []));
  }
  const frozen = (l: Id | null): boolean => l !== null && !moving.has(l);
  const out: Freeze = { points: new Set(), curves: new Set(), broken: new Set() };
  for (const c of Object.values(sketch.curves)) {
    if (!frozen(c.layer)) continue;
    out.curves.add(c.id);
    for (const p of curvePoints(c)) out.points.add(p);
  }
  for (const p of Object.values(sketch.points)) if (frozen(pointLayer(sketch, p))) out.points.add(p.id);
  const check = (k: Constraint | Dimension): void => {
    if (!k.dependentLayer || !locked.has(k.dependentLayer)) return;
    for (const l of layersOfRefs(sketch, k.refs)) if (moving.has(l)) out.broken.add(k.id);
  };
  Object.values(sketch.constraints).forEach(check);
  Object.values(sketch.dimensions).forEach(check);
  return out.curves.size || out.points.size || out.broken.size ? out : null;
}

export function nextLayerName(design: Design): string {
  const used = new Set(design.layers.map((l) => l.name));
  for (let i = design.layers.length + 1; ; i++) if (!used.has(`Layer ${i}`)) return `Layer ${i}`;
}

/** A new layer at the top of the list, made active. */
export function addLayer(design: Design): Layer {
  const color = LAYER_COLORS[(design.layers.length - 1) % LAYER_COLORS.length];
  const layer: Layer = { id: allocId(design, 'ly'), name: nextLayerName(design), color, visible: true, locked: false };
  design.layers.unshift(layer);
  design.activeLayer = layer.id;
  return layer;
}

/** The layer below in the list, or above for the bottom one. Null for the last layer. */
export function layerBelow(design: Design, id: Id): Layer | null {
  const i = design.layers.findIndex((l) => l.id === id);
  if (i < 0 || design.layers.length < 2) return null;
  return design.layers[i + 1] ?? design.layers[i - 1];
}

/** Delete a layer: its geometry goes to the layer below, across every sketch. */
export function removeLayer(design: Design, id: Id): boolean {
  const into = layerBelow(design, id);
  if (!into) return false;
  for (const sketch of Object.values(design.sketches)) {
    for (const c of Object.values(sketch.curves)) if (c.layer === id) c.layer = into.id;
    for (const p of Object.values(sketch.points)) if (p.layer === id) p.layer = into.id;
    for (const group of [sketch.constraints, sketch.dimensions]) {
      for (const k of Object.values(group)) if (k.dependentLayer === id) k.dependentLayer = into.id;
    }
    stampCrossLayer(sketch, into.id);
  }
  design.layers = design.layers.filter((l) => l.id !== id);
  if (design.activeLayer === id) design.activeLayer = into.id;
  return true;
}

/**
 * Whatever has to share a layer with `ids`: a frame's edges and its text, a text and the path it
 * follows, an offset's sources and outputs. Pieces apart could move on a locked layer.
 */
function moveClosure(sketch: Sketch, ids: Id[]): Set<Id> {
  const out = new Set<Id>();
  const stack = [...ids];
  while (stack.length) {
    const id = stack.pop() as Id;
    if (out.has(id)) continue;
    const p = sketch.points[id];
    if (p?.owner && sketch.curves[p.owner]) {
      stack.push(p.owner);
      continue;
    }
    out.add(id);
    const c = sketch.curves[id];
    if (!c) continue;
    if (c.type === 'line' && c.frameOf) stack.push(c.frameOf);
    if (c.type === 'text' && c.path) stack.push(c.path);
    for (const o of Object.values(sketch.curves)) {
      if ((o.type === 'line' && o.frameOf === id) || (o.type === 'text' && o.path === id)) stack.push(o.id);
    }
    for (const f of Object.values(sketch.features)) {
      if (f.type === 'offset' && (f.sources.includes(id) || f.outputs.includes(id))) stack.push(...f.sources, ...f.outputs);
    }
  }
  return out;
}

/** Move curves and loose points to a layer. Returns what moved. */
export function moveToLayer(sketch: Sketch, ids: Id[], to: Id): Id[] {
  const moved: Id[] = [];
  for (const id of moveClosure(sketch, ids)) {
    const c = sketch.curves[id];
    const p = sketch.points[id];
    if (c && c.layer !== to) {
      c.layer = to;
      moved.push(id);
    } else if (!c && p && !p.owner && p.layer !== to) {
      p.layer = to;
      moved.push(id);
    }
  }
  return moved;
}
