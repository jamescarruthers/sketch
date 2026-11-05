// Units-aware expression language for dimensions and parameters.
//
// expr    := term (('+'|'-') term)*
// term    := unary (('*'|'/') unary)*
// unary   := '-' unary | '+' unary | power
// power   := postfix ('^' unary)?
// postfix := primary unit?
// primary := NUMBER | NAME | NAME '(' args ')' | '(' expr ')'
//
// A leading '=' is accepted and ignored, so "=d1" and "d1" are the same expression.

export type LengthUnit = 'mm' | 'cm' | 'm' | 'in' | 'ft';
export type AngleUnit = 'deg' | 'rad';
export type ExprKind = 'length' | 'angle' | 'number';

const LENGTH_UNITS: Record<LengthUnit, number> = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 };
const ANGLE_UNITS: Record<AngleUnit, number> = { deg: Math.PI / 180, rad: 1 };

export type ExprErrorCode =
  | 'syntax' | 'unknownName' | 'unknownFunction' | 'arity' | 'units' | 'domain' | 'divideByZero' | 'cycle' | 'empty';

export interface ExprError { code: ExprErrorCode; message: string; pos?: number; name?: string }

export type ExprNode =
  | { t: 'num'; v: number }
  | { t: 'name'; name: string; pos: number }
  | { t: 'unit'; e: ExprNode; unit: string }
  | { t: 'neg'; e: ExprNode }
  | { t: 'bin'; op: '+' | '-' | '*' | '/' | '^'; l: ExprNode; r: ExprNode; pos: number }
  | { t: 'call'; fn: string; args: ExprNode[]; pos: number };

export type ParseResult = { ok: true; ast: ExprNode } | { ok: false; error: ExprError };

/** A resolved name: length in mm, angle in radians, or a plain number. */
export interface NameValue { value: number; kind: ExprKind }

export interface EvalContext {
  names?: (name: string) => NameValue | undefined;
  /** What the result should be. Bare numbers take the default unit of this kind. Default 'length'. */
  expect?: ExprKind;
  /** Unit of bare numbers in length expressions. Default mm. */
  lengthUnit?: LengthUnit;
}

export type EvalResult = { ok: true; value: number; kind: ExprKind } | { ok: false; error: ExprError };

type Token =
  | { k: 'num'; v: number; pos: number }
  | { k: 'name'; v: string; pos: number }
  | { k: 'op'; v: string; pos: number }
  | { k: 'end'; pos: number };

class ExprFailure extends Error {
  constructor(readonly detail: ExprError) { super(detail.message); }
}

const fail = (code: ExprErrorCode, message: string, extra: Partial<ExprError> = {}): never => {
  throw new ExprFailure({ code, message, ...extra });
};

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (/[0-9.]/.test(ch)) {
      const m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i));
      if (!m) fail('syntax', `Bad number at ${i}`, { pos: i });
      const text = (m as RegExpExecArray)[0];
      out.push({ k: 'num', v: Number(text), pos: i });
      i += text.length;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i)) as RegExpExecArray;
      out.push({ k: 'name', v: m[0], pos: i });
      i += m[0].length;
      continue;
    }
    if ('+-*/^(),'.includes(ch)) {
      out.push({ k: 'op', v: ch, pos: i });
      i++;
      continue;
    }
    fail('syntax', `Unexpected character '${ch}'`, { pos: i });
  }
  out.push({ k: 'end', pos: src.length });
  return out;
}

const isUnit = (s: string): boolean => s in LENGTH_UNITS || s in ANGLE_UNITS;

class Parser {
  private i = 0;
  constructor(private readonly toks: Token[]) {}

  private peek(): Token { return this.toks[this.i]; }
  private isOp(v: string): boolean {
    const t = this.peek();
    return t.k === 'op' && t.v === v;
  }
  private takeOp(v: string): boolean {
    if (this.isOp(v)) { this.i++; return true; }
    return false;
  }

  parse(): ExprNode {
    const e = this.expr();
    const t = this.peek();
    if (t.k !== 'end') fail('syntax', `Unexpected '${'v' in t ? t.v : ''}'`, { pos: t.pos });
    return e;
  }

  private expr(): ExprNode {
    let l = this.term();
    for (;;) {
      const pos = this.peek().pos;
      if (this.takeOp('+')) l = { t: 'bin', op: '+', l, r: this.term(), pos };
      else if (this.takeOp('-')) l = { t: 'bin', op: '-', l, r: this.term(), pos };
      else return l;
    }
  }

  private term(): ExprNode {
    let l = this.unary();
    for (;;) {
      const pos = this.peek().pos;
      if (this.takeOp('*')) l = { t: 'bin', op: '*', l, r: this.unary(), pos };
      else if (this.takeOp('/')) l = { t: 'bin', op: '/', l, r: this.unary(), pos };
      else return l;
    }
  }

