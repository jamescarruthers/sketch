// The Sketch Palette [ref]. Rows follow docs/SPEC.md section 7; the contextual section comes from the
// active tool's group and options, or the registry's selection rows.
import type { App, Settings } from '../app/app';
import type { Id, LineType } from '../model/types';
import { SELECTION_OPTIONS } from '../tools/registry';
import type { PaletteRow } from '../tools/tool';
import { icon } from './icons';
import { sketchStatus } from './status';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const out = document.createElement(tag);
  if (cls) out.className = cls;
  if (text !== undefined) out.textContent = text;
  return out;
};

const TOGGLES: [keyof Settings, string][] = [
  ['grid', 'Sketch Grid'], ['snap', 'Snap'], ['showProfile', 'Show Profile'], ['showPoints', 'Show Points'],
  ['showDimensions', 'Show Dimensions'], ['showConstraints', 'Show Constraints'],
  ['showConstruction', 'Show Construction Geometries'], ['showProjected', 'Show Projected Geometries'],
  ['showPlanes', 'Other Planes'],
  ['showConstrained', 'Show Constrained Lines'], ['constructionActiveOnly', 'Construction: Active Layer Only'],
];

export class Palette {
  readonly root = el('aside', 'palette');
  private readonly status = el('div', 'palette-status');
  private readonly context = el('div', 'palette-section');
  private readonly options = el('div', 'palette-section');
  private readonly finder = el('div', 'finder');
  private finding = false;
  private collapsed = false;

  constructor(private readonly app: App) {
    this.root.setAttribute('aria-label', 'Sketch Palette');
    const head = el('div', 'palette-head');
    const toggle = el('button', 'icon-btn');
    toggle.innerHTML = icon('minus');
    toggle.title = 'Collapse';
    toggle.onclick = () => {
      this.collapsed = !this.collapsed;
      this.root.classList.toggle('collapsed', this.collapsed);
    };
    head.append(toggle, el('span', '', 'SKETCH PALETTE'));
    const body = el('div', 'palette-body');
    body.append(this.status, this.context, this.options, this.finder);
    const foot = el('div', 'palette-foot');
    const finish = el('button', 'btn', 'Finish Sketch');
    finish.dataset.action = 'palette-finish';
    finish.onclick = () => app.run('finish-sketch');
    foot.append(finish);
    this.root.append(head, body, foot);
    app.on('mode', () => this.update());
    app.on('tool', () => this.update());
    app.on('settings', () => this.update());
    app.on('doc', () => this.update());
    app.on('status', () => this.refreshStatus());
    app.on('selection', () => this.update());
    this.update();
  }

  private refreshStatus(): void {
    const { app } = this;
    if (app.mode !== 'sketch') return;
    const st = sketchStatus(app);
    this.status.textContent = `Status: ${st.text}`;
    this.status.dataset.state = st.state;
  }

  private update(): void {
    const { app } = this;
    const on = app.mode === 'sketch';
    this.root.style.display = on ? '' : 'none';
    if (!on) return;
    this.refreshStatus();
    this.renderContext();
    this.renderOptions();
    this.renderFinder();
  }

  private renderContext(): void {
    const { app } = this;
    this.context.replaceChildren();
    const meta = app.activeToolDef?.meta;
    const rows: HTMLElement[] = [];
    if (meta?.group) {
      const siblings = [...app.tools.values()].filter((t) => t.meta.group === meta.group);
      if (siblings.length > 1) {
        const row = el('div', 'palette-row stacked');
        row.append(el('span', 'palette-label', 'Type'));
        const types = el('div', 'type-list');
        for (const t of siblings) {
          const b = el('button', `type-btn${t.meta.id === meta.id ? ' active' : ''}`);
          b.title = t.meta.label;
          b.setAttribute('aria-label', t.meta.label);
          b.innerHTML = icon(t.meta.icon ?? t.meta.id);
          b.onclick = () => app.activate(t.meta.id);
          types.append(b);
        }
        row.append(types);
        rows.push(row);
      }
    }
    for (const r of app.toolOptions) rows.push(this.customRow(r));
    if (!meta || meta.id === 'select') {
      // What the selected curves are, and turning them into the other [ref GUID-4183A4B7].
      if (app.selectedCurves().length) {
        rows.push(this.customRow({ key: 'normal-construction', label: 'Normal/Construction', kind: 'button', value: 'Toggle', onChange: () => app.run('toggle-construction') }));
      }
      for (const o of SELECTION_OPTIONS) for (const r of o.rows(app.toolContext)) rows.push(this.customRow(r));
    }
    if (rows.length) {
      this.context.append(this.heading('Feature Options'), ...rows);
    }
  }

  private heading(text: string): HTMLElement {
    const h = el('div', 'palette-heading');
    h.innerHTML = `${icon('caret')}<span>${text}</span>`;
    return h;
  }

