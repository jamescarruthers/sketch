// Create Sketch: an isometric view of the three origin planes [ref].
import type { App } from '../app/app';
import type { Id, Plane } from '../model/types';

/** Isometric projection of (x, y, z). Z is up on screen, as in the reference's default orientation. */
const iso = (x: number, y: number, z: number): [number, number] => [
  (x - y) * 0.866, (x + y) * 0.5 - z,
];

const quad = (pts: [number, number, number][]): string =>
  pts.map(([x, y, z]) => iso(x, y, z).map((v) => v.toFixed(1)).join(',')).join(' ');

const S = 70;

const DESIGN_PROMPT = 'Create a sketch, or right-click one in the browser to edit it';

const PLANES: { plane: Plane; label: string; pts: string; at: [number, number]; color: string }[] = [
  { plane: 'XY', label: 'XY (Top)', pts: quad([[0, 0, 0], [S * 2, 0, 0], [S * 2, S * 2, 0], [0, S * 2, 0]]), at: iso(S, S, 0), color: 'var(--plane-xy)' },
  { plane: 'YZ', label: 'YZ', pts: quad([[0, 0, 0], [0, S * 2, 0], [0, S * 2, S * 2], [0, 0, S * 2]]), at: iso(0, S, S), color: 'var(--plane-yz)' },
  { plane: 'ZX', label: 'XZ', pts: quad([[0, 0, 0], [0, 0, S * 2], [S * 2, 0, S * 2], [S * 2, 0, 0]]), at: iso(S, 0, S), color: 'var(--plane-zx)' },
];

export class PlanePicker {
  private root: HTMLElement | null = null;

  constructor(private readonly app: App) {}

  get isOpen(): boolean {
    return this.root !== null;
  }

  /** `onPlane` takes the plane instead of creating a sketch, for Redefine Sketch Plane. */
  open(onPlane?: (plane: Plane) => void): void {
    if (this.root || (this.app.mode === 'sketch' && !onPlane)) return;
    const root = document.createElement('div');
    root.className = 'plane-picker';
    const polys = PLANES.map((p) => `
      <g class="plane" data-plane="${p.plane}" role="button" aria-label="${p.label} plane" tabindex="0" style="--plane:${p.color}">
        <polygon points="${p.pts}"/>
        <text x="${p.at[0].toFixed(1)}" y="${p.at[1].toFixed(1)}">${p.label}</text>
      </g>`).join('');
    root.innerHTML = `
      <div class="plane-title">Select a plane to sketch on</div>
      <svg viewBox="-150 -160 300 310" width="360" height="372">${polys}<circle class="plane-origin" cx="0" cy="0" r="4"/></svg>`;
    for (const g of root.querySelectorAll<SVGGElement>('.plane')) {
      g.addEventListener('click', (e) => {
        // Sketch geometry showing through the picker is a choice too, and picking it edits that sketch.
        if (onPlane) {
          this.close();
          onPlane(g.dataset.plane as Plane);
          return;
        }
        const existing = this.app.sketchAt(e.clientX, e.clientY);
        if (existing) {
          this.choose(existing);
          return;
        }
        this.close();
        this.app.createSketch(g.dataset.plane as Plane);
      });
    }
    this.app.stage.append(root);
    this.root = root;
    this.app.status('Select a plane to sketch on, or press Esc');
  }

  /** An existing sketch instead of a plane: edit it, and make no new one [ref GUID-0EEF7073]. */
  choose(id: Id): void {
    this.close();
    this.app.enterSketch(id);
  }

  close(): void {
    if (this.root) this.app.status(this.app.mode === 'design' ? DESIGN_PROMPT : '');
    this.root?.remove();
    this.root = null;
  }
}