  private unary(): ExprNode {
    if (this.takeOp('-')) return { t: 'neg', e: this.unary() };
    if (this.takeOp('+')) return this.unary();
    return this.power();
  }

  private power(): ExprNode {
    const l = this.postfix();
    const pos = this.peek().pos;
    if (this.takeOp('^')) return { t: 'bin', op: '^', l, r: this.unary(), pos };
    return l;
  }

  private postfix(): ExprNode {
    const e = this.primary();
    const t = this.peek();
    if (t.k === 'name' && isUnit(t.v) && (e.t === 'num' || this.parenthesised)) {
      this.i++;
      this.parenthesised = false;
      return { t: 'unit', e, unit: t.v };
    }
    this.parenthesised = false;
    return e;
  }

  private parenthesised = false;

  private primary(): ExprNode {
    const t = this.peek();
    if (t.k === 'num') {
      this.i++;
      return { t: 'num', v: t.v };
    }
    if (t.k === 'name') {
      this.i++;
      if (this.takeOp('(')) {
        const args: ExprNode[] = [];
        if (!this.takeOp(')')) {
          do args.push(this.expr()); while (this.takeOp(','));
          if (!this.takeOp(')')) fail('syntax', `Missing ')' after arguments of ${t.v}`, { pos: this.peek().pos });
        }
        return { t: 'call', fn: t.v, args, pos: t.pos };
      }
      return { t: 'name', name: t.v, pos: t.pos };
    }
    if (this.takeOp('(')) {
      const e = this.expr();
      if (!this.takeOp(')')) fail('syntax', "Missing ')'", { pos: this.peek().pos });
      this.parenthesised = true;
      return e;
    }
    if (t.k === 'end') return fail('syntax', 'Unexpected end of expression', { pos: t.pos });
    return fail('syntax', `Unexpected '${t.v}'`, { pos: t.pos });
  }
}

/** Parse an expression into an AST. */
export function parseExpression(text: string): ParseResult {
  const src = text.trim().replace(/^=/, '');
  if (src.trim() === '') return { ok: false, error: { code: 'empty', message: 'Empty expression' } };
  try {
    return { ok: true, ast: new Parser(tokenize(src)).parse() };
  } catch (e) {
    if (e instanceof ExprFailure) return { ok: false, error: e.detail };
    throw e;
  }
}

// A value carries its length exponent and whether it is an angle. `soft` marks a pi-derived number:
// it counts as radians in an angle expression but as a plain factor anywhere else.
interface Val { v: number; len: number; angle: boolean; soft: boolean; bare: boolean }

const plain = (v: number, bare = true): Val => ({ v, len: 0, angle: false, soft: false, bare });

type Reduce = (a: number[]) => number;
const FN1: Record<string, (x: number) => number> = {
  abs: Math.abs, floor: Math.floor, ceil: Math.ceil, round: Math.round,
};
const REDUCERS: Record<string, Reduce> = { min: (a) => Math.min(...a), max: (a) => Math.max(...a) };

const finite = (v: number, what: string): number => (Number.isFinite(v) ? v : fail('domain', `${what} is out of range`));

function toRadians(a: Val): number {
  return a.v;
}

function coerceForAddition(l: Val, r: Val, ctx: Resolved): [Val, Val] {
  if (l.len === r.len && l.angle === r.angle) return [l, r];
  const fix = (bare: Val, other: Val): Val | null => {
    if (!bare.bare) return null;
    if (other.len === 1) return { ...bare, v: bare.v * ctx.unitScale, len: 1, bare: false };
    if (other.angle && other.len === 0) return { ...bare, v: bare.soft ? bare.v : (bare.v * Math.PI) / 180, angle: true, bare: false };
    return null;
  };
  if (l.bare && !r.bare) {
    const f = fix(l, r);
    if (f) return [f, r];
  }
  if (r.bare && !l.bare) {
    const f = fix(r, l);
    if (f) return [l, f];
  }
  if (l.soft && r.angle) return [{ ...l, angle: true }, r];
  if (r.soft && l.angle) return [l, { ...r, angle: true }];
  return fail('units', 'Cannot add values of different units');
}

interface Resolved { names: (n: string) => NameValue | undefined; unitScale: number }

