//! Component split, drag strategy and the outer iteration around ezpz.
//!
//! ezpz priorities are not soft constraints. Each level re-solves from the initial guesses, and if
//! adding a level leaves anything unsatisfied the whole level is thrown away and the previous
//! result returned. So one unreachable drag target would discard every other target and leave the
//! geometry where it was, rather than moving it as close as it can go. Levels also multiply the
//! cost, since each builds a fresh model. This module therefore calls ezpz with a single priority
//! and sequences the attempts itself:
//!
//! 1. Constraints + drag targets + holds, as hard rows, with a short iteration budget. The
//!    Gauss-Newton step is the minimum-norm one (JtJ + 1e-9 I), so anything the constraints don't
//!    tie to the dragged point stays put. This is the common case: one model build, 2-4 iterations.
//! 2. If the dragged variables are locally rigid, stop: the geometry stays (step 6).
//! 3. Constraints + drag targets, if holds were what made it fail.
//! 4. The same seeded by translating the whole component. A long rigid chain is badly conditioned
//!    (its bending modes sink below ezpz's fixed lambda), and a translation solves it outright.
//! 5. Target unreachable: walk the constraint tangent space toward it, projecting back after each
//!    step (see `follow_tangent`). This ends at the reachable point nearest the cursor.
//! 6. Constraints alone from the incoming geometry.
//!
//! A solve that is not a drag goes through `undisturbed` first. The minimum-norm step keeps things
//! put only to first order: each row shares its residual among all its variables whatever they
//! mean, and the row space turns from step to step, so the solve also walks along the free
//! directions. A dimension on one edge of a rectangle changes the radius of a circle whose rim
//! point is on the diagonal, and the rectangle's height with it. So values the constraints leave
//! free are held instead: sizes first, and rows that variables of their own can meet are left out
//! until the rest is solved, which stops them pulling on it. A drag has a target to follow, and its
//! steps are too small for this to show.
//!
//! Holding sizes is not enough for a shape: a line's length and an arc's sweep are as much the user's
//! as a radius. So the first thing tried is every one of them that the rows leave free (`free_spans`),
//! and if they cannot all stay, as many as can. That is a preference, not a limit: where it cannot be
//! met, the shape gives way.
//!
//! A numeric solve also lands wherever the nearest root is, and that can be another branch of the same
//! geometry: an arc round the other way, a triangle turned over. `Input::branches` names what must not
//! jump; a solution that does is turned down, and `crossed` in the output says so. The bridge then walks
//! to the value in steps, each continuous with the last, so anywhere a value can be reached by degrees,
//! the geometry goes.
//!
//! A failed component keeps its incoming geometry, so a conflict in one component never moves
//! another.

use crate::analysis;
use crate::api::{Input, Output};
use crate::branch;
use crate::eq::{Eq, L, P, V};
use crate::sys::{self, Mode, Sys};
use kcl_ezpz::{Config, ConstraintRequest, FailureOutcome, SolveOutcome};
use std::cell::{Cell, RefCell};
use std::collections::BTreeSet;
use std::sync::atomic::{AtomicU8, Ordering};

/// Which step ezpz takes: 0 not settled yet, 1 Gauss-Newton, 2 DogLeg.
static METHOD: AtomicU8 = AtomicU8::new(0);

/// Take the DogLeg step in place of Gauss-Newton, from the next solve on. A trial, off by default.
pub fn set_dogleg(on: bool) {
    METHOD.store(if on { 2 } else { 1 }, Ordering::Relaxed);
}

/// Whether solves take the DogLeg step. Left unset, `SKETCH_SOLVER=dogleg` in the environment turns
/// it on, which is how the cargo tests run with it. wasm has no environment.
pub fn dogleg() -> bool {
    match METHOD.load(Ordering::Relaxed) {
        0 => {
            let on = std::env::var("SKETCH_SOLVER").is_ok_and(|v| v == "dogleg");
            set_dogleg(on);
            on
        }
        method => method == 2,
    }
}

/// Every `Config` a solve uses starts here.
pub(crate) fn config() -> Config {
    Config::default().with_dogleg(dogleg())
}

/// Largest residual counted as satisfied. Gauss-Newton gets below 1e-8 when the system is
/// consistent; anything left above this is a real inconsistency.
const SATISFIED: f64 = 1e-6;
const MAX_OUTER: usize = 12;
const OUTER_TOL: f64 = 1e-7;
const QUICK_ITERATIONS: usize = 12;
/// Past this many sizes that can't all stay, stop trying them one at a time.
const MAX_SIZE_TRIALS: usize = 32;
/// The share of its length a wall may be left with and still have stayed in place to any purpose.
const MIN_WALL: f64 = 0.5;
/// The most an arc's sweep may change for a wall to stay. Small, since a walk adds these up.
const MAX_WALL_SWEEP: f64 = std::f64::consts::PI / 9.0;
/// A span this close to its old length has stayed.
const SPAN_TOL: f64 = 1e-7;
/// A size that moved by less than this share of itself has stayed.
const SIZE_TOL: f64 = 1e-6;

/// A coordinate a guard reads: a variable of the component, or a constant to it.
#[derive(Clone, Copy)]
enum At {
    Var(V),
    Const(f64),
}

impl At {
    fn get(self, vals: &[f64]) -> f64 {
        match self {
            At::Var(v) => vals[v as usize],
            At::Const(x) => x,
        }
    }
}

type Read = [At; 2];
/// A loop's corners, its arc edges, and the side it began on.
type LoopGuard = (Vec<Read>, Vec<(usize, Read, bool)>, f64);

/// What a solve must not jump, in this component's terms.
#[derive(Default)]
struct Guard {
    /// Centre and ends, and the sweep the solve began at.
    arcs: Vec<([Read; 3], f64)>,
    loops: Vec<LoopGuard>,
}

struct Comp {
    /// Global variable of each local variable.
    vars: Vec<V>,
    eqs: Vec<Eq>,
    /// Global row behind each of `eqs`.
    rows: Vec<usize>,
    reqs: Vec<ConstraintRequest>,
    targets: Vec<(V, f64)>,
    holds: Vec<(V, f64)>,
    nonneg: Vec<V>,
    has_dyn: bool,
    guard: Guard,
    /// A solution was turned down for jumping: 1 an arc, 2 a loop gone flat, 3 a loop turned over.
    crossed: Cell<u8>,
    /// Every free size and span stayed.
    kept: Cell<bool>,
    /// The sizes the rows left free, as they came in, for telling afterwards which did not stay.
    free_sizes: RefCell<Vec<(V, f64)>>,
    /// Largest residual counted as met.
    slack: f64,
}

