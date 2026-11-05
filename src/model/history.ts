// Snapshot undo/redo. One entry per committed command; drags coalesce under a key.
import type { Design } from './types';

export interface HistoryOptions {
  /** Maximum undo depth. Default 200. */
  limit?: number;
  /** Commits with the same coalesce key within this many ms merge. Default 800. */
  coalesceMs?: number;
  now?: () => number;
}

export interface CommitOptions {
  /** Consecutive commits with the same key replace each other, e.g. "drag" or "dim:d3". */
  coalesce?: string;
  label?: string;
}

interface Entry { design: Design; key?: string; at: number; label?: string }

export class History {
  private past: Entry[] = [];
  private future: Entry[] = [];
  private present: Entry;
  private marked: Entry | null = null;
  private readonly limit: number;
  private readonly coalesceMs: number;
  private readonly now: () => number;
  private counter = 0;

  constructor(initial: Design, opts: HistoryOptions = {}) {
    this.limit = opts.limit ?? 200;
    this.coalesceMs = opts.coalesceMs ?? 800;
    this.now = opts.now ?? Date.now;
    this.present = { design: structuredClone(initial), at: this.now() };
  }

  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }
  /** Changes with every commit, undo, redo and rewind, and never repeats: two equal values mean no change between. */
  get rev(): number { return this.counter; }
  /** Label of the command undo would revert. */
  get undoLabel(): string | undefined { return this.present.label; }

  /** Record the design as the new present. Clears redo. */
  commit(design: Design, opts: CommitOptions = {}): void {
    const at = this.now();
    const merge = opts.coalesce !== undefined && this.present.key === opts.coalesce
      && at - this.present.at <= this.coalesceMs && this.past.length > 0;
    const entry: Entry = { design: structuredClone(design), key: opts.coalesce, at, label: opts.label };
    if (!merge) {
      this.past.push(this.present);
      if (this.past.length > this.limit) this.past.shift();
    }
    this.present = entry;
    this.future = [];
    this.counter++;
  }

  /** Where the undo stack stands, to fold what follows into one step with `squash`. */
  mark(): number {
    // What follows is new work, whatever it is called: it must not merge into the step before the mark.
    this.present.key = undefined;
    this.marked = this.present;
    return this.past.length;
  }

  /** Back to the last mark, as if nothing since had happened. Returns a copy the caller owns, or null if nothing had. */
  rewind(): Design | null {
    const to = this.marked;
    if (!to || to === this.present) return null;
    // By the entry and not its index: at the depth limit the oldest step goes with every commit.
    this.past.length = Math.max(0, this.past.indexOf(to));
    this.present = to;
    this.counter++;
    return structuredClone(to.design);
  }

  /** Everything since `mark` becomes a single undo step. An undo back past the mark leaves it alone. */
  squash(mark: number): void {
    if (this.past.length > mark + 1) this.past.length = mark + 1;
  }

  /** Step back; returns a copy the caller owns, or null at the start. */
  undo(): Design | null {
    const prev = this.past.pop();
    if (!prev) return null;
    this.future.push(this.present);
    this.present = prev;
    this.counter++;
    return structuredClone(prev.design);
  }

  /** Step forward; returns a copy the caller owns, or null at the end. */
  redo(): Design | null {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push(this.present);
    this.present = next;
    this.counter++;
    return structuredClone(next.design);
  }

  /** A copy of the present state. */
  current(): Design { return structuredClone(this.present.design); }

  /** Forget everything and restart from a design, e.g. after opening a file. */
  reset(design: Design): void {
    this.past = [];
    this.future = [];
    this.present = { design: structuredClone(design), at: this.now() };
  }
}
