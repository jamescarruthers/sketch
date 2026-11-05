// The selection is an ordered set of ids: points, curves, constraints and dimensions share one id space.
import type { Id } from '../model/types';

export class Selection {
  private items: Id[] = [];
  private listeners: (() => void)[] = [];

  onChange(fn: () => void): void {
    this.listeners.push(fn);
  }

  private changed(): void {
    for (const fn of this.listeners) fn();
  }

  get size(): number {
    return this.items.length;
  }

  /** In selection order: the first item is the reference for constraint tools. */
  ids(): Id[] {
    return [...this.items];
  }

  has(id: Id): boolean {
    return this.items.includes(id);
  }

  set(ids: Iterable<Id>): void {
    const next = [...new Set(ids)];
    if (next.length === this.items.length && next.every((id, i) => id === this.items[i])) return;
    this.items = next;
    this.changed();
  }

  add(ids: Iterable<Id>): void {
    this.set([...this.items, ...ids]);
  }

  toggle(id: Id): void {
    this.set(this.has(id) ? this.items.filter((i) => i !== id) : [...this.items, id]);
  }

  clear(): void {
    this.set([]);
  }

  /** Drop ids that no longer exist, e.g. after undo. */
  retain(exists: (id: Id) => boolean): void {
    this.set(this.items.filter(exists));
  }
}
