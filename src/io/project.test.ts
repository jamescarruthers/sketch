import { describe, expect, it } from 'vitest';
import { addConstraint, addDimension, addLine, newDesign, newSketch } from '../model/document';
import type { Design } from '../model/types';
import { DESIGN_VERSION } from '../model/types';
import { PLANE_FRAMES } from '../model/frames';
import { createAutosave, deserialize, serialize, type AutosaveStorage } from './project';

const sample = (): Design => {
  const d = newDesign('Part');
  const s = newSketch(d);
  const l = addLine(d, s, { x: 0, y: 0 }, { x: 10, y: 0 });
  addConstraint(d, s, 'horizontal', [l.id]);
  addDimension(d, s, 'distance', [l.a, l.b], 10);
  return d;
};

const load = (d: unknown) => deserialize(JSON.stringify(d));

describe('project', () => {
  it('round trips', () => {
    const d = sample();
    const r = deserialize(serialize(d));
    expect(r).toEqual({ ok: true, design: d, warnings: [] });
  });
  it('rejects garbage', () => {
    expect(deserialize('not json').ok).toBe(false);
    expect(deserialize('[]').ok).toBe(false);
    expect(load({ version: 99 })).toMatchObject({ ok: false });
    expect(load({ ...sample(), units: 'furlong' })).toMatchObject({ ok: false });
    expect(load({ ...sample(), order: 5 })).toMatchObject({ ok: false });
  });
  it('rejects broken geometry', () => {
    const d = sample();
    const s = Object.values(d.sketches)[0];
    const c = Object.values(s.curves)[0];
    if (c.type === 'line') c.a = 'gone';
    const r = load(d);
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.error).toContain('gone');
  });
  it('rejects a point without a finite position', () => {
    const d = sample();
    const s = Object.values(d.sketches)[0];
    const p = Object.values(s.points)[0] as { x: unknown };
    p.x = 'nan';
    expect(load(d).ok).toBe(false);
  });
  it('drops dangling constraints with a warning', () => {
    const d = sample();
    const s = Object.values(d.sketches)[0];
    Object.values(s.constraints)[0].refs = ['ghost'];
    const r = load(d);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(Object.keys(Object.values(r.design.sketches)[0].constraints)).toEqual([]);
      expect(r.warnings.length).toBe(1);
    }
  });
  it('repairs nextId and the order', () => {
    const d = sample();
    d.nextId = 1;
    d.order = ['phantom'];
    const r = load(d);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.design.nextId).toBeGreaterThan(5);
      expect(r.design.order).toEqual(Object.keys(d.sketches));
    }
  });
  it('keeps references to reserved ids', () => {
    const d = sample();
    const s = Object.values(d.sketches)[0];
    const l = Object.values(s.curves)[0];
    if (l.type === 'line') addConstraint(d, s, 'coincident', [l.a, 'origin']);
    addConstraint(d, s, 'parallel', [l.id, 'axis-x']);
    const r = load(d);
    expect(r.ok && r.warnings).toEqual([]);
  });
});

describe('autosave', () => {
  const memory = (): AutosaveStorage & { data: Map<string, string> } => {
    const data = new Map<string, string>();
    return {
      data,
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => void data.set(k, v),
      removeItem: (k) => void data.delete(k),
    };
  };
  const clock = () => {
    const q: { fn: () => void; live: boolean }[] = [];
    return {
      setTimer: (fn: () => void) => {
        const h = { fn, live: true };
        q.push(h);
        return h;
      },
      clearTimer: (h: unknown) => {
        (h as { live: boolean }).live = false;
      },
      fire() {
        for (const h of q.splice(0)) if (h.live) h.fn();
      },
    };
  };
  it('debounces to the latest design', () => {
    const st = memory();
    const c = clock();
    const a = createAutosave(st, { setTimer: c.setTimer, clearTimer: c.clearTimer });
    const d = sample();
    a.schedule({ ...d, name: 'one' });
    a.schedule({ ...d, name: 'two' });
    expect(st.data.size).toBe(0);
    c.fire();
    expect(a.load()?.name).toBe('two');
  });
  it('flushes on demand and clears', () => {
    const st = memory();
    const c = clock();
    const a = createAutosave(st, { setTimer: c.setTimer, clearTimer: c.clearTimer });
    a.schedule(sample());
    a.flush();
    expect(a.load()?.name).toBe('Part');
    c.fire();
    a.clear();
    expect(a.load()).toBeNull();
  });
  it('keeps what could not be restored: a copy aside, and nothing empty over it', () => {
    const st = memory();
    const c = clock();
    const a = createAutosave(st, { setTimer: c.setTimer, clearTimer: c.clearTimer });
    expect(a.stored()).toBe(false);
    a.schedule(sample());
    a.flush();
    expect(a.stored()).toBe(true);
    const text = st.getItem('sketch.autosave');
    a.keep();
    const kept = (): (string | null)[] => a.rescued.list().map((e) => a.rescued.read(e.id));
    expect(kept()).toEqual([text]);
    a.schedule(newDesign('Empty'));
    a.flush();
    expect(st.getItem('sketch.autosave')).toBe(text);
    // Real work may go on, the copy aside is what is left of the old.
    a.schedule({ ...sample(), name: 'Later' });
    a.flush();
    expect(a.load()?.name).toBe('Later');
    expect(kept()).toEqual([text]);
  });
  it('with no room for a copy, nothing at all is saved over the only one', () => {
    const st = memory();
    const c = clock();
    const a = createAutosave(st, { setTimer: c.setTimer, clearTimer: c.clearTimer });
    a.schedule(sample());
    a.flush();
    const text = st.getItem('sketch.autosave');
    const set = st.setItem.bind(st);
    st.setItem = () => { throw new Error('full'); };
    a.keep();
    st.setItem = set;
    a.schedule({ ...sample(), name: 'Later' });
    a.flush();
    expect(st.getItem('sketch.autosave')).toBe(text);
  });
  it('reports storage errors without throwing', () => {
    const st = memory();
    const c = clock();
    const errors: unknown[] = [];
    st.setItem = () => {
      throw new Error('quota');
    };
    const a = createAutosave(st, { setTimer: c.setTimer, clearTimer: c.clearTimer, onError: (e) => errors.push(e) });
    a.schedule(sample());
    c.fire();
    expect(errors.length).toBe(1);
  });
  it('treats a corrupt autosave as none', () => {
    const st = memory();
    st.data.set('sketch.autosave', '{broken');
    expect(createAutosave(st).load()).toBeNull();
  });
});