function evalNode(n: ExprNode, ctx: Resolved): Val {
  switch (n.t) {
    case 'num': return plain(n.v);
    case 'name': {
      if (n.name === 'pi' || n.name === 'PI') return { v: Math.PI, len: 0, angle: false, soft: true, bare: true };
      const hit = ctx.names(n.name);
      if (!hit) return fail('unknownName', `Unknown name '${n.name}'`, { pos: n.pos, name: n.name });
      return { v: hit.value, len: hit.kind === 'length' ? 1 : 0, angle: hit.kind === 'angle', soft: false, bare: false };
    }
    case 'unit': {
      const e = evalNode(n.e, ctx);
      if (!e.bare) return fail('units', `Cannot apply ${n.unit} to a value that already has units`);
      if (n.unit in LENGTH_UNITS) return { v: e.v * LENGTH_UNITS[n.unit as LengthUnit], len: 1, angle: false, soft: false, bare: false };
      return { v: e.v * ANGLE_UNITS[n.unit as AngleUnit], len: 0, angle: true, soft: false, bare: false };
    }
    case 'neg': {
      const e = evalNode(n.e, ctx);
      return { ...e, v: -e.v };
    }
    case 'bin': return evalBin(n, ctx);
    case 'call': return evalCall(n, ctx);
  }
}

function evalBin(n: Extract<ExprNode, { t: 'bin' }>, ctx: Resolved): Val {
  const l0 = evalNode(n.l, ctx);
  const r0 = evalNode(n.r, ctx);
  switch (n.op) {
    case '+': case '-': {
      const [l, r] = coerceForAddition(l0, r0, ctx);
      return { ...l, v: n.op === '+' ? l.v + r.v : l.v - r.v, soft: l.soft || r.soft, bare: l.bare && r.bare };
    }
    case '*': return {
      v: l0.v * r0.v, len: l0.len + r0.len, angle: l0.angle || r0.angle, soft: l0.soft || r0.soft, bare: l0.bare && r0.bare,
    };
    case '/': {
      if (r0.v === 0) return fail('divideByZero', 'Division by zero', { pos: n.pos });
      const angle = l0.angle && !r0.angle;
      return { v: l0.v / r0.v, len: l0.len - r0.len, angle, soft: l0.soft || r0.soft, bare: l0.bare && r0.bare };
    }
    case '^': {
      if (r0.len !== 0 || r0.angle) return fail('units', 'Exponent must be a plain number', { pos: n.pos });
      if (l0.len !== 0 && !Number.isInteger(l0.len * r0.v)) return fail('units', 'Fractional power of a length', { pos: n.pos });
      return { v: finite(Math.pow(l0.v, r0.v), 'Power'), len: l0.len * r0.v, angle: false, soft: false, bare: l0.bare };
    }
  }
}

function evalCall(n: Extract<ExprNode, { t: 'call' }>, ctx: Resolved): Val {
  const args = n.args.map((a) => evalNode(a, ctx));
  const need = (count: number): void => {
    if (args.length !== count) fail('arity', `${n.fn} takes ${count} argument${count === 1 ? '' : 's'}`, { pos: n.pos });
  };
  switch (n.fn) {
    case 'sqrt': {
      need(1);
      const a = args[0];
      if (a.v < 0) return fail('domain', 'sqrt of a negative value', { pos: n.pos });
      if (a.len % 2 !== 0) return fail('units', 'sqrt of a length', { pos: n.pos });
      return { v: Math.sqrt(a.v), len: a.len / 2, angle: false, soft: false, bare: a.bare };
    }
    case 'sin': case 'cos': case 'tan': {
      need(1);
      const a = args[0];
      if (a.len !== 0) return fail('units', `${n.fn} of a length`, { pos: n.pos });
      const r = toRadians(a);
      return plain(finite(n.fn === 'sin' ? Math.sin(r) : n.fn === 'cos' ? Math.cos(r) : Math.tan(r), n.fn), false);
    }
    case 'asin': case 'acos': case 'atan': {
      need(1);
      const a = args[0];
      if (a.len !== 0 || a.angle) return fail('units', `${n.fn} needs a plain number`, { pos: n.pos });
      if (n.fn !== 'atan' && Math.abs(a.v) > 1) return fail('domain', `${n.fn} outside [-1, 1]`, { pos: n.pos });
      const v = n.fn === 'asin' ? Math.asin(a.v) : n.fn === 'acos' ? Math.acos(a.v) : Math.atan(a.v);
      return { v, len: 0, angle: true, soft: false, bare: false };
    }
    case 'min': case 'max': {
      if (args.length === 0) return fail('arity', `${n.fn} needs at least one argument`, { pos: n.pos });
      let acc = args[0];
      const values = [acc.v];
      for (let i = 1; i < args.length; i++) {
        const [l, r] = coerceForAddition(acc, args[i], ctx);
        acc = l;
        values[0] = l.v;
        values.push(r.v);
      }
      return { ...acc, v: REDUCERS[n.fn](values) };
    }
    default: {
      const f = FN1[n.fn];
      if (!f) return fail('unknownFunction', `Unknown function '${n.fn}'`, { pos: n.pos, name: n.fn });
      need(1);
      return { ...args[0], v: f(args[0].v) };
    }
  }
}

