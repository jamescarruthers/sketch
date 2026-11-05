// Rescued autosaves: copies of a stored design that could not be restored, kept so that nothing the user made is lost.
// A list of at most RESCUE_LIMIT, newest first, each copy under a key of its own and an index with its time and size.
// Nothing is ever overwritten. A write that fails leaves everything that was there as it was.
import type { AutosaveStorage } from './project';

export const RESCUE_LIMIT = 5;
/** The index. Each copy's text is at `${RESCUE_KEY}.${id}`. */
export const RESCUE_KEY = 'sketch.rescued';

export interface Rescued {
  id: string;
  /** When it was put aside, ms since 1970. Null for a copy moved here from the single-copy store, whose time was not kept. */
  at: number | null;
  /** Bytes of text. */
  size: number;
}

export type RescueResult =
  | { ok: true; id: string; /** The oldest copy, when the list was full and it made room. */ dropped: Rescued | null; /** An identical copy was already here. */ duplicate?: boolean }
  | { ok: false; reason: 'full' };

export interface RescueStore {
  /** Newest first. */
  list(): Rescued[];
  read(id: string): string | null;
  add(text: string, opts?: { at?: number }): RescueResult;
  remove(id: string): void;
  /** Move the single copy an older version kept at `key` into the list, as its oldest. It stays where it was unless it fits. */
  migrate(key: string): { ok: true } | { ok: false; reason: 'full' } | null;
}

const bytes = (text: string): number => new TextEncoder().encode(text).length;

export function createRescueStore(storage: AutosaveStorage, limit = RESCUE_LIMIT): RescueStore {
  const textKey = (id: string): string => `${RESCUE_KEY}.${id}`;

  const readIndex = (): Rescued[] => {
    let raw: unknown;
    try {
      const text = storage.getItem(RESCUE_KEY);
      raw = text ? JSON.parse(text) : [];
    } catch {
      return [];
    }
    if (!Array.isArray(raw)) return [];
    return raw.filter((e): e is Rescued => !!e && typeof e.id === 'string' && typeof e.size === 'number' && (e.at === null || typeof e.at === 'number'));
  };
  const writeIndex = (list: Rescued[]): void => storage.setItem(RESCUE_KEY, JSON.stringify(list));
  const read = (id: string): string | null => {
    try {
      return storage.getItem(textKey(id));
    } catch {
      return null;
    }
  };
  // An entry whose text has gone is not offered.
  const list = (): Rescued[] => readIndex().filter((e) => read(e.id) !== null);

  const freshId = (taken: Rescued[], at: number): string => {
    let n = 0;
    let id = `${at.toString(36)}`;
    while (taken.some((e) => e.id === id) || read(id) !== null) id = `${at.toString(36)}-${++n}`;
    return id;
  };

  /** Write `text` under a new id and put it in the index at `place`. Undoes itself on any failure. */
  const put = (text: string, at: number | null, base: Rescued[], place: 'front' | 'back', drop: Rescued[]): RescueResult => {
    const id = freshId(base, at ?? 0);
    const entry: Rescued = { id, at, size: bytes(text) };
    const next = place === 'front' ? [entry, ...base] : [...base, entry];
    const keep = next.filter((e) => !drop.includes(e));
    try {
      storage.setItem(textKey(id), text);
    } catch {
      return { ok: false, reason: 'full' };
    }
    try {
      writeIndex(keep);
    } catch {
      storage.removeItem(textKey(id));
      return { ok: false, reason: 'full' };
    }
    for (const gone of drop) storage.removeItem(textKey(gone.id));
    return { ok: true, id, dropped: drop[0] ?? null };
  };

  return {
    list,
    read,
    add(text, opts = {}) {
      const at = opts.at ?? Date.now();
      const have = list();
      const same = have.find((e) => read(e.id) === text);
      if (same) return { ok: true, id: same.id, dropped: null, duplicate: true };
      const over = have.length >= limit ? have.slice(limit - 1) : [];
      const first = put(text, at, have, 'front', over);
      if (first.ok || over.length === 0) return first;
      // Full both ways. The oldest goes only if that makes room, and comes back if it does not.
      const oldest = over[over.length - 1];
      const oldText = read(oldest.id);
      if (oldText === null) return first;
      storage.removeItem(textKey(oldest.id));
      const second = put(text, at, have, 'front', over);
      if (second.ok) return second;
      try {
        storage.setItem(textKey(oldest.id), oldText);
      } catch {
        // It was there a moment ago and the room it had is still free.
      }
      return second;
    },
    remove(id) {
      const rest = readIndex().filter((e) => e.id !== id);
      try {
        writeIndex(rest);
      } catch {
        return;
      }
      storage.removeItem(textKey(id));
    },
    migrate(key) {
      let old: string | null = null;
      try {
        old = storage.getItem(key);
      } catch {
        return null;
      }
      if (!old) return null;
      const have = list();
      const same = have.find((e) => read(e.id) === old);
      const done = same ? ({ ok: true } as const) : have.length >= limit ? ({ ok: false, reason: 'full' } as const) : put(old, null, have, 'back', []);
      if (!done.ok) return { ok: false, reason: 'full' };
      storage.removeItem(key);
      return { ok: true };
    },
  };
}
