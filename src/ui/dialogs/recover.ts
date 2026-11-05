// Recover Designs: the autosaves that could not be restored, each to open, download or delete.
// And the note a boot shows when it has just put one aside.
import type { Rescued } from '../../io/rescue';
import { formatBytes } from '../../app/format';
import type { DialogHost } from './dialog';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const out = document.createElement(tag);
  if (cls) out.className = cls;
  if (text !== undefined) out.textContent = text;
  return out;
};

export interface RecoverEnv {
  list(): Rescued[];
  /** Try it. The caller asks about unsaved changes first, and says why if it cannot be opened. */
  open(id: string): void;
  /** Hand the raw text to the browser as a file. */
  download(id: string): void;
  remove(id: string): void;
}

const when = (at: number | null): string => (at === null ? 'Saved on an earlier run' : new Date(at).toLocaleString());

/** `error` is why the copy just tried could not be opened. */
export function openRecoverDialog(host: DialogHost, env: RecoverEnv, error?: string): void {
  const d = host.open({ title: 'Recover Designs', okLabel: 'Close', noCancel: true, width: 360, onOk: () => undefined });
  const list = el('div', 'rescue-list');
  d.custom(list);
  const render = (): void => {
    list.replaceChildren();
    const copies = env.list();
    if (!copies.length) {
      list.append(el('div', 'rescue-empty', 'Nothing to recover. A design that cannot be restored when the app starts is kept here.'));
      return;
    }
    for (const c of copies) {
      const row = el('div', 'rescue-row');
      row.dataset.id = c.id;
      const info = el('div', 'rescue-info');
      info.append(el('span', 'rescue-time', when(c.at)), el('span', 'rescue-size', formatBytes(c.size)));
      const actions = el('div', 'rescue-actions');
      for (const [action, label, run] of [
        ['open', 'Open', () => env.open(c.id)],
        ['download', 'Download', () => env.download(c.id)],
        ['delete', 'Delete', () => {
          env.remove(c.id);
          render();
        }],
      ] as const) {
        const b = el('button', 'btn', label);
        b.dataset.action = action;
        b.onclick = run;
        actions.append(b);
      }
      row.append(info, actions);
      list.append(row);
    }
  };
  render();
  if (error) d.setError(error);
}

/** The note on the stage after a boot that put a design aside. It stays until it is used or dismissed. */
export class RescueNote {
  readonly root = el('div', 'rescue-note');
  private readonly text = el('span', 'rescue-text');

  constructor() {
    this.root.hidden = true;
    this.root.setAttribute('role', 'status');
    this.root.append(this.text);
  }

  show(message: string, action: { label: string; run(): void } | null): void {
    this.text.textContent = message;
    this.root.replaceChildren(this.text);
    if (action) {
      const go = el('button', 'btn', action.label);
      go.onclick = () => {
        this.hide();
        action.run();
      };
      this.root.append(go);
    }
    const dismiss = el('button', 'btn', 'Dismiss');
    dismiss.onclick = () => this.hide();
    this.root.append(dismiss);
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }
}