function finish(val: Val, ctx: EvalContext, scale: number): EvalResult {
  const expect = ctx.expect ?? 'length';
  if (expect === 'length') {
    if (val.len === 1) return { ok: true, value: val.v, kind: 'length' };
    if (val.len === 0 && !val.angle) return { ok: true, value: val.v * scale, kind: 'length' };
  } else if (expect === 'angle') {
    if (val.len === 0 && val.angle) return { ok: true, value: val.v, kind: 'angle' };
    if (val.len === 0 && val.soft) return { ok: true, value: val.v, kind: 'angle' };
    if (val.len === 0) return { ok: true, value: (val.v * Math.PI) / 180, kind: 'angle' };
  } else if (val.len === 0) {
    return { ok: true, value: val.v, kind: val.angle ? 'angle' : 'number' };
  } else if (val.len === 1) {
    return { ok: true, value: val.v, kind: 'length' };
  }
  return { ok: false, error: { code: 'units', message: `Expected a ${expect} value` } };
}

/** Evaluate a parsed expression. Result is in mm or radians. */
export function evaluateAst(ast: ExprNode, ctx: EvalContext = {}): EvalResult {
  const scale = LENGTH_UNITS[ctx.lengthUnit ?? 'mm'];
  try {
    return finish(evalNode(ast, { names: ctx.names ?? (() => undefined), unitScale: scale }), ctx, scale);
  } catch (e) {
    if (e instanceof ExprFailure) return { ok: false, error: e.detail };
    throw e;
  }
}

/** Parse and evaluate. */
export function evaluateExpression(text: string, ctx: EvalContext = {}): EvalResult {
  const parsed = parseExpression(text);
  return parsed.ok ? evaluateAst(parsed.ast, ctx) : parsed;
}

function collectNames(n: ExprNode, out: Set<string>): void {
  switch (n.t) {
    case 'name': if (n.name !== 'pi' && n.name !== 'PI') out.add(n.name); break;
    case 'unit': case 'neg': collectNames(n.e, out); break;
    case 'bin': collectNames(n.l, out); collectNames(n.r, out); break;
    case 'call': n.args.forEach((a) => collectNames(a, out)); break;
    case 'num': break;
  }
}

/** Names an expression references, excluding constants and units. Empty when it does not parse. */
export function expressionDeps(text: string): string[] {
  const parsed = parseExpression(text);
  if (!parsed.ok) return [];
  const out = new Set<string>();
  collectNames(parsed.ast, out);
  return [...out];
}

function namePlaces(n: ExprNode, out: { name: string; pos: number }[]): void {
  switch (n.t) {
    case 'name': out.push({ name: n.name, pos: n.pos }); break;
    case 'unit': case 'neg': namePlaces(n.e, out); break;
    case 'bin': namePlaces(n.l, out); namePlaces(n.r, out); break;
    case 'call': n.args.forEach((a) => namePlaces(a, out)); break;
    case 'num': break;
  }
}

/** `text` with each of the names in `by` replaced by what it maps to. Text that does not parse comes back as it was. */
export function replaceNames(text: string, by: ReadonlyMap<string, string>): string {
  const parsed = parseExpression(text);
  if (!parsed.ok) return text;
  const places: { name: string; pos: number }[] = [];
  namePlaces(parsed.ast, places);
  let out = text;
  for (const { name, pos } of places.filter((p) => by.has(p.name)).sort((a, b) => b.pos - a.pos)) {
    const alone = text.trim() === name;
    const value = by.get(name) as string;
    out = out.slice(0, pos) + (alone ? value : `(${value})`) + out.slice(pos + name.length);
  }
  return out;
}

/** Find one cycle in a name -> dependencies graph. Returns the names on it, or null. */
export function findCycle(graph: ReadonlyMap<string, readonly string[]>): string[] | null {
  const state = new Map<string, 1 | 2>();
  const stack: string[] = [];
  const visit = (n: string): string[] | null => {
    state.set(n, 1);
    stack.push(n);
    for (const d of graph.get(n) ?? []) {
      if (!graph.has(d)) continue;
      const s = state.get(d);
      if (s === 1) return stack.slice(stack.indexOf(d));
      if (s === undefined) {
        const c = visit(d);
        if (c) return c;
      }
    }
    stack.pop();
    state.set(n, 2);
    return null;
  };
  for (const n of graph.keys()) {
    if (!state.has(n)) {
      const c = visit(n);
      if (c) return c;
    }
  }
  return null;
}

/** True if a name may be used for a parameter: an identifier that is not a unit, function or constant. */
export function isValidName(name: string): boolean {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return false;
  if (isUnit(name) || name === 'pi' || name === 'PI') return false;
  return !['sqrt', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'abs', 'min', 'max', 'floor', 'ceil', 'round'].includes(name);
}