/// Which rows are left once every group of rows that variables of their own could meet is taken
/// out, again and again: a row with a variable nothing else uses, or the two rows on a point that
/// is on two curves. What is taken out can be met afterwards, so it has no need to pull on the rest.
fn core_rows(eqs: &[Eq], fixed: &[bool]) -> Vec<bool> {
    let vars: Vec<Vec<V>> = eqs
        .iter()
        .map(|e| {
            let mut v = Vec::new();
            e.vars(&mut v);
            v.sort_unstable();
            v.dedup();
            v.retain(|&x| !fixed[x as usize]);
            v
        })
        .collect();
    let mut rows_of: Vec<Vec<usize>> = vec![Vec::new(); fixed.len()];
    for (i, vs) in vars.iter().enumerate() {
        vs.iter().for_each(|&v| rows_of[v as usize].push(i));
    }
    let mut core = vec![true; eqs.len()];
    let mut to_look_at: Vec<V> = (0..fixed.len() as V).collect();
    while let Some(v) = to_look_at.pop() {
        let group: Vec<usize> = rows_of[v as usize]
            .iter()
            .copied()
            .filter(|&i| core[i])
            .collect();
        if group.is_empty() || group.len() > 2 {
            continue;
        }
        let needed: usize = group.iter().map(|&i| eqs[i].dim()).sum();
        let mut touched: Vec<V> = group
            .iter()
            .flat_map(|&i| vars[i].iter().copied())
            .collect();
        touched.sort_unstable();
        touched.dedup();
        let own = touched.iter().filter(|&&x| {
            rows_of[x as usize]
                .iter()
                .all(|i| !core[*i] || group.contains(i))
        });
        if own.count() >= needed {
            group.iter().for_each(|&i| core[i] = false);
            to_look_at.extend(touched);
        }
    }
    core
}

fn find(parent: &mut [V], mut v: V) -> V {
    while parent[v as usize] != v {
        let p = parent[parent[v as usize] as usize];
        parent[v as usize] = p;
        v = p;
    }
    v
}

/// The variables of each line and arc.
fn shapes(sys: &Sys) -> Vec<Vec<V>> {
    let flat = |ps: &[P]| ps.iter().flat_map(|p| [p.0, p.1]).collect::<Vec<V>>();
    let lines = sys.lines.iter().map(|l| flat(&[l.0, l.1]));
    let walls = sys.walls.iter().map(|w| flat(w));
    lines.chain(sys.arcs.iter().map(|a| flat(a))).chain(walls).collect()
}

/// Fixed variables don't join components: each component gets its own constant copy. With `whole`, a
/// shape joins all it touches, which brings in a far end no row mentions, and the X and Y that horizontal
/// and vertical rows would otherwise part: holding a shape needs both. A drag has no use for that, and
/// every variable costs it time.
fn components(sys: &Sys, whole: bool) -> Vec<Comp> {
    let n = sys.vals.len();
    let mut parent: Vec<V> = (0..n as V).collect();
    let mut vars = Vec::with_capacity(16);
    for r in &sys.rows {
        vars.clear();
        r.eq.vars(&mut vars);
        let mut first = None;
        for &v in vars.iter().filter(|&&v| !sys.fixed[v as usize]) {
            let rv = find(&mut parent, v);
            match first {
                None => first = Some(rv),
                Some(f) => parent[rv as usize] = f,
            }
        }
    }
    let linked = if whole { shapes(sys) } else { Vec::new() };
    for vs in &linked {
        let mut first = None;
        for &v in vs.iter().filter(|&&v| !sys.fixed[v as usize]) {
            let rv = find(&mut parent, v);
            match first {
                None => first = Some(rv),
                Some(f) => parent[rv as usize] = f,
            }
        }
    }

    let mut comp_of_root = vec![u32::MAX; n];
    let mut groups: Vec<Vec<usize>> = Vec::new();
    for (i, r) in sys.rows.iter().enumerate() {
        vars.clear();
        r.eq.vars(&mut vars);
        let Some(&v) = vars.iter().find(|&&v| !sys.fixed[v as usize]) else {
            continue;
        };
        let root = find(&mut parent, v) as usize;
        if comp_of_root[root] == u32::MAX {
            comp_of_root[root] = groups.len() as u32;
            groups.push(Vec::new());
        }
        groups[comp_of_root[root] as usize].push(i);
    }
    let mut extra: Vec<Vec<V>> = vec![Vec::new(); groups.len()];
    for vs in &linked {
        if let Some(&v) = vs.iter().find(|&&v| !sys.fixed[v as usize]) {
            let c = comp_of_root[find(&mut parent, v) as usize];
            if c != u32::MAX {
                extra[c as usize].extend_from_slice(vs);
            }
        }
    }

    let mut local = vec![u32::MAX; n];
    let mut out = Vec::with_capacity(groups.len());
    for (rows, more) in groups.into_iter().zip(extra) {
        let mut cvars: Vec<V> = Vec::new();
        for &i in &rows {
            vars.clear();
            sys.rows[i].eq.vars(&mut vars);
            for &v in &vars {
                if local[v as usize] == u32::MAX {
                    local[v as usize] = cvars.len() as u32;
                    cvars.push(v);
                }
            }
        }
        for v in more {
            if local[v as usize] == u32::MAX {
                local[v as usize] = cvars.len() as u32;
                cvars.push(v);
            }
        }
        let map = |v: V| local[v as usize];
        let eqs: Vec<Eq> = rows.iter().map(|&i| sys.rows[i].eq.map(&map)).collect();
        let mut comp = Comp {
            eqs,
            rows,
            reqs: Vec::new(),
            targets: Vec::new(),
            holds: Vec::new(),
            nonneg: Vec::new(),
            has_dyn: false,
            vars: Vec::new(),
            guard: Guard::default(),
            crossed: Cell::new(0),
            kept: Cell::new(true),
            free_sizes: RefCell::new(Vec::new()),
            slack: SATISFIED,
        };
        let lv = |v: V| {
            let l = local[v as usize];
            (l != u32::MAX).then_some(l)
        };
        // A point's X and Y can sit in different components (H/V rows decouple them).
        for t in &sys.targets {
            comp.targets.extend(lv(t.0.0).map(|v| (v, t.1)));
            comp.targets.extend(lv(t.0.1).map(|v| (v, t.2)));
        }
        for h in &sys.holds {
            comp.holds
                .extend(lv(h.0).map(|v| (v, sys.vals[h.0 as usize])));
            comp.holds
                .extend(lv(h.1).map(|v| (v, sys.vals[h.1 as usize])));
        }
        comp.nonneg = sys.nonneg.iter().filter_map(|&v| lv(v)).collect();
        // A guard reads a coordinate from another component as it stands: X and Y often part ways.
        let read = |p: P| {
            [p.0, p.1].map(|v| match lv(v) {
                Some(l) => At::Var(l),
                None => At::Const(sys.vals[v as usize]),
            })
        };
        let now = |p: P| (sys.vals[p.0 as usize], sys.vals[p.1 as usize]);
        let moves = |p: P| lv(p.0).is_some() || lv(p.1).is_some();
        for &([c, a, b], began) in &sys.branches.arcs {
            if [c, a, b].into_iter().any(moves) && now(a) != now(b) {
                comp.guard.arcs.push(([read(c), read(a), read(b)], began));
            }
        }
        for (pts, bulges, on) in &sys.branches.loops {
            if pts.iter().any(|&p| moves(p)) {
                let arcs = bulges.iter().map(|&(at, c, ccw)| (at, read(c), ccw)).collect();
                comp.guard.loops.push((pts.iter().map(|&p| read(p)).collect(), arcs, *on));
            }
        }
        for &v in &cvars {
            local[v as usize] = u32::MAX;
        }
        comp.vars = cvars;
        out.push(comp);
    }
    out
}

