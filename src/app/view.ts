// Pan and zoom. Screen coordinates are CSS pixels, Y down; sketch coordinates are mm, Y up.
import type { Vec2 } from '../model/types';
import type { Box } from '../geom/vec';

const MIN_PPM = 1e-3;
const MAX_PPM = 1e5;

export class View {
  cx = 0;
  cy = 0;
  /** CSS pixels per millimetre. */
  ppm = 4;
  width = 800;
  height = 600;
  dpr = 1;
  /** Bumped on every change, so caches keyed on the view can tell. */
  version = 0;

  toScreen(p: Vec2): Vec2 {
    return { x: this.width / 2 + (p.x - this.cx) * this.ppm, y: this.height / 2 - (p.y - this.cy) * this.ppm };
  }

  toWorld(s: Vec2): Vec2 {
    return { x: this.cx + (s.x - this.width / 2) / this.ppm, y: this.cy - (s.y - this.height / 2) / this.ppm };
  }

  /** Sketch-space length of a number of screen pixels. */
  px(n: number): number {
    return n / this.ppm;
  }

  resize(width: number, height: number, dpr: number): void {
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.version++;
  }

  zoomAt(screen: Vec2, factor: number): void {
    const before = this.toWorld(screen);
    this.ppm = Math.min(MAX_PPM, Math.max(MIN_PPM, this.ppm * factor));
    const after = this.toWorld(screen);
    this.cx += before.x - after.x;
    this.cy += before.y - after.y;
    this.version++;
  }

  panBy(dx: number, dy: number): void {
    this.cx -= dx / this.ppm;
    this.cy += dy / this.ppm;
    this.version++;
  }

  /**
   * Centre a box with a margin in pixels, in what `cover` leaves of the canvas: panels floating over its
   * left and right. A degenerate box keeps the current zoom.
   */
  fit(box: Box, margin = 80, cover: { left: number; right: number } = { left: 0, right: 0 }): void {
    const w = box.maxX - box.minX;
    const h = box.maxY - box.minY;
    const room = this.width - cover.left - cover.right;
    if (w > 0 || h > 0) {
      const sx = w > 0 ? (room - margin * 2) / w : Infinity;
      const sy = h > 0 ? (this.height - margin * 2) / h : Infinity;
      this.ppm = Math.min(MAX_PPM, Math.max(MIN_PPM, Math.min(sx, sy)));
    }
    this.cx = (box.minX + box.maxX) / 2 + (cover.right - cover.left) / 2 / this.ppm;
    this.cy = (box.minY + box.maxY) / 2;
    this.version++;
  }

  /** Minor and major grid spacing in mm: major is the first 1/2/5 decade at least 80 px wide. */
  gridSteps(): { minor: number; major: number } {
    const target = 80 / this.ppm;
    const decade = 10 ** Math.floor(Math.log10(target));
    const mult = [1, 2, 5, 10].find((m) => m * decade >= target) ?? 10;
    const major = mult * decade;
    return { major, minor: major / (mult === 2 ? 4 : 5) };
  }
}
