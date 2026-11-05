import { beforeEach, describe, expect, it } from 'vitest';
import { NOTCH_PX, PAIR_MS, PINCH_GAIN, QUIET_MS, WHEEL_GAIN, WheelGestures, type WheelAction, type WheelInput } from './wheel';

/** A clock the tests move by hand, so no test waits for real time. */
class Clock {
  now = 0;
  private timers: { at: number; fn: () => void; id: number }[] = [];
  private next = 1;

  set = (fn: () => void, ms: number): number => {
    const id = this.next++;
    this.timers.push({ at: this.now + ms, fn, id });
    return id;
  };

  clear = (id: unknown): void => {
    this.timers = this.timers.filter((t) => t.id !== id);
  };

  /** Move to `t`, running every timer that falls due on the way. */
  to(t: number): void {
    for (;;) {
      const due = this.timers.filter((x) => x.at <= t).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      this.timers = this.timers.filter((x) => x !== due);
      this.now = due.at;
      due.fn();
    }
    this.now = t;
  }
}

let clock: Clock;
let actions: WheelAction[];
let g: WheelGestures;
const AT = { x: 300, y: 200 };

beforeEach(() => {
  clock = new Clock();
  actions = [];
  g = new WheelGestures((a) => actions.push(a), clock);
});

/** One event at `t` ms, the way a browser would give it. */
function ev(t: number, dy: number, rest: Partial<WheelInput> = {}): void {
  clock.to(t);
  g.feed({ deltaX: 0, deltaY: dy, deltaMode: 0, ctrlKey: false, shiftKey: false, timeStamp: t, ...rest }, AT);
}

const zooms = (): number[] => actions.flatMap((a) => (a.kind === 'zoom' ? [a.factor] : []));
const pans = (): { dx: number; dy: number }[] => actions.flatMap((a) => (a.kind === 'pan' ? [{ dx: a.dx, dy: a.dy }] : []));
const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

describe('a mouse wheel zooms', () => {
  it('on a whole notch of 100 px, at once, by the gain it always had', () => {
    ev(0, -100);
    expect(actions).toEqual([{ kind: 'zoom', factor: Math.exp(100 * WHEEL_GAIN), at: AT }]);
  });

  it('on the notches of a scaled display: 80, 66.67 and 50 px, fractional or not', () => {
    ev(0, 80);
    ev(300, 100 / 1.5);
    ev(600, -50);
    expect(zooms()).toHaveLength(3);
    expect(pans()).toEqual([]);
  });

  it('on the line steps Firefox gives a wheel, 16 px a line', () => {
    ev(0, 3, { deltaMode: 1 });
    expect(zooms()).toEqual([Math.exp(-3 * 16 * WHEEL_GAIN)]);
  });

  it('and keeps the Playwright wheel, whole steps of 120 and up, as before', () => {
    for (const [i, d] of [-120, -400, 350, 900, 1400].entries()) ev(i * 300, d);
    expect(zooms()).toEqual([-120, -400, 350, 900, 1400].map((d) => Math.exp(-d * WHEEL_GAIN)));
  });

  it('on one small whole step on its own, once nothing follows it: unsure, so a notch', () => {
    ev(0, 4);
    expect(actions).toEqual([]);
    clock.to(PAIR_MS - 1);
    expect(actions).toEqual([]);
    clock.to(PAIR_MS);
    expect(zooms()).toEqual([Math.exp(-4 * WHEEL_GAIN)]);
    expect(pans()).toEqual([]);
  });

  it('on small whole steps a wheel gives, spaced out, however many follow', () => {
    for (let i = 0; i < 6; i++) ev(i * 90, 8);
    clock.to(1000);
    expect(zooms()).toHaveLength(6);
    expect(pans()).toEqual([]);
  });

  it('and ignores a sideways wheel tilt that shift makes of it', () => {
    ev(0, 0, { deltaX: 100, shiftKey: true });
    clock.to(1000);
    expect(actions).toEqual([]);
  });
});

