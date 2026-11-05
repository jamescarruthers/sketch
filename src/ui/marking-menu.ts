// Right-click radial menu with an overflow list [ref]. Flick toward a slot and release, or click.
import type { App } from '../app/app';
import type { Vec2 } from '../model/types';
import type { MenuItem } from '../tools/tool';
import { icon } from './icons';

export interface RadialItem { id: string; label: string; icon: string; run(): void }

const RADIUS = 96;
const FLICK_PX = 40;

export class MarkingMenu {
  private root: HTMLElement | null = null;
  private at: Vec2 = { x: 0, y: 0 };
  private slots: { dir: Vec2; run(): void }[] = [];

  constructor(private readonly app: App) {}

  /** Right button released after travelling: take the slot in that direction. */
  flick(release: Vec2): void {
    if (!this.root) return;
    const dx = release.x - this.at.x;
    const dy = release.y - this.at.y;
    const reach = Math.hypot(dx, dy);
    if (reach < FLICK_PX) return;
    let best: { dir: Vec2; run(): void } | null = null;
    let score = -2;
    for (const s of this.slots) {
      const d = (s.dir.x * dx + s.dir.y * dy) / reach;
      if (d > score) {
        score = d;
        best = s;
      }
    }
    if (best) this.choose(best.run);
  }

  get isOpen(): boolean {
    return this.root !== null;
  }

  open(at: Vec2, radial: RadialItem[], list: MenuItem[]): void {
    this.close();
    const root = document.createElement('div');
    root.className = 'marking';
    root.style.left = `${at.x}px`;
    root.style.top = `${at.y}px`;
    root.setAttribute('role', 'menu');
    const hub = document.createElement('div');
    hub.className = 'marking-hub';
    root.append(hub);
    this.at = at;
    this.slots = [];
    radial.slice(0, 8).forEach((item, i) => {
      const angle = -Math.PI / 2 + (i * Math.PI * 2) / Math.min(radial.length, 8);
      const b = document.createElement('button');
      b.className = 'marking-item';
      b.dataset.item = item.id;
      b.style.transform = `translate(${Math.round(Math.cos(angle) * RADIUS * 1.25)}px, ${Math.round(Math.sin(angle) * RADIUS)}px) translate(-50%, -50%)`;
      b.innerHTML = `<span class="menu-icon">${icon(item.icon)}</span><span>${item.label}</span>`;
      b.onclick = () => this.choose(item.run);
      root.append(b);
      this.slots.push({ dir: { x: Math.cos(angle), y: Math.sin(angle) }, run: item.run });
    });
    if (list.length) {
      const panel = document.createElement('div');
      panel.className = 'marking-list';
      for (const item of list) {
        const b = document.createElement('button');
        b.className = `menu-item${item.disabled ? ' disabled' : ''}`;
        b.dataset.item = item.id;
        b.innerHTML = `<span class="menu-icon">${item.checked ? icon('check') : item.icon ? icon(item.icon) : ''}</span><span class="menu-label">${item.label}</span>`;
        if (item.disabled) b.title = item.disabled;
        b.onclick = () => {
          if (!item.disabled) this.choose(item.run);
        };
        panel.append(b);
      }
      panel.style.top = `${RADIUS + 28}px`;
      root.append(panel);
    }
    this.app.stage.append(root);
    this.root = root;
    const away = (e: PointerEvent): void => {
      if (!this.root) return;
      if (!(e.target as HTMLElement).closest('.marking-item, .marking-list')) this.close();
    };
    // The opening press is still on its way; listen for the next one.
    setTimeout(() => document.addEventListener('pointerdown', away, { capture: true, once: true }));
  }

  private choose(run: () => void): void {
    this.close();
    run();
  }

  close(): void {
    this.root?.remove();
    this.root = null;
  }
}