impl Comp {
    fn sync(&mut self, sys: &Sys) {
        // Rows are remapped once; only constants of dynamic rows change between rounds.
        let mut local = vec![u32::MAX; sys.vals.len()];
        for (l, &v) in self.vars.iter().enumerate() {
            local[v as usize] = l as u32;
        }
        let map = |v: V| local[v as usize];
        for (k, &i) in self.rows.iter().enumerate() {
            self.eqs[k] = sys.rows[i].eq.map(&map);
        }
        self.lower(sys);
    }

    fn lower(&mut self, sys: &Sys) {
        self.reqs.clear();
        for e in &self.eqs {
            self.reqs
                .push(ConstraintRequest::highest_priority(e.lower()));
        }
        for (l, &v) in self.vars.iter().enumerate() {
            if sys.fixed[v as usize] {
                let c = Eq::Fixed(l as V, sys.vals[v as usize]).lower();
                self.reqs.push(ConstraintRequest::highest_priority(c));
            }
        }
    }

    fn values(&self, sys: &Sys) -> Vec<f64> {
        self.vars.iter().map(|&v| sys.vals[v as usize]).collect()
    }

    fn unsat_rows(&self, vals: &[f64]) -> Vec<usize> {
        let x = |v: V| vals[v as usize];
        let mut out = Vec::new();
        for (k, e) in self.eqs.iter().enumerate() {
            let r = e.eval::<f64>(&x);
            if r[0].abs() > self.slack || r[1].abs() > self.slack || !r[0].is_finite() {
                out.push(self.rows[k]);
            }
        }
        out
    }

    fn valid(&self, vals: &[f64]) -> bool {
        vals.iter().all(|v| v.is_finite()) && self.nonneg.iter().all(|&v| vals[v as usize] >= -1e-9)
    }

    /// Whether `vals` is continuous with where the solve began. Remembers what it turned down.
    fn on_branch(&self, vals: &[f64]) -> bool {
        let pt = |p: &Read| (p[0].get(vals), p[1].get(vals));
        let mut turned = 0;
        for (at, began) in &self.guard.arcs {
            if branch::arc_jumped(branch::sweep(pt(&at[0]), pt(&at[1]), pt(&at[2])), *began) {
                turned = 1;
            }
        }
        for (pts, bulges, on) in &self.guard.loops {
            let arcs: Vec<branch::Bulge> = bulges.iter().map(|(at, c, ccw)| (*at, pt(c), *ccw)).collect();
            let now = branch::side_of(&pts.iter().map(pt).collect::<Vec<_>>(), &arcs);
            if now == 0.0 {
                turned = turned.max(2);
            } else if now * on < 0.0 {
                turned = 3;
            }
        }
        self.crossed.set(self.crossed.get().max(turned));
        turned == 0
    }

    fn solve(
        &self,
        extra: &[(V, f64)],
        start: &[f64],
        cfg: Config,
    ) -> Result<SolveOutcome, FailureOutcome> {
        let mut reqs = Vec::with_capacity(self.reqs.len() + extra.len());
        reqs.extend_from_slice(&self.reqs);
        for &(v, x) in extra {
            reqs.push(ConstraintRequest::highest_priority(Eq::Fixed(v, x).lower()));
        }
        let guess: Vec<(V, f64)> = start
            .iter()
            .enumerate()
            .map(|(i, &x)| (i as V, x))
            .collect();
        kcl_ezpz::solve(&reqs, guess, cfg)
    }

    /// Solved values if the attempt satisfies everything it was asked to.
    fn attempt(
        &self,
        extra: &[(V, f64)],
        start: &[f64],
        cfg: Config,
        iters: &mut usize,
    ) -> Option<Vec<f64>> {
        let out = self.solve(extra, start, cfg).ok()?;
        *iters += out.iterations();
        let vals = out.final_values();
        let extras_ok = extra
            .iter()
            .all(|&(v, x)| (vals[v as usize] - x).abs() < SATISFIED);
        (extras_ok && self.unsat_rows(vals).is_empty() && self.valid(vals) && self.on_branch(vals))
            .then(|| vals.to_vec())
    }

    /// Unconverged least squares: ezpz returns values only through its step-tolerance exit.
    fn least_squares(
        &self,
        extra: &[(V, f64)],
        start: &[f64],
        iters: &mut usize,
    ) -> Option<Vec<f64>> {
        let cfg = config()
            .with_step_tolerance(1e-4)
            .with_max_iterations(40);
        let out = self.solve(extra, start, cfg).ok()?;
        *iters += out.iterations();
        let vals = out.final_values();
        vals.iter().all(|v| v.is_finite()).then(|| vals.to_vec())
    }

    fn local_fixed(&self, sys: &Sys) -> Vec<bool> {
        self.vars.iter().map(|&v| sys.fixed[v as usize]).collect()
    }

    /// A locally rigid point must not go looking for another solution branch: projecting a far
    /// target back onto the constraints would snap a fully determined triangle to its mirror image.
    fn targets_can_move(&self, sys: &Sys, base: &[f64]) -> bool {
        let f = analysis::analyze(self.eqs.iter(), base, &self.local_fixed(sys));
        self.targets.iter().any(|t| f.free[t.0 as usize])
    }