  private customRow(r: PaletteRow): HTMLElement {
    const row = el('label', 'palette-row');
    row.append(el('span', 'palette-label', r.label));
    if (r.kind === 'checkbox') {
      const c = el('input');
      c.type = 'checkbox';
      c.checked = !!r.value;
      c.onchange = () => r.onChange(c.checked);
      row.append(c);
    } else if (r.kind === 'select') {
      const s = el('select');
      for (const o of r.options ?? []) {
        const option = el('option', '', o.label);
        option.value = o.value;
        s.append(option);
      }
      s.value = String(r.value ?? '');
      s.onchange = () => r.onChange(s.value);
      for (const q of r.quick ?? []) {
        const b = el('button', `type-btn degree-btn${String(r.value) === q.value ? ' active' : ''}`, q.label);
        b.title = q.title;
        b.setAttribute('aria-label', q.title);
        b.onclick = (e) => {
          e.preventDefault();
          s.value = q.value;
          r.onChange(q.value);
          for (const other of row.querySelectorAll('.degree-btn')) other.classList.toggle('active', other === b);
        };
        row.append(b);
      }
      row.append(s);
    } else if (r.kind === 'number') {
      const n = el('input');
      n.type = 'number';
      n.value = String(r.value ?? 0);
      n.onchange = () => r.onChange(Number(n.value));
      row.append(n);
    } else {
      const b = el('button', 'btn', String(r.value ?? r.label));
      b.onclick = () => r.onChange(true);
      row.append(b);
    }
    return row;
  }

  private renderOptions(): void {
    const { app } = this;
    this.options.replaceChildren(this.heading('Options'));
    const line = el('div', 'palette-row');
    line.append(el('span', 'palette-label', 'Linetype'));
    const types = el('div', 'type-list');
    // With curves selected the buttons show what those curves are [ref SKT-CONSTRUCTION-GEOMETRY].
    const s = app.activeSketch;
    const picked = s ? app.selectedCurves().map((id) => s.curves[id]) : [];
    const showing = (t: LineType): boolean => (picked.length ? picked.every((c) => c.lineType === t) : app.lineType === t);
    const typeButton = (t: LineType, label: string, name: string): void => {
      const b = el('button', `type-btn${showing(t) ? ' active' : ''}`);
      b.title = label;
      b.setAttribute('aria-label', label);
      b.innerHTML = icon(name);
      b.onclick = () => app.setLineType(t);
      types.append(b);
    };
    typeButton('construction', 'Construction', 'construction');
    typeButton('centerline', 'Centerline', 'centerline');
    line.append(types);
    const look = el('div', 'palette-row');
    look.append(el('span', 'palette-label', 'Look At'));
    const lookBtn = el('button', 'type-btn');
    lookBtn.innerHTML = icon('look-at');
    lookBtn.title = 'Look At';
    lookBtn.setAttribute('aria-label', 'Look At');
    lookBtn.onclick = () => app.run('fit');
    look.append(lookBtn);
    this.options.append(line, look);
    for (const [key, label] of TOGGLES) {
      const row = el('label', 'palette-row');
      row.append(el('span', 'palette-label', label));
      const c = el('input');
      c.type = 'checkbox';
      c.checked = app.settings[key];
      c.onchange = () => app.setSetting(key, c.checked);
      row.append(c);
      this.options.append(row);
    }
    const find = el('button', `palette-link${this.finding ? ' active' : ''}`, 'Find Under-Constrained');
    find.onclick = () => {
      this.finding = !this.finding;
      this.update();
    };
    const compute = el('button', 'palette-link', 'Compute Sketch');
    compute.onclick = () => app.run('compute');
    const auto = el('button', 'palette-link', 'AutoConstrain');
    auto.disabled = !!app.disabledReason('autoconstrain');
    auto.onclick = () => app.activate('autoconstrain');
    this.options.append(find, compute, auto);
  }

  /** Live list of free entities [ref SKT-FIND-UNDERCONSTRAINED]. */
  private renderFinder(): void {
    const { app } = this;
    this.finder.replaceChildren();
    const s = app.activeSketch;
    if (!this.finding || !s) {
      if (app.hideConstrained) {
        app.hideConstrained = false;
        app.invalidate();
      }
      return;
    }
    const a = app.analysisOf(s.id);
    const hide = el('label', 'palette-row');
    const check = el('input');
    check.type = 'checkbox';
    check.checked = app.hideConstrained;
    check.onchange = () => {
      app.hideConstrained = check.checked;
      app.invalidate();
    };
    hide.append(el('span', 'palette-label', 'Hide Fully Constrained'), check);
    this.finder.append(hide);
    const free: { id: Id; label: string; point: boolean }[] = [];
    for (const id of a.freeCurves) {
      const c = s.curves[id];
      if (c && app.editable(id)) free.push({ id, label: c.type, point: false });
    }
    for (const id of a.freePoints) {
      const p = s.points[id];
      if (p && !p.owner && app.editable(id)) free.push({ id, label: 'point', point: true });
    }
    if (!free.length) {
      this.finder.append(el('div', 'finder-empty', 'Nothing is under-constrained'));
      return;
    }
    for (const f of free) {
      const row = el('div', 'finder-row');
      const name = el('button', 'finder-name', `${f.label} ${f.id}`);
      name.onclick = () => app.focusEntity(f.id);
      row.append(name);
      if (!f.point) {
        const x = el('button', 'icon-btn');
        x.innerHTML = icon('close');
        x.title = 'Delete';
        x.onclick = () => app.deleteEntity(f.id);
        row.append(x);
      }
      this.finder.append(row);
    }
  }
}
