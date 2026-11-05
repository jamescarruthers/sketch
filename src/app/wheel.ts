// Trackpad and mouse wheel on one `wheel` event. A browser gives a mouse wheel, a two-finger drag and a
// pinch the same event, and no field says which. Documented behaviour to go on (UI Events, and what
// browsers do with it):
//   - `ctrlKey` is true on a trackpad pinch, and on Ctrl + wheel.
//   - `deltaMode` is lines or pages for a wheel mouse in Firefox; a trackpad is always pixels.
//   - A mouse wheel has one axis: `deltaX` is 0. A two-finger drag moves both.
//   - A trackpad reports small, often fractional steps, many times a second. A wheel notch is one step of
//     50 px or more (100 on Windows, less when the display is scaled), a gap after the last.
// The decision is made once for a burst of events and kept, so one gesture never flips between panning
// and zooming part way. When it cannot be made, it is a mouse wheel, and zooms.
import type { Vec2 } from '../model/types';

export type WheelAction =
  | { kind: 'zoom'; factor: number; at: Vec2 }
  | { kind: 'pan'; dx: number; dy: number };

/** The part of a WheelEvent that is read. */
export interface WheelInput {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  ctrlKey: boolean;
  shiftKey: boolean;
  /** Milliseconds, any origin: only differences are used. */
  timeStamp: number;
}

/** A pause this long ends a burst: the next event starts a new gesture and is looked at afresh. */
export const QUIET_MS = 120;
/** One mouse wheel notch, at least, in pixels. A trackpad steps by less. */
export const NOTCH_PX = 50;
/** An event with nothing to settle it waits this long for the next. Two close together are a trackpad. */
export const PAIR_MS = 40;
/** Zoom per pixel of mouse wheel, as it has always been. */
export const WHEEL_GAIN = 0.0016;
/** Zoom per pixel of pinch. A pinch is reported as many small steps. */
export const PINCH_GAIN = 0.01;

const LINE_PX = 16;

interface Timer { set(fn: () => void, ms: number): unknown; clear(handle: unknown): void }

const real: Timer = { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };

type Mode = 'wheel' | 'pan';

export class WheelGestures {
  private mode: Mode | null = null;
  private last = -Infinity;
  /** The first event of a burst that could be either, held until the next one (or the lack of it) says. */
  private held: { e: WheelInput; at: Vec2; timer: unknown } | null = null;

  constructor(private readonly out: (a: WheelAction) => void, private readonly timer: Timer = real) {}

  /** `at` is where the pointer is, in the canvas's own pixels: a zoom keeps the point under it still. */
  feed(e: WheelInput, at: Vec2): void {
    if (e.deltaX === 0 && e.deltaY === 0) return;
    const gap = e.timeStamp - this.last;
    this.last = e.timeStamp;
    if (this.held) this.settle(e, gap);
    if (e.ctrlKey) {
      // Pinch, or Ctrl and a mouse wheel: a zoom either way, a step to match its size.
      const pinch = e.deltaMode === 0 && Math.abs(e.deltaY) < NOTCH_PX;
      this.zoom(e, at, pinch ? PINCH_GAIN : WHEEL_GAIN);
      this.mode = null;
      return;
    }
    if (this.mode === null || gap > QUIET_MS) this.mode = this.read(e);
    if (this.mode === null) {
      this.hold(e, at);
      return;
    }
    this.apply(this.mode, e, at);
  }

  /** What one event says, when it says anything: null when it could be a mouse wheel or a trackpad. */
  private read(e: WheelInput): Mode | null {
    if (e.deltaMode !== 0) return 'wheel';
    // Shift turns a wheel into a sideways one in some browsers: that is not a second axis.
    if (e.deltaX !== 0 && !e.shiftKey) return 'pan';
    const whole = Number.isInteger(e.deltaX) && Number.isInteger(e.deltaY);
    if (Math.abs(e.deltaY) >= NOTCH_PX) return 'wheel';
    if (!whole) return 'pan';
    return null;
  }

  private hold(e: WheelInput, at: Vec2): void {
    const timer = this.timer.set(() => {
      // Nothing followed: one small step on its own is a notch.
      this.held = null;
      this.mode = 'wheel';
      this.apply('wheel', e, at);
    }, PAIR_MS);
    this.held = { e, at, timer };
  }

  /** A second event has come in while the first was held: close together is a trackpad, apart is a wheel. */
  private settle(next: WheelInput, gap: number): void {
    const held = this.held;
    if (!held) return;
    this.held = null;
    this.timer.clear(held.timer);
    this.mode = !next.ctrlKey && gap <= PAIR_MS && next.deltaMode === 0 && Math.abs(next.deltaY) < NOTCH_PX ? 'pan' : 'wheel';
    this.apply(this.mode, held.e, held.at);
  }

  private apply(mode: Mode, e: WheelInput, at: Vec2): void {
    if (mode === 'wheel') {
      this.zoom(e, at, WHEEL_GAIN);
      return;
    }
    const k = e.deltaMode === 1 ? LINE_PX : 1;
    const [dx, dy] = [e.deltaX * k, e.deltaY * k];
    // Content follows the fingers, as a scroll does: a positive delta moves it up and to the left.
    if (dx !== 0 || dy !== 0) this.out({ kind: 'pan', dx: 0 - dx, dy: 0 - dy });
  }

  private zoom(e: WheelInput, at: Vec2, gain: number): void {
    const px = e.deltaMode === 1 ? e.deltaY * LINE_PX : e.deltaY;
    if (px !== 0) this.out({ kind: 'zoom', factor: Math.exp(-px * gain), at });
  }
}