    /// Constrained descent toward an unreachable target: step along the constraint tangent space
    /// toward it, project back, repeat. Unlike least squares this has no weighting between target
    /// and constraint rows, so a stiff angle row can't be bent and spring back.
    fn follow_tangent(&self, sys: &Sys, base: &[f64], iters: &mut usize) -> Option<Vec<f64>> {
        let fixed = self.local_fixed(sys);
        let quick = config().with_max_iterations(QUICK_ITERATIONS);
        let rounds = if self.vars.len() < 200 { 12 } else { 3 };
        let miss = |x: &[f64]| -> f64 {
            self.targets
                .iter()
                .map(|&(v, t)| (t - x[v as usize]).powi(2))
                .sum()
        };
        let mut x = base.to_vec();
        let mut moved = false;
        let mut scale: f64 = 1.0;
        for _ in 0..rounds {
            let f = analysis::analyze(self.eqs.iter(), &x, &fixed);
            let wanted: Vec<(V, f64)> = self
                .targets
                .iter()
                .filter(|t| f.free[t.0 as usize])
                .map(|&(v, t)| (v, t - x[v as usize]))
                .collect();
            let Some(d) = f.tangent_motion(&wanted, &fixed) else {
                break;
            };
            let now = miss(&x);
            let gain: f64 = self.targets.iter().map(|t| d[t.0 as usize].powi(2)).sum();
            let mut accepted = None;
            while scale > 1e-4 {
                let start: Vec<f64> = x.iter().zip(&d).map(|(a, b)| a + b * scale).collect();
                match self.attempt(&[], &start, quick, iters) {
                    // On a curved constraint a long tangent step projects past the nearest point
                    // and then bounces around it, so a bare decrease is not enough.
                    Some(v) if miss(&v) <= now - 0.25 * scale * gain => {
                        accepted = Some(v);
                        scale = (scale * 2.0).min(1.0);
                        break;
                    }
                    _ => scale *= 0.5,
                }
            }
            let Some(next) = accepted else { break };
            let step = next
                .iter()
                .zip(&x)
                .map(|(a, b)| (a - b).abs())
                .fold(0.0, f64::max);
            x = next;
            moved = true;
            if step < 1e-4 {
                break;
            }
        }
        moved.then_some(x)
    }

    /// `attempt` on only the rows in `core`, with `also` on top. A variable in none of them stays.
    fn attempt_rows(
        &self,
        core: &[bool],
        extra: &[(V, f64)],
        also: &[Eq],
        start: &[f64],
        iters: &mut usize,
    ) -> Option<Vec<f64>> {
        let rows = self.reqs.iter().enumerate();
        let mut reqs: Vec<ConstraintRequest> = rows
            .filter(|(k, _)| core.get(*k).copied().unwrap_or(true))
            .map(|(_, r)| *r)
            .collect();
        let held = extra.iter().map(|&(v, x)| Eq::Fixed(v, x));
        reqs.extend(
            held.chain(also.iter().cloned())
                .map(|e| ConstraintRequest::highest_priority(e.lower())),
        );
        let guess = start
            .iter()
            .enumerate()
            .map(|(i, &x)| (i as V, x))
            .collect();
        let cfg = config().with_max_iterations(QUICK_ITERATIONS);
        let out = kcl_ezpz::solve(&reqs, guess, cfg).ok()?;
        *iters += out.iterations();
        let vals = out.final_values();
        let met = |e: &Eq| {
            let r = e.eval::<f64>(&|v: V| vals[v as usize]);
            r[0].abs() <= SATISFIED && r[1].abs() <= SATISFIED && r[0].is_finite()
        };
        let kept = extra
            .iter()
            .all(|&(v, x)| (vals[v as usize] - x).abs() < SATISFIED);
        let rows_met = self.eqs.iter().zip(core).all(|(e, &c)| !c || met(e));
        (kept && rows_met && also.iter().all(met) && self.valid(vals) && self.on_branch(vals))
            .then(|| vals.to_vec())
    }

    /// The shape the rows leave free, each piece as a row that would hold it: the length of every
    /// line and the sweep of every arc. One a row settles is not free to hold.
    fn free_spans(&self, sys: &Sys, base: &[f64], f: &analysis::Freedom) -> Vec<Eq> {
        let fixed = self.local_fixed(sys);
        let mut local = vec![u32::MAX; sys.vals.len()];
        for (l, &g) in self.vars.iter().enumerate() {
            local[g as usize] = l as u32;
        }
        let at = |p: P| {
            (local[p.0 as usize] != u32::MAX && local[p.1 as usize] != u32::MAX)
                .then(|| P(local[p.0 as usize], local[p.1 as usize]))
        };
        let pos = |p: P| (base[p.0 as usize], base[p.1 as usize]);
        let dir = |a: P, b: P| (pos(b).0 - pos(a).0, pos(b).1 - pos(a).1);
        let long = |d: (f64, f64)| d.0.hypot(d.1) > 1e-9;
        let mut held = Vec::new();
        for l in &sys.lines {
            if let Some((a, b)) = at(l.0).zip(at(l.1)) {
                let d = dir(a, b);
                if long(d) {
                    held.push(Eq::Dist(a, b, d.0.hypot(d.1)));
                }
            }
        }
        for &[c, a, b] in &sys.arcs {
            if let (Some(c), Some(a), Some(b)) = (at(c), at(a), at(b)) {
                let (u, v) = (dir(c, a), dir(c, b));
                if long(u) && long(v) {
                    held.push(Eq::Angle(L(c, a), L(c, b), branch::turn(u, v)));
                }
            }
        }
        // A horizontal or vertical value on a line is changing that line: its length is not to hold.
        let x = |v: V| base[v as usize];
        let asked: Vec<(P, P)> = self
            .eqs
            .iter()
            .filter(|e| matches!(e, Eq::HDist(..) | Eq::VDist(..)) && e.eval::<f64>(&x)[0].abs() > SATISFIED)
            .filter_map(|e| match e {
                Eq::HDist(a, b, _) | Eq::VDist(a, b, _) => Some((*a, *b)),
                _ => None,
            })
            .collect();
        let same = |p: P, q: P| p.0 == q.0 && p.1 == q.1;
        held.retain(|e| {
            !matches!(e, Eq::Dist(a, b, _) if asked.iter().any(|&(p, q)| (same(*a, p) && same(*b, q)) || (same(*a, q) && same(*b, p))))
                && !f.settles(e, base, &fixed)
        });
        held
    }

    /// What keeps each wall of a closed profile on the line it is on, its two ends a pair of rows.
    fn wall_rows(&self, sys: &Sys, base: &[f64]) -> Vec<[Eq; 2]> {
        let mut local = vec![u32::MAX; sys.vals.len()];
        for (l, &g) in self.vars.iter().enumerate() {
            local[g as usize] = l as u32;
        }
        let at = |p: P| (local[p.0 as usize] != u32::MAX && local[p.1 as usize] != u32::MAX).then(|| P(local[p.0 as usize], local[p.1 as usize]));
        let x = |v: V| base[v as usize];
        sys.walls
            .iter()
            .filter_map(|w| {
                let (a, b, u, v) = (at(w[0])?, at(w[1])?, at(w[2])?, at(w[3])?);
                let rows = [Eq::PointLine(a, L(u, v), 0.0), Eq::PointLine(b, L(u, v), 0.0)];
                // A wall its own coincidences have already moved off has no line to stay on.
                rows.iter().all(|e| e.eval::<f64>(&x)[0].abs() < SATISFIED).then_some(rows)
            })
            .collect()
    }

