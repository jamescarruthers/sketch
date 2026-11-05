// Bottom bar: prompt, transient note, Min Distance, time to solve, sketch state, coordinates.
import type { App } from '../app/app';
import { formatLength, formatSolveTime, formatValue } from '../app/format';

export function sketchStatus(app: App): { text: string; state: 'free' | 'done' | 'over' } {
  const a = app.analysisOf(app.activeId);
  if (a.unsatisfied.size) return { text: 'Over-Constrained', state: 'over' };
  const s = app.activeSketch;
  const populated = !!s && (Object.keys(s.curves).length > 0 || Object.keys(s.points).length > 0);
  if (populated && a.dof === 0) return { text: 'Constrained', state: 'done' };
  return { text: 'Under-Constrained', state: 'free' };
}

export class StatusBar {
  readonly root = document.createElement('footer');
  private readonly prompt = document.createElement('span');
  private readonly note = document.createElement('span');
  private readonly measure = document.createElement('span');
  private readonly solve = document.createElement('span');
  private readonly solveText = document.createElement('span');
  private readonly state = document.createElement('span');
  private readonly coords = document.createElement('span');

  constructor(private readonly app: App) {
    this.root.className = 'statusbar';
    this.prompt.className = 'status-prompt';
    this.note.className = 'status-note';
    this.measure.className = 'status-measure';
    this.solve.className = 'status-solve';
    this.solveText.className = 'status-solve-text';
    this.solve.append(this.solveText);
    this.state.className = 'status-state';
    this.coords.className = 'status-coords';
    this.root.append(this.prompt, this.note, this.measure, this.solve, this.state, this.coords);
    app.on('status', () => this.update());
    app.on('mode', () => this.update());
    app.on('doc', () => this.update());
    app.on('selection', () => this.refreshMinDistance());
    app.on('cursor', () => this.updateCoords());
  }

  /** Min Distance of two selected objects. The App works it out once per change, so this is cheap to call often. */
  refreshMinDistance(): void {
    const { app } = this;
    const d = app.mode === 'sketch' ? app.minDistance() : null;
    const text = d === null ? '' : `Min Distance: ${formatValue(d, 'length', app.design.units)}`;
    if (this.measure.textContent !== text) this.measure.textContent = text;
    // Empty in a sketch it still holds its width, so the bar does not shift when a value appears.
    this.measure.hidden = app.mode !== 'sketch';
  }

  /** Time of the sketch's last solve. The App holds it, so this is cheap to call once a frame. */
  refreshSolveTime(): void {
    const { app } = this;
    const ms = app.solveTime();
    const text = ms === null ? '' : formatSolveTime(ms);
    if (this.solveText.textContent !== text) this.solveText.textContent = text;
    // Empty it still holds its width, so the bar does not shift when a time appears.
    this.solve.hidden = app.mode !== 'sketch';
  }

  private updateCoords(): void {
    const u = this.app.design.units;
    const { x, y } = this.app.cursorWorld;
    this.coords.textContent = `X ${formatLength(x, u)}   Y ${formatLength(y, u)}  ${u}`;
  }

  private update(): void {
    const { app } = this;
    this.prompt.textContent = app.statusText;
    this.note.textContent = app.noteText;
    this.note.classList.toggle('warn', app.noteKind === 'warn');
    if (app.mode === 'sketch') {
      const a = app.analysisOf(app.activeId);
      const st = sketchStatus(app);
      this.state.textContent = `${st.text}${a.dof > 0 ? ` (${a.dof} DOF)` : ''}`;
      this.state.dataset.state = st.state;
    } else this.state.textContent = '';
    this.refreshMinDistance();
    this.refreshSolveTime();
    this.updateCoords();
  }
}