describe('layers', () => {
  const v1 = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    version: 1, name: 'Old', order: ['s1'], parameters: [], units: 'mm', nextId: 20,
    sketches: {
      s1: {
        id: 's1', name: 'Sketch1', plane: 'XY', visible: true,
        points: {
          p1: { id: 'p1', x: 0, y: 0, owner: 'l1' }, p2: { id: 'p2', x: 5, y: 0, owner: 'l1' }, p3: { id: 'p3', x: 9, y: 9, explicit: true },
        },
        curves: { l1: { id: 'l1', type: 'line', lineType: 'normal', a: 'p1', b: 'p2' } },
        constraints: {}, dimensions: {}, features: {},
      },
    },
    ...extra,
  });

  it('migrates a version 1 design onto a default Layer 1', () => {
    const r = deserialize(JSON.stringify(v1()));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warnings).toEqual([]);
    // On through version 2 to the current one: the plane's name becomes its frame.
    expect(r.design.version).toBe(DESIGN_VERSION);
    expect(r.design.sketches.s1.frame).toEqual(PLANE_FRAMES.XY);
    expect(r.design.layers.map((l) => l.name)).toEqual(['Layer 1']);
    expect(r.design.activeLayer).toBe(r.design.layers[0].id);
    const s = r.design.sketches.s1;
    expect(s.curves.l1.layer).toBe(r.design.activeLayer);
    expect(s.points.p3.layer).toBe(r.design.activeLayer);
    expect(s.points.p1.layer).toBeUndefined();
  });

  it('round-trips layers, and saved designs are version 3', () => {
    const d = newDesign();
    d.layers.push({ id: 'ly9', name: 'Under', color: '#123456', visible: false, locked: true });
    const r = deserialize(serialize(d));
    expect(r).toMatchObject({ ok: true, design: { version: 3, layers: d.layers, activeLayer: d.activeLayer } });
  });

  const good = (): Record<string, unknown> => ({
    version: 2, name: 'N', order: [], parameters: [], units: 'mm', nextId: 1, sketches: {},
    layers: [{ id: 'a', name: 'A', color: '#000000', visible: true, locked: false }], activeLayer: 'a',
  });

  it.each([
    ['no layers', { layers: [] }],
    ['a layers field of the wrong type', { layers: 'x' }],
    ['a repeated id', { layers: [good().layers, good().layers].flat() }],
    ['a bad colour', { layers: [{ id: 'a', name: 'A', color: 'red', visible: true, locked: false }] }],
    ['no name', { layers: [{ id: 'a', name: ' ', color: '#000000', visible: true, locked: false }] }],
    ['a non-boolean flag', { layers: [{ id: 'a', name: 'A', color: '#000000', visible: 'yes', locked: false }] }],
    ['an unknown active layer', { activeLayer: 'zz' }],
  ])('rejects a version 2 file with %s', (_name, change) => {
    expect(deserialize(JSON.stringify({ ...good(), ...change }))).toMatchObject({ ok: false });
  });

  it('repairs a curve on an unknown layer, with a warning', () => {
    const raw = { ...v1(), version: 2, layers: [{ id: 'a', name: 'A', color: '#000000', visible: true, locked: false }], activeLayer: 'a' };
    const s = ((raw as Record<string, unknown>).sketches as Record<string, { curves: Record<string, { layer?: string }>; points: Record<string, { layer?: string }> }>).s1;
    s.curves.l1.layer = 'gone';
    s.points.p3.layer = 'a';
    const r = deserialize(JSON.stringify(raw));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.design.sketches.s1.curves.l1.layer).toBe('a');
    expect(r.warnings.join()).toContain('unknown layer');
  });
});
