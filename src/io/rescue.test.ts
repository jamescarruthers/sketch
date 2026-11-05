import { describe, expect, it } from 'vitest';
import { createAutosave, type AutosaveStorage } from './project';
import { createRescueStore, RESCUE_LIMIT, RESCUE_KEY } from './rescue';

/** A Storage-shaped store with a quota, counted in characters of keys and values like a browser's. */
const memory = (quota = Infinity): AutosaveStorage & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  const used = (): number => [...data].reduce((n, [k, v]) => n + k.length + v.length, 0);
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem(k, v) {
      const was = data.get(k);
      if (used() - (was === undefined ? 0 : k.length + was.length) + k.length + v.length > quota) throw new Error('QuotaExceededError');
      data.set(k, v);
    },
    removeItem: (k) => void data.delete(k),
  };
};

const text = (n: number, size = 10): string => `${n}:`.padEnd(size, 'x');

describe('rescued copies', () => {
  it('keeps several, newest first, each with a time and a size', () => {
    const st = memory();
    const r = createRescueStore(st);
    for (let i = 1; i <= 3; i++) expect(r.add(text(i, 20), { at: 1000 * i }).ok).toBe(true);
    const list = r.list();
    expect(list.map((e) => e.at)).toEqual([3000, 2000, 1000]);
    expect(list.every((e) => e.size === 20)).toBe(true);
    expect(r.read(list[0].id)).toBe(text(3, 20));
    expect(r.read(list[2].id)).toBe(text(1, 20));
  });

  it('never overwrites one: a second failure is a second copy', () => {
    const r = createRescueStore(memory());
    const a = r.add('first', { at: 1 });
    const b = r.add('second', { at: 2 });
    if (!a.ok || !b.ok) throw new Error('not kept');
    expect(a.id).not.toBe(b.id);
    expect(r.read(a.id)).toBe('first');
    expect(r.read(b.id)).toBe('second');
  });

  it('does not keep the same text twice', () => {
    const r = createRescueStore(memory());
    r.add('same', { at: 1 });
    const again = r.add('same', { at: 2 });
    expect(again.ok && again.duplicate).toBe(true);
    expect(r.list()).toHaveLength(1);
  });

  it(`holds at most ${RESCUE_LIMIT}: the sixth drops the oldest, and only that one`, () => {
    const st = memory();
    const r = createRescueStore(st);
    for (let i = 1; i <= RESCUE_LIMIT; i++) r.add(text(i), { at: i });
    const oldest = r.list()[RESCUE_LIMIT - 1];
    const sixth = r.add(text(6), { at: 6 });
    expect(sixth.ok && sixth.dropped?.id).toBe(oldest.id);
    expect(r.list().map((e) => e.at)).toEqual([6, 5, 4, 3, 2]);
    expect(st.getItem(`${RESCUE_KEY}.${oldest.id}`)).toBeNull();
  });

  it('with the store full, drops the oldest only if the new one then fits, and loses nothing if it does not', () => {
    const st = memory(1500);
    const r = createRescueStore(st);
    for (let i = 1; i <= RESCUE_LIMIT; i++) expect(r.add(text(i, 200), { at: i }).ok).toBe(true);
    const before = new Map(st.data);
    const big = r.add(text(9, 1400), { at: 9 });
    expect(big).toEqual({ ok: false, reason: 'full' });
    expect(new Map(st.data)).toEqual(before);
    expect(r.list().map((e) => e.at)).toEqual([5, 4, 3, 2, 1]);
    // One that fits once the oldest is gone is kept, and the oldest is what went.
    const fits = r.add(text(8, 250), { at: 8 });
    expect(fits.ok).toBe(true);
    expect(r.list().map((e) => e.at)).toEqual([8, 5, 4, 3, 2]);
  });

  it('with no room and fewer than the limit, keeps what is there and says so', () => {
    const st = memory(600);
    const r = createRescueStore(st);
    expect(r.add(text(1, 200), { at: 1 }).ok).toBe(true);
    expect(r.add(text(2, 200), { at: 2 }).ok).toBe(true);
    const before = new Map(st.data);
    expect(r.add(text(3, 400), { at: 3 })).toEqual({ ok: false, reason: 'full' });
    expect(new Map(st.data)).toEqual(before);
  });

  it('removes one and nothing else', () => {
    const r = createRescueStore(memory());
    r.add('a', { at: 1 });
    r.add('b', { at: 2 });
    const [b, a] = r.list();
    r.remove(b.id);
    expect(r.list().map((e) => e.id)).toEqual([a.id]);
    expect(r.read(b.id)).toBeNull();
    expect(r.read(a.id)).toBe('a');
  });

  it('survives an index that is not readable', () => {
    const st = memory();
    st.setItem(RESCUE_KEY, '{broken');
    const r = createRescueStore(st);
    expect(r.list()).toEqual([]);
    expect(r.add('x', { at: 1 }).ok).toBe(true);
  });

  it('moves the old single copy into the list, oldest, and removes it', () => {
    const st = memory();
    st.setItem('sketch.autosave.rescued', 'legacy');
    const r = createRescueStore(st);
    r.add('newer', { at: 5 });
    expect(r.migrate('sketch.autosave.rescued')).toEqual({ ok: true });
    expect(st.getItem('sketch.autosave.rescued')).toBeNull();
    const list = r.list();
    expect(list).toHaveLength(2);
    expect(r.read(list[1].id)).toBe('legacy');
    expect(list[1].at).toBeNull();
  });

  it('leaves the old copy where it is when there is no room to move it', () => {
    const st = memory(300);
    st.setItem('sketch.autosave.rescued', 'x'.repeat(250));
    const r = createRescueStore(st);
    expect(r.migrate('sketch.autosave.rescued')).toEqual({ ok: false, reason: 'full' });
    expect(st.getItem('sketch.autosave.rescued')).toBe('x'.repeat(250));
  });
});

describe('autosave keep', () => {
  it('copies into the list each time, so a second failure keeps the first', () => {
    const st = memory();
    const a = createAutosave(st);
    st.setItem('sketch.autosave', 'one');
    const first = a.keep();
    st.setItem('sketch.autosave', 'two');
    const second = a.keep();
    expect(first?.ok && second?.ok).toBe(true);
    const list = a.rescued.list();
    expect(list.map((e) => a.rescued.read(e.id))).toEqual(['two', 'one']);
  });

  it('with no room for a copy, says so and writes nothing over the original', () => {
    const st = memory();
    const a = createAutosave(st);
    st.setItem('sketch.autosave', 'only copy');
    const set = st.setItem.bind(st);
    st.setItem = () => { throw new Error('full'); };
    expect(a.keep()).toEqual({ ok: false, reason: 'full' });
    st.setItem = set;
    a.schedule({ version: 4, name: 'Later', sketches: { s: {} } } as never);
    a.flush();
    expect(st.getItem('sketch.autosave')).toBe('only copy');
  });
});