    /// As many walls of a closed profile as can stay where they are, each giving up its length if that
    /// is what it takes, then as many of the `spans` as go with that. `None` if no wall can.
    fn walls_held(&self, sys: &Sys, keep: &[(V, f64)], spans: &[Eq], base: &[f64], iters: &mut usize) -> Option<Vec<f64>> {
        let walls = self.wall_rows(sys, base);
        if walls.is_empty() || walls.len() > MAX_SIZE_TRIALS {
            return None;
        }
        let every = vec![true; self.eqs.len()];
        // The shape of an arc that has nothing to do with a wall comes first. One that ends on a wall
        // gives way with its length, that being the wall staying put; failing that, it holds as well.
        // Only a wall with a free length has a length to give.
        let same = |p: P, q: P| p.0 == q.0 && p.1 == q.1;
        let ends: Vec<P> = spans.iter().filter_map(|e| if let Eq::Dist(a, b, _) = e { Some([*a, *b]) } else { None }).flatten().collect();
        let on_line = |p: P| walls.iter().flatten().any(|e| matches!(e, Eq::PointLine(q, ..) if same(*q, p)));
        let on_wall = |p: P| on_line(p) && ends.iter().any(|&q| same(q, p));
        let walled = |e: &Eq| matches!(e, Eq::Angle(a, b, _) if on_wall(a.1) || on_wall(b.1));
        [true, false].into_iter().find_map(|give| {
            let first = |e: &&Eq| matches!(e, Eq::Angle(..)) && !(give && walled(e));
            let mut held: Vec<Eq> = Vec::new();
            let mut best = None;
            for e in spans.iter().filter(first) {
                held.push(*e);
                if self.attempt_rows(&every, keep, &held, base, iters).is_none() {
                    held.pop();
                }
            }
            for rows in &walls {
                held.extend_from_slice(rows);
                match self.attempt_rows(&every, keep, &held, base, iters) {
                    Some(v) => best = Some(v),
                    None => held.truncate(held.len() - 2),
                }
            }
            let mut v = best?;
            if spans.len() <= MAX_SIZE_TRIALS {
                for e in spans.iter().filter(|e| !first(e)) {
                    held.push(*e);
                    match self.attempt_rows(&every, keep, &held, base, iters) {
                        Some(w) => v = w,
                        None => {
                            held.pop();
                        }
                    }
                }
            }
            self.wall_answer_sound(sys, v, base, give)
        })
    }

    /// A length may give way, not go: a line left under half of itself is the shape going, and the
    /// spans are the better answer then. Nor is a wall worth an arc that `swung` round.
    fn wall_answer_sound(&self, sys: &Sys, v: Vec<f64>, base: &[f64], swung: bool) -> Option<Vec<f64>> {
        let mut local = vec![u32::MAX; sys.vals.len()];
        for (l, &g) in self.vars.iter().enumerate() {
            local[g as usize] = l as u32;
        }
        let gap = |x: &[f64], p: P, q: P| {
            let at = |v: V| x[local[v as usize] as usize];
            (at(p.0) - at(q.0)).hypot(at(p.1) - at(q.1))
        };
        let whole = |v: V| local[v as usize] != u32::MAX;
        let on = |l: &&L| whole(l.0.0) && whole(l.0.1) && whole(l.1.0) && whole(l.1.1);
        let sound = sys.lines.iter().filter(on).all(|l| gap(&v, l.0, l.1) >= gap(base, l.0, l.1) * MIN_WALL);
        let sweep = |x: &[f64], a: &[P; 3]| {
            let at = |p: P| (x[local[p.0 as usize] as usize], x[local[p.1 as usize] as usize]);
            branch::sweep(at(a[0]), at(a[1]), at(a[2]))
        };
        let held = |a: &&[P; 3]| a.iter().all(|p| whole(p.0) && whole(p.1));
        let steady = !swung || sys.arcs.iter().filter(held).all(|a| (sweep(&v, a) - sweep(base, a)).abs() <= MAX_WALL_SWEEP);
        (sound && steady).then_some(v)
    }

    /// `v` with as many of the `spans` it changed put back as the rows and `keep` allow, and whether
    /// that was all of them.
    fn spans_held(
        &self,
        v: Vec<f64>,
        keep: &[(V, f64)],
        spans: &[Eq],
        base: &[f64],
        iters: &mut usize,
    ) -> (Vec<f64>, bool) {
        let stayed = |e: &&Eq| e.eval::<f64>(&|x: V| v[x as usize])[0].abs() < SPAN_TOL;
        let mut held: Vec<Eq> = spans.iter().filter(stayed).cloned().collect();
        let lost: Vec<Eq> = spans.iter().filter(|e| !stayed(e)).cloned().collect();
        if lost.is_empty() || lost.len() > MAX_SIZE_TRIALS {
            return (v, lost.is_empty());
        }
        let every = vec![true; self.eqs.len()];
        let mut best = None;
        let mut all = true;
        for e in lost {
            held.push(e);
            match self.attempt_rows(&every, keep, &held, base, iters) {
                Some(w) => best = Some(w),
                None => {
                    held.pop();
                    all = false;
                }
            }
        }
        (best.unwrap_or(v), all)
    }

    /// The length of each line with an end outside the core: the rows left out of the core turn
    /// such a line, and a line turned by a row alone comes out shorter.
    fn free_lengths(&self, sys: &Sys, base: &[f64], in_core: &[bool]) -> Vec<Eq> {
        let mut local = vec![u32::MAX; sys.vals.len()];
        self.vars
            .iter()
            .enumerate()
            .for_each(|(l, &g)| local[g as usize] = l as u32);
        let at = |p: P| {
            (local[p.0 as usize] != u32::MAX && local[p.1 as usize] != u32::MAX)
                .then(|| P(local[p.0 as usize], local[p.1 as usize]))
        };
        let out = |p: P| !in_core[p.0 as usize] || !in_core[p.1 as usize];
        let gap = |a: P, b: P| {
            (base[a.0 as usize] - base[b.0 as usize]).hypot(base[a.1 as usize] - base[b.1 as usize])
        };
        sys.lines
            .iter()
            .filter_map(|l| at(l.0).zip(at(l.1)))
            .filter(|&(a, b)| (out(a) || out(b)) && gap(a, b) > 1e-9)
            .map(|(a, b)| Eq::Dist(a, b, gap(a, b)))
            .collect()
    }

    /// Solved with the `keep` variables where they are: the core of the component first, then the
    /// rows left out of it. Those move points on curves if that does it, and anything outside the
    /// core if not, keeping line lengths if they can. Failing all that, everything at once.
    fn keeping(
        &self,
        sys: &Sys,
        base: &[f64],
        core: &[bool],
        keep: &[(V, f64)],
        iters: &mut usize,
    ) -> Option<Vec<f64>> {
        let every = vec![true; self.eqs.len()];
        if core.contains(&true)
            && core.contains(&false)
            && let Some(a) = self.attempt_rows(core, keep, &[], base, iters)
        {
            let mut in_core = vec![false; a.len()];
            let mut vars = Vec::new();
            for (e, _) in self.eqs.iter().zip(core).filter(|(_, c)| **c) {
                vars.clear();
                e.vars(&mut vars);
                vars.iter().for_each(|&v| in_core[v as usize] = true);
            }
            let stay = |riders_move: bool| -> Vec<(V, f64)> {
                let mut held = keep.to_vec();
                held.extend((0..a.len()).filter_map(|l| {
                    let g = self.vars[l] as usize;
                    let holds = in_core[l] || (riders_move && !sys.rider[g]);
                    (holds && !sys.fixed[g]).then_some((l as V, a[l]))
                }));
                held
            };
            let lengths = self.free_lengths(sys, base, &in_core);
            for rows in [&lengths[..], &[]] {
                for riders_move in [true, false] {
                    let rest = stay(riders_move);
                    if let Some(v) = self.attempt_rows(&every, &rest, rows, &a, iters) {
                        return Some(v);
                    }
                }
            }
        }
        self.attempt_rows(&every, keep, &[], base, iters)
    }

