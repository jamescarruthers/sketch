import { describe, expect, it } from 'vitest';
import { newDesign } from './document';
import { History } from './history';

describe('history', () => {
  it('rewinds to a mark as if nothing had happened, and a mark is the end of a coalescing run', () => {
    let t = 0;
    const d = newDesign('a');
    const h = new History(d, { now: () => t });
    h.commit(newDesign('b'), { coalesce: 'k' });
    const mark = h.mark();
    t += 1;
    h.commit(newDesign('c'), { coalesce: 'k' });
    h.commit(newDesign('d'));
    expect(h.rewind()?.name).toBe('b');
    expect(h.current().name).toBe('b');
    expect(h.mark()).toBe(mark);
    expect(h.canRedo).toBe(false);
    expect(h.rewind()).toBeNull();
    expect(h.undo()?.name).toBe('a');
  });

  it('rewinds at the depth limit, and past it', () => {
    const h = new History(newDesign('0'), { limit: 3 });
    for (const n of ['1', '2', '3', '4']) h.commit(newDesign(n));
    h.mark();
    h.commit(newDesign('5'));
    expect(h.rewind()?.name).toBe('4');
    expect(h.undo()?.name).toBe('3');
    h.mark();
    for (const n of ['a', 'b', 'c', 'd', 'e']) h.commit(newDesign(n));
    expect(h.rewind()?.name).toBe('3');
    expect(h.canUndo).toBe(false);
  });

  it('undoes and redoes committed snapshots', () => {
    const d = newDesign('a');
    const h = new History(d);
    d.name = 'b';
    h.commit(d);
    d.name = 'c';
    h.commit(d);
    expect(h.undo()?.name).toBe('b');
    expect(h.undo()?.name).toBe('a');
    expect(h.undo()).toBeNull();
    expect(h.redo()?.name).toBe('b');
    expect(h.canRedo).toBe(true);
  });
  it('a new commit clears redo', () => {
    const d = newDesign('a');
    const h = new History(d);
    d.name = 'b';
    h.commit(d);
    h.undo();
    d.name = 'x';
    h.commit(d);
    expect(h.canRedo).toBe(false);
  });
  it('coalesces commits with the same key inside the window', () => {
    let t = 0;
    const d = newDesign('a');
    const h = new History(d, { now: () => t });
    for (const n of ['1', '2', '3']) {
      t += 10;
      d.name = n;
      h.commit(d, { coalesce: 'drag' });
    }
    expect(h.undo()?.name).toBe('a');
    t += 10;
    d.name = '4';
    h.commit(d, { coalesce: 'drag' });
    t += 5000;
    d.name = '5';
    h.commit(d, { coalesce: 'drag' });
    expect(h.undo()?.name).toBe('4');
  });
  it('is isolated from later mutation', () => {
    const d = newDesign('a');
    const h = new History(d);
    d.name = 'mutated';
    expect(h.current().name).toBe('a');
  });
  it('enforces the depth limit', () => {
    const d = newDesign('0');
    const h = new History(d, { limit: 2 });
    for (const n of ['1', '2', '3']) { d.name = n; h.commit(d); }
    h.undo();
    expect(h.undo()?.name).toBe('1');
    expect(h.undo()).toBeNull();
  });
});
