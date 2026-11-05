// The AutoConstrain dialog body: result tiles with the active tile's controls. It renders a view model
// and reports intent; src/tools/autoconstrain.ts owns the session.
import type { AutoResult } from '../../geom/autoconstrain';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const out = document.createElement(tag);
  if (cls) out.className = cls;
  if (text !== undefined) out.textContent = text;
  return out;
};

const LOCK = '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="7" width="10" height="7" rx="1" fill="currentColor"/><path d="M5 7V5a3 3 0 0 1 6 0v2"/></svg>';
const UNLOCK = '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="7" width="10" height="7" rx="1"/><path d="M5 7V5a3 3 0 0 1 5.8-1"/></svg>';

export interface AutoPanelModel {
  results: AutoResult[];
  /** Result ids with their applied counts after any deleted preview items. */
  added(result: AutoResult): { constraints: number; dimensions: number };
  active: string | null;
  /** 0 to 100 for the active tile. */
  quantity: number;
  modify: boolean;
  /** mm. */
  tolerance: number;
  canGenerateMore: boolean;
  /** Preview items were deleted, so the tile offers Refresh. */
  stale: boolean;
  pickingDatum: boolean;
  datumName: string | null;
}

export interface AutoPanelEvents {
  choose(id: string): void;
  setQuantity(value: number): void;
  setModify(on: boolean): void;
  setTolerance(mm: number): void;
  generateMore(): void;
  refresh(): void;
  /** Throw away edits to the results and generate them afresh [ref SKT-AUTO-CONSTRAIN-CONCEPT]. */
  startOver(): void;
  setDatum(): void;
}

export const AUTO_TOLERANCE_MM: readonly [number, number] = [0.05, 5];

function tile(m: AutoPanelModel, ev: AutoPanelEvents, r: AutoResult): HTMLElement {
  const active = r.id === m.active;
  const out = el('div', `auto-tile${active ? ' active' : ''}`);
  out.dataset.result = r.id;
  const add = m.added(r);
  const totalC = r.totalConstraints - r.constraints.length + add.constraints;
  const totalD = r.totalDimensions - r.dimensions.length + add.dimensions;
  const head = el('button', 'auto-tile-head');
  head.onclick = () => ev.choose(r.id);
  head.append(el('span', 'auto-tile-name', r.label));
  const details = el('span', 'auto-counts');
  details.title = `Adds ${add.constraints} constraints and ${add.dimensions} dimensions. Totals ${totalC} and ${totalD}.`;
  details.append(el('span', 'auto-count', `${totalC} constraints`), el('span', 'auto-count', `${totalD} dimensions`));
  const lock = el('span', `auto-lock ${r.fullyConstrained ? 'locked' : 'open'}`);
  lock.innerHTML = r.fullyConstrained ? LOCK : UNLOCK;
  lock.title = r.fullyConstrained ? 'Fully Constrained' : 'Partially Constrained';
  lock.setAttribute('aria-label', lock.title);
  head.append(details, lock);
  out.append(head);
  if (active) out.append(controls(m, ev));
  return out;
}

function controls(m: AutoPanelModel, ev: AutoPanelEvents): HTMLElement {
  const box = el('div', 'auto-controls');
  const row = el('div', 'auto-slider');
  const slider = el('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = '100';
  slider.value = String(m.quantity);
  slider.setAttribute('aria-label', 'Constraint quantity');
  slider.onchange = () => ev.setQuantity(Number(slider.value));
  const step = (label: string, title: string, by: number): HTMLElement => {
    const b = el('button', 'icon-btn auto-step', label);
    b.title = title;
    b.setAttribute('aria-label', title);
    b.onclick = () => ev.setQuantity(Math.min(100, Math.max(0, m.quantity + by)));
    return b;
  };
  row.append(step('-', 'Reduce Constraints', -10), slider, step('+', 'Add Constraints', 10));
  box.append(row);

  const more = el('div', 'auto-more');
  const moreButton = el('button', 'btn', 'More');
  moreButton.dataset.action = 'auto-more';
  const menu = el('div', 'auto-more-menu');
  menu.hidden = true;
  const datum = el('button', 'menu-item', 'Set Datum');
  datum.dataset.item = 'Set Datum';
  datum.onclick = () => {
    menu.hidden = true;
    ev.setDatum();
  };
  menu.append(datum);
  moreButton.onclick = () => { menu.hidden = !menu.hidden; };
  more.append(moreButton, menu);
  if (m.stale) {
    const refresh = el('button', 'btn', 'Refresh');
    refresh.dataset.action = 'auto-refresh';
    refresh.onclick = () => ev.refresh();
    more.append(refresh);
  }
  const again = el('button', 'btn', 'Start Over');
  again.dataset.action = 'auto-start-over';
  again.onclick = () => ev.startOver();
  more.append(again);
  box.append(more);

  const modify = el('label', 'form-row');
  const check = el('input');
  check.type = 'checkbox';
  check.checked = m.modify;
  check.onchange = () => ev.setModify(check.checked);
  modify.append(el('span', 'form-label', 'Modify Geometry'), check);
  box.append(modify);
  if (m.modify) {
    const tol = el('label', 'form-row');
    const range = el('input');
    range.type = 'range';
    range.min = String(AUTO_TOLERANCE_MM[0]);
    range.max = String(AUTO_TOLERANCE_MM[1]);
    range.step = '0.05';
    range.value = String(m.tolerance);
    range.setAttribute('aria-label', 'Tolerance');
    range.onchange = () => ev.setTolerance(Number(range.value));
    tol.append(el('span', 'form-label', `Tolerance ${m.tolerance.toFixed(2)} mm`), range);
    box.append(tol);
  }
  return box;
}

/** Rebuild the panel in place. */
export function renderAutoPanel(root: HTMLElement, m: AutoPanelModel, ev: AutoPanelEvents): void {
  root.replaceChildren();
  root.append(el('div', 'form-note auto-engine', 'Local rules engine: results come from fixed rules running in this browser, not a cloud AI service.'));
  if (m.pickingDatum) root.append(el('div', 'form-note auto-datum', 'Select a point in the canvas to place the datum.'));
  else if (m.datumName) root.append(el('div', 'form-note auto-datum', `Datum: ${m.datumName}`));
  const list = el('div', 'auto-tiles');
  for (const r of m.results) list.append(tile(m, ev, r));
  root.append(list);
  if (m.results.length || !m.pickingDatum) {
    const more = el('button', 'btn', 'Generate more');
    more.dataset.action = 'auto-generate';
    more.disabled = !m.canGenerateMore;
    more.onclick = () => ev.generateMore();
    root.append(more);
  }
}
