// Save and load. A .sketch.json file is a Design, validated on the way in.
import type { Curve, Design, Id, Layer, Plane, Sketch } from '../model/types';
import { DESIGN_VERSION } from '../model/types';
import { isFrame, planeFrame, tidyFrame } from '../model/frames';
import { expressionDeps } from '../model/expressions';
import { claimName, curvePoints, defaultLayer, isReservedId } from '../model/document';
import { pointLayer, stampCrossLayer } from '../model/layers';
import { createRescueStore, type RescueResult, type RescueStore } from './rescue';

/**
 * A short fingerprint of a design, to tell a stored design from the one last saved to a file across a reload.
 * Two designs with the same fingerprint are taken as the same, so it is 53 bits (cyrb53) and not a checksum.
 */
export function fingerprint(design: Design): string {
  const text = JSON.stringify(design);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)}.${text.length}`;
}

/** Pretty JSON for a project file. */
export function serialize(design: Design): string {
  return JSON.stringify(design, null, 2);
}

export type LoadResult =
  | { ok: true; design: Design; warnings: string[] }
  | { ok: false; error: string };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isFinitePoint = (v: unknown): boolean => isObject(v) && Number.isFinite(v.x) && Number.isFinite(v.y);
const UNITS = new Set(['mm', 'cm', 'm', 'in', 'ft']);
const CURVE_TYPES = new Set(['line', 'circle', 'arc', 'ellipse', 'ellipticalArc', 'fitSpline', 'controlSpline', 'conic', 'text']);

function checkSketch(sketch: Sketch, warnings: string[]): string | null {
  for (const group of ['points', 'curves', 'constraints', 'dimensions', 'features'] as const) {
    if (!isObject(sketch[group])) return `Sketch ${sketch.id}: missing ${group}`;
  }
  for (const [id, p] of Object.entries(sketch.points)) {
    if (!isFinitePoint(p)) return `Point ${id} has no valid position`;
  }
  for (const [id, c] of Object.entries(sketch.curves)) {
    if (!isObject(c) || !CURVE_TYPES.has((c as Curve).type)) return `Curve ${id} has an unknown type`;
    for (const pid of curvePoints(c)) {
      if (!isReservedId(pid) && !sketch.points[pid]) return `Curve ${id} references missing point ${pid}`;
    }
    if (c.type === 'circle' && !(Number.isFinite(c.r) && c.r >= 0)) return `Circle ${id} has an invalid radius`;
    if (c.type === 'conic' && !(c.rho > 0 && c.rho < 1)) return `Conic ${id} has rho outside (0, 1)`;
    if (c.type === 'text' && c.path && !sketch.curves[c.path]) return `Text ${id} follows a missing curve`;
  }
  const known = (r: Id): boolean => isReservedId(r) || !!sketch.points[r] || !!sketch.curves[r] || r === 'major' || r === 'minor';
  for (const [id, k] of Object.entries(sketch.constraints)) {
    if (!Array.isArray(k.refs) || !k.refs.every(known)) {
      delete sketch.constraints[id];
      warnings.push(`Dropped constraint ${id} with dangling references`);
    }
  }
  for (const [id, m] of Object.entries(sketch.dimensions)) {
    if (!Array.isArray(m.refs) || !m.refs.every(known) || !Number.isFinite(m.value)) {
      delete sketch.dimensions[id];
      warnings.push(`Dropped dimension ${id} with dangling references`);
    }
  }
  return null;
}

const COLOR = /^#[0-9a-f]{6}$/i;

function layerProblem(raw: unknown, seen: Set<Id>): string | null {
  if (!isObject(raw)) return 'A layer is malformed';
  const l = raw as unknown as Layer;
  if (typeof l.id !== 'string' || !l.id || seen.has(l.id)) return 'A layer has a missing or repeated id';
  seen.add(l.id);
  if (typeof l.name !== 'string' || !l.name.trim()) return `Layer ${l.id} has no name`;
  if (typeof l.color !== 'string' || !COLOR.test(l.color)) return `Layer ${l.name} has an invalid colour`;
  if (typeof l.visible !== 'boolean' || typeof l.locked !== 'boolean') return `Layer ${l.name} has invalid flags`;
  return null;
}

/** A version 1 design has no layers: everything goes on a default "Layer 1". */
function migrateV1(raw: Record<string, unknown>): void {
  const layer = defaultLayer();
  raw.layers = [layer];
  raw.activeLayer = layer.id;
  raw.version = 2;
  if (!isObject(raw.sketches)) return;
  for (const s of Object.values(raw.sketches)) {
    if (!isObject(s) || !isObject(s.curves) || !isObject(s.points)) continue;
    for (const c of Object.values(s.curves)) if (isObject(c)) c.layer = layer.id;
    for (const p of Object.values(s.points)) if (isObject(p) && !p.owner) p.layer = layer.id;
  }
}

const PLANES = new Set(['XY', 'YZ', 'ZX']);

/** Before version 3 a sketch named its origin plane: it becomes that plane's frame. */
function migrateV2(raw: Record<string, unknown>, warnings: string[]): void {
  raw.version = DESIGN_VERSION;
  if (!isObject(raw.sketches)) return;
  for (const s of Object.values(raw.sketches)) {
    if (!isObject(s)) continue;
    const plane = PLANES.has(s.plane as string) ? (s.plane as Plane) : 'XY';
    if (plane !== s.plane) warnings.push(`Sketch ${String(s.id)} had an unknown plane, and is on XY`);
    s.frame = planeFrame(plane);
    delete s.plane;
  }
}

/** The layers themselves are a hard error; a curve on an unknown layer is repaired onto the active one. */
function checkLayers(design: Design, warnings: string[]): string | null {
  if (!Array.isArray(design.layers) || design.layers.length === 0) return 'A design needs at least one layer';
  const seen = new Set<Id>();
  for (const l of design.layers) {
    const problem = layerProblem(l, seen);
    if (problem) return problem;
  }
  if (!seen.has(design.activeLayer)) return `The active layer ${String(design.activeLayer)} does not exist`;
  for (const s of Object.values(design.sketches)) {
    for (const c of Object.values(s.curves)) {
      if (seen.has(c.layer)) continue;
      warnings.push(`Moved curve ${c.id} from unknown layer ${String(c.layer)} to the active layer`);
      c.layer = design.activeLayer;
    }
    for (const p of Object.values(s.points)) {
      const l = pointLayer(s, p);
      if ((p.explicit || !p.owner) && (l === null || !seen.has(l))) {
        warnings.push(`Moved point ${p.id} to the active layer`);
        p.layer = design.activeLayer;
      }
    }
    stampCrossLayer(s, design.activeLayer);
  }
  return null;
}

/** nextId must clear every stored id, or new geometry could collide after a hand edit. */
function repairNextId(design: Design): void {
  let max = 0;
  const scan = (id: string): void => {
    const m = /(\d+)$/.exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  };
  for (const s of Object.values(design.sketches)) {
    scan(s.id);
    for (const group of [s.points, s.curves, s.constraints, s.dimensions, s.features]) Object.keys(group).forEach(scan);
  }
  if (!Number.isInteger(design.nextId) || design.nextId <= max) design.nextId = max + 1;
  // A counter that cannot be read is dropped: the next name then starts past every name the file shows.
  const names = design.names as unknown;
  if (names !== undefined && !(isObject(names) && Number.isInteger(names.d) && Number.isInteger(names.p))) delete design.names;
  // What an expression asks for is taken, even if nothing has it: a new name must not answer it.
  for (const p of design.parameters) if (p.unit !== 'text') expressionDeps(p.expression).forEach((n) => claimName(design, n));
  for (const s of Object.values(design.sketches)) {
    for (const d of Object.values(s.dimensions)) expressionDeps(d.expression).forEach((n) => claimName(design, n));
  }
}

/** Parse and validate. Dangling constraints are dropped with a warning; broken geometry is an error. */
export function deserialize(text: string): LoadResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `Not valid JSON: ${(e as Error).message}` };
  }
  if (!isObject(raw)) return { ok: false, error: 'Not a sketch project' };
  if (raw.version !== 1 && raw.version !== 2 && raw.version !== DESIGN_VERSION) return { ok: false, error: `Unsupported project version ${String(raw.version)}` };
  if (typeof raw.name !== 'string') return { ok: false, error: 'Missing design name' };
  if (!isObject(raw.sketches) || !Array.isArray(raw.order) || !Array.isArray(raw.parameters)) {
    return { ok: false, error: 'Missing sketches, order or parameters' };
  }
  if (!UNITS.has(raw.units as string)) return { ok: false, error: `Unknown units ${String(raw.units)}` };
  const warnings: string[] = [];
  if (raw.version === 1) migrateV1(raw);
  if (raw.version === 2) migrateV2(raw, warnings);
  const design = raw as unknown as Design;
  for (const [id, s] of Object.entries(design.sketches)) {
    if (!isObject(s) || s.id !== id) return { ok: false, error: `Sketch ${id} is malformed` };
    if (!isFrame(s.frame)) return { ok: false, error: `Sketch ${id} has no valid plane` };
    s.frame = tidyFrame(s.frame);
    const problem = checkSketch(s, warnings);
    if (problem) return { ok: false, error: problem };
  }
  const layers = checkLayers(design, warnings);
  if (layers) return { ok: false, error: layers };
  design.order = design.order.filter((id) => {
    const present = !!design.sketches[id];
    if (!present) warnings.push(`Dropped missing sketch ${id} from the order`);
    return present;
  });
  for (const id of Object.keys(design.sketches)) if (!design.order.includes(id)) design.order.push(id);
  repairNextId(design);
  return { ok: true, design, warnings };
}

/** The part of Storage autosave needs, so tests and non-browser hosts can supply their own. */
export interface AutosaveStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface AutosaveOptions {
  key?: string;
  delayMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  /** Called when storage rejects a write, e.g. over quota. */
  onError?: (error: unknown) => void;
}

export interface Autosave {
  /** Save after the delay, replacing any save still pending. */
  schedule(design: Design): void;
  /** Write any pending save now. */
  flush(): void;
  /** Last autosaved design, or null when there is none or it no longer validates. */
  load(): Design | null;
  /** Whether anything is stored, readable or not. */
  stored(): boolean;
  /**
   * What is stored could not be restored: copy it into the rescued list, and save nothing empty over it. Null when
   * nothing is stored. If there is no room for the copy, nothing at all is saved over the original.
   */
  keep(): RescueResult | null;
  /** The copies put aside, here and on earlier runs. */
  readonly rescued: RescueStore;
  clear(): void;
}

/** Debounced autosave to any Storage-shaped store. */
export function createAutosave(storage: AutosaveStorage, opts: AutosaveOptions = {}): Autosave {
  const key = opts.key ?? 'sketch.autosave';
  const delay = opts.delayMs ?? 1000;
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  let handle: unknown = null;
  let pending: Design | null = null;
  let kept = false;
  let noCopy = false;
  const rescued = createRescueStore(storage);

  const write = (): void => {
    const d = pending;
    pending = null;
    handle = null;
    if (!d || noCopy || (kept && Object.keys(d.sketches).length === 0)) return;
    try {
      storage.setItem(key, JSON.stringify(d));
    } catch (e) {
      opts.onError?.(e);
    }
  };

  return {
    schedule(design) {
      pending = design;
      if (handle !== null) clearTimer(handle);
      handle = setTimer(write, delay);
    },
    flush() {
      if (handle !== null) clearTimer(handle);
      write();
    },
    rescued,
    keep() {
      kept = true;
      let text: string | null = null;
      try {
        text = storage.getItem(key);
      } catch {
        noCopy = true;
        return { ok: false, reason: 'full' };
      }
      if (!text) return null;
      const r = rescued.add(text);
      // No room for a copy, so the one there stays the only one: nothing is saved over it.
      if (!r.ok) noCopy = true;
      return r;
    },
    stored() {
      try {
        return !!storage.getItem(key);
      } catch {
        return false;
      }
    },
    load() {
      let text: string | null = null;
      try {
        text = storage.getItem(key);
      } catch {
        // Blocked storage reads as empty: the app starts on a new design.
        return null;
      }
      if (!text) return null;
      const r = deserialize(text);
      return r.ok ? r.design : null;
    },
    clear() {
      if (handle !== null) clearTimer(handle);
      handle = null;
      pending = null;
      storage.removeItem(key);
    },
  };
}