describe('a two-finger drag pans', () => {
  it('as soon as a step has a sideways part, moving the content with the fingers', () => {
    ev(0, 3, { deltaX: 12 });
    expect(pans()).toEqual([{ dx: -12, dy: -3 }]);
    expect(zooms()).toEqual([]);
  });

  it('as soon as a step is fractional and smaller than a notch', () => {
    ev(0, 2.5);
    ev(8, -0.25);
    expect(pans()).toEqual([{ dx: 0, dy: -2.5 }, { dx: 0, dy: 0.25 }]);
  });

  it('on a vertical drag of whole small steps, from the first of them: the held step is not lost', () => {
    const steps = [1, 2, 3, 5, 8, 12, 17, 22, 26, 29, 31, 30, 27, 22, 16, 10, 5, 2, 1];
    steps.forEach((d, i) => ev(i * 8, d));
    clock.to(2000);
    expect(zooms()).toEqual([]);
    expect(sum(pans().map((p) => p.dy))).toBe(-sum(steps));
    expect(pans()).toHaveLength(steps.length);
    // The first is the first.
    expect(pans()[0]).toEqual({ dx: 0, dy: -1 });
  });

  it('when its first two steps are whole and small, the second 16 ms behind the first', () => {
    ev(0, -2);
    ev(16, -3);
    expect(pans()).toEqual([{ dx: 0, dy: 2 }, { dx: 0, dy: 3 }]);
  });

  it('never from lines: a trackpad does not give them, so a step of lines zooms even with a sideways part', () => {
    ev(0, 2, { deltaMode: 1, deltaX: 1 });
    expect(pans()).toEqual([]);
    expect(zooms()).toHaveLength(1);
  });
});

describe('a burst is one gesture', () => {
  it('keeps panning when a step in the middle is as big as a notch', () => {
    ev(0, 2.5);
    ev(8, 6.5);
    ev(16, 120);
    ev(24, 4);
    expect(zooms()).toEqual([]);
    expect(pans()).toHaveLength(4);
  });

  it('keeps zooming when a step in the middle looks like a trackpad', () => {
    ev(0, 100);
    ev(60, 1.5, { deltaX: 3 });
    ev(100, 2.5);
    expect(pans()).toEqual([]);
    expect(zooms()).toHaveLength(3);
  });

  it('keeps panning through the long tail of inertia, steps of 1 px that are 30 ms apart', () => {
    ev(0, 1.5);
    for (let i = 1; i <= 20; i++) ev(i * 30, 1);
    expect(zooms()).toEqual([]);
    expect(pans()).toHaveLength(21);
  });

  it('is read afresh after a quiet moment: a pan, then a wheel, then a pan', () => {
    ev(0, 1.5);
    ev(10, 3.5);
    ev(10 + QUIET_MS + 1, 100);
    ev(10 + QUIET_MS + 1 + 8, 4);
    ev(1000, 2.5, { deltaX: 1 });
    expect(actions.map((a) => a.kind)).toEqual(['pan', 'pan', 'zoom', 'zoom', 'pan']);
  });

  it('does not wait for a quiet moment when the pointer wheel is held steady, a notch each 100 ms', () => {
    for (let i = 0; i < 5; i++) ev(i * 100, 100);
    expect(zooms()).toHaveLength(5);
  });
});

describe('a pinch zooms', () => {
  it('with Ctrl and small steps, by the pinch gain, about the pointer', () => {
    ev(0, -3.5, { ctrlKey: true });
    ev(8, -4.5, { ctrlKey: true });
    expect(actions).toEqual([
      { kind: 'zoom', factor: Math.exp(3.5 * PINCH_GAIN), at: AT },
      { kind: 'zoom', factor: Math.exp(4.5 * PINCH_GAIN), at: AT },
    ]);
  });

  it('with Ctrl and a mouse wheel notch, by the wheel gain, not the pinch gain', () => {
    ev(0, -100, { ctrlKey: true });
    expect(zooms()).toEqual([Math.exp(100 * WHEEL_GAIN)]);
    ev(300, 2, { ctrlKey: true, deltaMode: 1 });
    expect(zooms()[1]).toBe(Math.exp(-2 * 16 * WHEEL_GAIN));
  });

  it('after a pan, and a pan after it, each its own gesture', () => {
    ev(0, 1.5, { deltaX: 2 });
    ev(8, -3.5, { ctrlKey: true });
    ev(16, 2.5, { deltaX: 1 });
    expect(actions.map((a) => a.kind)).toEqual(['pan', 'zoom', 'pan']);
  });

  it('flushes a held step before the pinch it was held for', () => {
    ev(0, 5);
    ev(8, -3.5, { ctrlKey: true });
    expect(actions.map((a) => a.kind)).toEqual(['zoom', 'zoom']);
    expect(NOTCH_PX).toBe(50);
  });
});

describe('nothing to do', () => {
  it('for a step of nothing', () => {
    ev(0, 0);
    ev(8, 0, { ctrlKey: true });
    clock.to(1000);
    expect(actions).toEqual([]);
  });
});