    /// The solve when nothing is being dragged. `None` when it has nothing to add: the geometry
    /// already satisfies everything, or has no freedom to spare, or holding things still can't be
    /// done. A size the constraints won't let stay, such as an arc whose ends went further apart
    /// than its diameter, is given up, and the others still hold.
    fn undisturbed(&self, sys: &Sys, base: &[f64], iters: &mut usize) -> Option<Vec<f64>> {
        if self.unsat_rows(base).is_empty() {
            return None;
        }
        let fixed = self.local_fixed(sys);
        let freedom = analysis::analyze(self.eqs.iter(), base, &fixed);
        if freedom.dof == 0 {
            return None;
        }
        let sizes: Vec<(V, f64)> = (0..base.len())
            .filter(|&l| freedom.free[l] && sys.sizes.contains(&self.vars[l]))
            .map(|l| (l as V, base[l]))
            .collect();
        *self.free_sizes.borrow_mut() = sizes.clone();
        let core = core_rows(&self.eqs, &fixed);
        let mut keep = self.holds.clone();
        keep.extend_from_slice(&sizes);
        let spans = self.free_spans(sys, base, &freedom);
        let every = vec![true; self.eqs.len()];
        // Told otherwise only by a solution that keeps everything.
        self.kept.set(false);
        // Inside a closed profile, staying in place outranks keeping a free length.
        let lengths = if spans.is_empty() { None } else { self.attempt_rows(&every, &keep, &spans, base, iters) };
        let stayed = self.walls_held(sys, &keep, &spans, base, iters);
        let travel = |v: &[f64]| v.iter().zip(base).fold(0.0_f64, |far, (a, b)| far.max((a - b).abs()));
        // What stayed in place has to have stayed: a profile that moves further for it has not.
        let nearer = |v: &Vec<f64>| stayed.as_ref().filter(|w| travel(w) < travel(v)).cloned();
        if let Some(l) = lengths {
            self.kept.set(true);
            return Some(nearer(&l).unwrap_or(l));
        }
        if let Some(v) = self.keeping(sys, base, &core, &keep, iters) {
            let (v, all) = self.spans_held(v, &keep, &spans, base, iters);
            if let Some(w) = nearer(&v) {
                self.kept.set(true);
                return Some(w);
            }
            self.kept.set(all);
            return Some(v);
        }
        if stayed.is_some() {
            self.kept.set(true);
            return stayed;
        }
        keep.truncate(self.holds.len());
        let mut best = self.keeping(sys, base, &core, &keep, iters);
        if sizes.len() <= MAX_SIZE_TRIALS {
            for &size in &sizes {
                keep.push(size);
                match self.keeping(sys, base, &core, &keep, iters) {
                    Some(v) => best = Some(v),
                    None => {
                        keep.pop();
                    }
                }
            }
        }
        best.map(|v| self.spans_held(v, &keep, &spans, base, iters).0)
    }

    /// Rigid translation of the whole component onto the first target.
    fn translated(&self, sys: &Sys, base: &[f64], seeded: &[f64]) -> Vec<f64> {
        let mut shift = [None, None];
        for &(v, x) in &self.targets {
            let axis = sys.kind[self.vars[v as usize] as usize];
            if axis > 0 && shift[axis as usize - 1].is_none() {
                shift[axis as usize - 1] = Some(x - base[v as usize]);
            }
        }
        let mut out = seeded.to_vec();
        for (l, &g) in self.vars.iter().enumerate() {
            let axis = sys.kind[g as usize];
            if axis > 0 && !sys.fixed[g as usize] {
                out[l] = base[l] + shift[axis as usize - 1].unwrap_or(0.0);
            }
        }
        for &(v, x) in &self.targets {
            out[v as usize] = x;
        }
        out
    }

    fn run(&self, sys: &Sys, plain: bool, iters: &mut usize) -> (Option<Vec<f64>>, Vec<usize>) {
        let base = self.values(sys);
        let cfg = config();
        // Well-posed drags converge quadratically; don't spend a frame finding out otherwise.
        let quick = cfg.with_max_iterations(QUICK_ITERATIONS);
        let mut seeded = base.clone();
        for &(v, x) in &self.targets {
            seeded[v as usize] = x;
        }

        if self.targets.is_empty()
            && !plain
            && let Some(v) = self.undisturbed(sys, &base, iters)
        {
            return (Some(v), vec![]);
        }

        if !self.targets.is_empty() || !self.holds.is_empty() {
            let mut all = self.targets.clone();
            all.extend_from_slice(&self.holds);
            if let Some(v) = self.attempt(&all, &seeded, quick, iters) {
                return (Some(v), vec![]);
            }
            if !self.targets.is_empty() && self.targets_can_move(sys, &base) {
                if !self.holds.is_empty()
                    && let Some(v) = self.attempt(&self.targets, &seeded, quick, iters)
                {
                    return (Some(v), vec![]);
                }
                let moved = self.translated(sys, &base, &seeded);
                if let Some(v) = self.attempt(&self.targets, &moved, quick, iters) {
                    return (Some(v), vec![]);
                }
                if let Some(v) = self.follow_tangent(sys, &base, iters) {
                    return (Some(v), vec![]);
                }
            }
        }

        if let Some(v) = self.attempt(&[], &base, cfg, iters) {
            return (Some(v), vec![]);
        }
        // Conflict: the rows left over at the least-squares point are the conflicting set. The
        // geometry stays as it came in.
        let unsat = match self.least_squares(&[], &base, iters) {
            Some(v) => self.unsat_rows(&v),
            None => self.unsat_rows(&base),
        };
        let unsat = if unsat.is_empty() {
            self.rows.clone()
        } else {
            unsat
        };
        (None, unsat)
    }
}

/// A drag that ends further than this from its target has missed.
const DRAG_MISS: f64 = 1e-4;
/// A point this far off the curve it is on is off it.
const ON_SPLINE: f64 = 1e-4;
/// How much further a spline's ends may go than the whole spline would for its interior to stay.
const ENDS_ONLY_TRAVEL: f64 = 3.0;

fn failed(e: String) -> Output {
    Output {
        ok: false,
        error: Some(e),
        ..Default::default()
    }
}

/// How far a solve left its worst drag target.
fn drag_miss(input: &Input, o: &Output) -> f64 {
    let miss = |d: &crate::api::DragIn| {
        o.points
            .get(&d.point)
            .map_or(0.0, |p| (p[0] - d.x).hypot(p[1] - d.y))
    };
    input.drag.iter().map(miss).fold(0.0, f64::max)
}

/// How far a solve moved anything.
fn travel(input: &Input, o: &Output) -> f64 {
    let far = |p: &crate::api::PointIn| {
        o.points
            .get(&p.id)
            .map_or(0.0, |q| (q[0] - p.x).hypot(q[1] - p.y))
    };
    input.points.iter().map(far).fold(0.0, f64::max)
}

/// The degrees of freedom of the sketch as solved, with points counted against the splines they are
/// on: riding is how a solve gets there, not what the sketch is.
fn counted(input: &Input, out: &mut Output) {
    let at = solved_input(input, out);
    let mode = Mode { pull: true, ..Mode::default() };
    if let Ok(mut sys) = sys::build_with(&at, mode) {
        sys.refresh_dyns();
        tally(&sys, out);
    }
}

/// The same request, at the geometry a solve left.
fn solved_input(input: &Input, out: &Output) -> Input {
    let mut at = input.clone();
    for p in &mut at.points {
        if let Some(q) = out.points.get(&p.id) {
            (p.x, p.y) = (q[0], q[1]);
        }
    }
    for c in &mut at.curves {
        if let crate::api::CurveIn::Circle { id, r, .. } = c
            && let Some(v) = out.radii.get(id)
        {
            *r = *v;
        }
    }
    at
}

/// One-way first, so that a sketch that was fine with a point riding on a spline is solved as it
/// always was. Only what that cannot do goes to a build where the point can pull: a drag of the point
/// itself, a drag that stopped short, or a row left unmet.
pub fn solve(input: &Input) -> Output {
    let sys = match sys::build(input) {
        Ok(s) => s,
        Err(e) => return failed(e),
    };
    let pulls = sys.pulls.clone();
    if pulls.is_empty() {
        return solve_built(input, sys, Mode::default());
    }
    let dragged = sys.targets.iter().any(|t| pulls.contains(&t.0));
    let first = (!dragged).then(|| solve_built(input, sys, Mode::default()));
    if let Some(o) = &first
        && o.ok
        && drag_miss(input, o) < DRAG_MISS
    {
        let mut o = o.clone();
        if input.analyze {
            counted(input, &mut o);
        }
        return o;
    }
    if input.drag.is_empty()
        && let Some(mut o) = slide(input)
    {
        if input.analyze {
            counted(input, &mut o);
        }
        return o;
    }
    let pull = Mode { pull: true, ..Mode::default() };
    let free = solve_mode(input, pull);
    // A value keeps a spline's interior, if its ends can do it without going much further.
    let ends_only = input.drag.is_empty().then(|| solve_mode(input, Mode { hold_interior: true, ..pull }));
    let best = match ends_only {
        Some(o) if o.ok && (!free.ok || travel(input, &o) <= ENDS_ONLY_TRAVEL * travel(input, &free)) => o,
        _ => free,
    };
    match first {
        Some(o) if !better(input, &best, &o) => o,
        _ => best,
    }
}

/// A point riding on a spline that its tangent line cannot take to what is asked of it, tried from
/// wherever the curve does meet that. If it can get there by sliding, nothing need pull.
fn slide(input: &Input) -> Option<Output> {
    let sys = sys::build(input).ok()?;
    let slides = sys.slides();
    let seeded = |at: &[(P, (f64, f64))]| {
        let mut moved = input.clone();
        for p in &mut moved.points {
            if let Some(out) = sys.points.iter().find(|o| o.id == p.id)
                && let Some((_, q)) = at.iter().find(|(v, _)| *v == out.var)
            {
                (p.x, p.y) = *q;
            }
        }
        Some(solve_mode(&moved, Mode::default())).filter(|o| o.ok)
    };
    if slides.len() > 1 {
        let first: Vec<(P, (f64, f64))> = slides.iter().map(|(p, s)| (*p, s[0])).collect();
        if let Some(o) = seeded(&first) {
            return Some(o);
        }
    }
    slides.iter().find_map(|(p, seeds)| seeds.iter().find_map(|&q| seeded(&[(*p, q)])))
}

/// Whether a build that could pull did more than one that could not.
fn better(input: &Input, pulled: &Output, one_way: &Output) -> bool {
    if pulled.ok != one_way.ok {
        return pulled.ok;
    }
    if !pulled.ok {
        return pulled.unsatisfied.len() < one_way.unsatisfied.len();
    }
    drag_miss(input, pulled) + DRAG_MISS < drag_miss(input, one_way)
}

fn solve_mode(input: &Input, mode: Mode) -> Output {
    match sys::build_with(input, mode) {
        Ok(s) => solve_built(input, s, mode),
        Err(e) => failed(e),
    }
}

fn solve_built(input: &Input, mut sys: Sys, mode: Mode) -> Output {
    let incoming = sys.vals.clone();
    let mut unsat_rows = BTreeSet::new();
    let mut iters = 0;

    let slack = input.slack.unwrap_or(SATISFIED);
    let mut comps = components(&sys, input.drag.is_empty());
    comps.iter_mut().for_each(|c| c.slack = slack);
    for c in &mut comps {
        c.has_dyn = dyn_touches(&sys, c);
    }
    if !input.analyze && !sys.targets.is_empty() {
        // Only a drag can leave a component out: what it does not touch has nothing to do. A commit
        // has a value somewhere, and a hold says nothing about where.
        // A point on a spline is a separate component (spline drives point), but must still follow.
        comps.retain(|c| !c.targets.is_empty() || !c.holds.is_empty() || c.has_dyn);
    }
    apply_free_targets(&mut sys);

    let any_dyn = !sys.dyns.is_empty();
    if any_dyn {
        sys.refresh_dyns();
    }

    // A row with no free variable can only be checked, and a row whose constant comes from the
    // geometry has that constant only now.
    for (i, r) in sys.rows.iter().enumerate() {
        let mut vars = Vec::new();
        r.eq.vars(&mut vars);
        if vars.iter().all(|&v| sys.fixed[v as usize]) {
            let x = |v: V| sys.vals[v as usize];
            let e = r.eq.eval::<f64>(&x);
            if e[0].abs() > slack || e[1].abs() > slack {
                unsat_rows.insert(i);
            }
        }
    }

    for c in &mut comps {
        if any_dyn {
            c.sync(&sys);
            retarget(&sys, c);
        } else {
            c.lower(&sys);
        }
    }
    let mut failed = vec![false; comps.len()];
    for round in 0..MAX_OUTER {
        for (ci, c) in comps.iter().enumerate() {
            if round > 0 && !c.has_dyn {
                continue;
            }
            let (vals, bad) = c.run(&sys, input.plain, &mut iters);
            failed[ci] = vals.is_none();
            if round == 0 || vals.is_none() {
                unsat_rows.extend(bad);
            }
            if let Some(v) = vals {
                for (l, &g) in c.vars.iter().enumerate() {
                    if !sys.fixed[g as usize] {
                        sys.vals[g as usize] = v[l];
                    }
                }
            }
        }
        if !any_dyn {
            break;
        }
        let change = sys.refresh_dyns();
        if change < OUTER_TOL {
            break;
        }
        for c in comps.iter_mut().filter(|c| c.has_dyn) {
            c.sync(&sys);
            retarget(&sys, c);
        }
    }

    // What failed keeps what it came in with, whatever a round before it, or a row, had moved.
    for (c, _) in comps.iter().zip(&failed).filter(|(_, f)| **f) {
        for &g in &c.vars {
            sys.vals[g as usize] = incoming[g as usize];
        }
    }

    // Both rows here hold by a constant from the last round, so being met says nothing: the real
    // curve is what is asked.
    let (unmet, again) = sys.curvature_unmet();
    let steers = sys.dyns.iter().any(|d| matches!(d, sys::Dyn::FitCurvature { .. } | sys::Dyn::Curvature { real: Some(_), .. }));
    let stuck = !unmet.is_empty() || failed.contains(&true);
    // A long turn of the tangent swings whatever a row ties to the leg, far enough to stop the solve
    // converging. Tangent alone gets there, and the row is at home from there.
    if steers && stuck && !mode.tangent_first && !mode.tangent_only {
        let tangent = solve_mode(input, Mode { tangent_only: true, ..mode });
        if tangent.ok {
            let settled = solve_mode(&solved_input(input, &tangent), Mode { tangent_first: true, by_next: false, ..mode });
            if settled.ok {
                return settled;
            }
        }
    }
    if again && !mode.by_next {
        return solve_mode(input, Mode { by_next: true, ..mode });
    }
    for row in unmet {
        for c in comps.iter().filter(|c| c.rows.contains(&row)) {
            for &g in &c.vars {
                sys.vals[g as usize] = incoming[g as usize];
            }
        }
        unsat_rows.insert(row);
    }
    unsat_rows.extend(sys.off_spline(ON_SPLINE));
    // Asked only what the geometry satisfies, the curve answers for a point on it, not its samples.
    if let Some(tol) = input.slack {
        sys.on_true_curve(tol).iter().for_each(|r| {
            unsat_rows.remove(r);
        });
    }

    let mut out = finish(input, &sys, &unsat_rows, iters);
    out.crossed = match comps.iter().map(|c| c.crossed.get()).max() {
        Some(3) => Some("loop".to_string()),
        Some(2) => Some("flat".to_string()),
        Some(1) => Some("arc".to_string()),
        _ => None,
    };
    out.kept = comps.iter().all(|c| c.kept.get());
    out.resized = resized(&sys, &comps);
    out
}

/// The curves whose free size a solve could not keep.
fn resized(sys: &Sys, comps: &[Comp]) -> Vec<String> {
    let mut out = Vec::new();
    for c in comps {
        for &(l, was) in c.free_sizes.borrow().iter() {
            let v = c.vars[l as usize];
            if (sys.vals[v as usize] - was).abs() > SIZE_TOL * was.abs().max(1.0)
                && let Some(curve) = sys.curves.iter().find(|k| k.radius == Some(v))
            {
                out.push(curve.id.clone());
            }
        }
    }
    out
}

fn dyn_touches(sys: &Sys, c: &Comp) -> bool {
    use crate::sys::Dyn;
    let has = |p: P| c.vars.contains(&p.0);
    sys.dyns.iter().any(|d| match d {
        Dyn::OnSamples { point, .. } => has(*point),
        Dyn::Curvature { end, .. } => has(*end),
        Dyn::OnSpline { point, .. } => has(*point),
        Dyn::FitCurvature { e, .. } => has(*e),
    })
}

/// Point targets can be rewritten by `refresh_dyns` (a dragged point on a spline).
fn retarget(sys: &Sys, c: &mut Comp) {
    if c.targets.is_empty() {
        return;
    }
    c.targets.clear();
    for t in &sys.targets {
        let local = |g: V| c.vars.iter().position(|&v| v == g).map(|l| l as V);
        let (x, y) = (local(t.0.0), local(t.0.1));
        c.targets.extend(x.map(|v| (v, t.1)));
        c.targets.extend(y.map(|v| (v, t.2)));
    }
}

/// A variable in no row at all is in no component and just goes where it is dragged.
fn apply_free_targets(sys: &mut Sys) {
    let mut used = vec![false; sys.vals.len()];
    let mut vars = Vec::new();
    for r in &sys.rows {
        vars.clear();
        r.eq.vars(&mut vars);
        for &v in &vars {
            used[v as usize] = true;
        }
    }
    for (p, x, y) in sys.targets.clone() {
        for (v, t) in [(p.0, x), (p.1, y)] {
            if !used[v as usize] {
                sys.vals[v as usize] = t;
            }
        }
    }
}

fn finish(input: &Input, sys: &Sys, unsat_rows: &BTreeSet<usize>, iterations: usize) -> Output {
    let mut out = Output {
        iterations,
        ..Default::default()
    };
    for p in &sys.points {
        out.points.insert(
            p.id.clone(),
            [sys.vals[p.var.0 as usize], sys.vals[p.var.1 as usize]],
        );
    }
    for c in &sys.curves {
        if let Some(r) = c.radius {
            out.radii.insert(c.id.clone(), sys.vals[r as usize]);
        }
    }
    let mut seen = BTreeSet::new();
    let mut unsatisfied = Vec::new();
    for &i in unsat_rows {
        if let Some(o) = sys.rows[i].owner {
            let id = &sys.owners[o as usize];
            if seen.insert(id.clone()) {
                unsatisfied.push(id.clone());
            }
        }
    }
    for id in &sys.rejected {
        if seen.insert(id.clone()) {
            unsatisfied.push(id.clone());
        }
    }
    out.ok = unsat_rows.is_empty() && sys.rejected.is_empty();
    out.unsatisfied = unsatisfied;
    if input.analyze {
        tally(sys, &mut out);
    }
    out
}

fn tally(sys: &Sys, out: &mut Output) {
    let f = analysis::analyze(sys.rows.iter().map(|r| &r.eq), &sys.vals, &sys.fixed);
    let var_free = |v: V| f.free[v as usize];
    out.free_points = Some(
        sys.points
            .iter()
            .filter(|p| var_free(p.var.0) || var_free(p.var.1))
            .map(|p| p.id.clone())
            .collect(),
    );
    out.free_curves = Some(
        sys.curves
            .iter()
            .filter(|c| c.vars.iter().any(|&v| var_free(v)))
            .map(|c| c.id.clone())
            .collect(),
    );
    out.dof = Some(f.dof);
}
