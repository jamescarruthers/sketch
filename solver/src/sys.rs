//! Lowers the document (points, curves, constraints, dimensions) to a flat equation system.
//!
//! See the crate docs for the modelling decisions. The mapping is rebuilt from scratch on every
//! solve, and every branch choice is made here, once, from `variant` or the incoming geometry.

use crate::api::{ConstraintIn, CurveIn, DimensionIn, Input};
use crate::branch;
use crate::eq::{Eq, L, P, V};
use crate::spline::{Curve, SplineVars, Xy};
use std::collections::HashMap;
use std::f64::consts::PI;

mod ellipse;
mod fit_curvature;
mod pull;
mod rows;
mod tangent;

pub const ORIGIN: &str = "origin";
pub const AXIS_X: &str = "axis-x";
pub const AXIS_Y: &str = "axis-y";
const AXIS_LEN: f64 = 1000.0;

pub struct Row {
    pub eq: Eq,
    /// Index into `Sys::owners`; `None` for structural rows (arc radius, ellipse axes).
    pub owner: Option<u32>,
}

/// Rows whose constants depend on the current geometry, refreshed between solve rounds.
#[derive(Clone, Debug)]
pub enum Dyn {
    /// Point follows the tangent line of a polyline at its nearest foot. `a`, `b` are constant
    /// hidden points. The spline is not a variable of this row: spline drives point.
    OnSamples { point: P, a: P, b: P, curve: usize, row: usize, spline: Option<usize> },
    /// Third control point sits at the signed offset from the end leg that gives the wanted
    /// curvature; `row` is a `PointLine` row whose constant is rewritten.
    Curvature {
        row: usize,
        end: P,
        leg: P,
        sign: f64,
        factor: f64,
        kappa: Kappa,
        prev: Option<(f64, f64)>,
        /// With a `Signed` target, the spline and which end: its real curvature answers for the row.
        real: Option<(usize, bool)>,
    },
    /// A point on a spline that can pull it: on the tangent at the foot, the foot a mix of the
    /// spline's points `idx`. See the crate docs.
    OnSpline {
        point: P,
        spline: usize,
        idx: Vec<usize>,
        mixed: Vec<P>,
        share: Vec<V>,
        tee: P,
        gee: P,
        rows: [usize; 3],
    },
    /// A fit spline's end matched to `target`: `row` holds the handle's length, or the next fit
    /// point's offset from the leg.
    FitCurvature {
        row: usize,
        spline: usize,
        at_start: bool,
        e: P,
        handle: P,
        next: P,
        by_handle: bool,
        target: Target,
        /// The next point's offset and the end's curvature, the round before.
        prev: Option<(f64, f64)>,
    },
}

#[derive(Clone, Copy, Debug)]
pub enum Kappa {
    Radius(V),
    Spline {
        end: P,
        leg: P,
        third: P,
        factor: f64,
    },
    /// Signed already, on the way out along the leg.
    Signed(Target),
}

/// What a spline end's curvature is matched to.
#[derive(Clone, Copy, Debug)]
pub enum Target {
    Straight,
    Round(P, V),
    /// The end of another spline, read at the values of the moment.
    End {
        spline: usize,
        at_start: bool,
    },
    Ellipse(Ell),
    /// A conic's end: the end, its vertex, its far end, and the weight of its vertex.
    Conic {
        end: P,
        leg: P,
        third: P,
        weight: f64,
    },
}

/// What a build leaves out or tries, for the passes described in [`crate::solve`].
#[derive(Clone, Copy, Debug, Default)]
pub struct Mode {
    /// A point on a spline can move the spline.
    pub pull: bool,
    /// The interior points of a spline that is pulled are held, so that its ends go first.
    pub hold_interior: bool,
    /// Fit spline ends take their curvature from the next fit point, not the handle's length.
    pub by_next: bool,
    /// Fit spline ends stop at tangent, to settle that first.
    pub tangent_only: bool,
    /// Tangent has been settled: this build is the last try at the curvature.
    pub tangent_first: bool,
}

pub struct PointOut {
    pub id: String,
    pub root: usize,
    pub var: P,
}

pub struct CurveOut {
    pub id: String,
    pub vars: Vec<V>,
    pub radius: Option<V>,
}

/// A loop's corners, its arc edges, and the side it began on.
pub type LoopRow = (Vec<P>, Vec<(usize, P, bool)>, f64);

/// The lowered form of `api::Branches`, with where each stood when the solve began.
#[derive(Clone, Debug, Default)]
pub struct Branches {
    /// Centre and ends, and the sweep.
    pub arcs: Vec<([P; 3], f64)>,
    /// Corners, and the side the loop is on.
    pub loops: Vec<LoopRow>,
}

pub struct Sys {
    pub vals: Vec<f64>,
    pub fixed: Vec<bool>,
    /// 0 scalar, 1 an X coordinate, 2 a Y coordinate.
    pub kind: Vec<u8>,
    /// A point on a curve or a hidden helper: it follows curves and nothing is meant to follow it.
    pub rider: Vec<bool>,
    /// Radii and semi-axes: the values a user reads off a curve.
    pub sizes: Vec<V>,
    pub lines: Vec<L>,
    /// Each arc as centre and ends: with its radius, its sweep is its shape.
    pub arcs: Vec<[P; 3]>,
    pub branches: Branches,
    /// Each wall of a closed profile: its ends, and two constant points on the line it is on.
    pub walls: Vec<[P; 4]>,
    pub rows: Vec<Row>,
    pub owners: Vec<String>,
    pub dyns: Vec<Dyn>,
    pub targets: Vec<(P, f64, f64)>,
    pub holds: Vec<P>,
    pub nonneg: Vec<V>,
    pub points: Vec<PointOut>,
    pub curves: Vec<CurveOut>,
    pub samples: Vec<Vec<[f64; 2]>>,
    pub splines: Vec<SplineVars>,
    /// Points riding on a spline they could move, in a build that has them only riding.
    pub pulls: Vec<P>,
    /// Constraints that could not be mapped (bad refs, unsupported pairing).
    pub rejected: Vec<String>,
}

#[derive(Clone, Debug)]
enum Cv {
    Line {
        a: usize,
        b: usize,
    },
    Circle {
        c: usize,
        r: V,
    },
    Arc {
        c: usize,
        a: usize,
        b: usize,
        r: V,
    },
    Ellipse {
        c: usize,
        major: usize,
        minor: usize,
        ra: V,
        rb: V,
        ends: Vec<usize>,
    },
    Spline(SplineCv),
    Frame,
}

#[derive(Clone, Debug)]
struct SplineCv {
    pts: Vec<usize>,
    degree: u32,
    fit: bool,
    rational: bool,
    closed: bool,
    rho: Option<f64>,
    handles: Vec<Option<usize>>,
    samples: Option<usize>,
    /// Index in `Sys::splines`.
    vars: usize,
}

#[derive(Clone, Copy, Debug)]
pub struct Ell {
    c: P,
    major: P,
    minor: P,
    ra: V,
    rb: V,
}

type Frame = (Xy, Xy, Xy, f64, f64);
/// Point pairs and scalar pairs that a symmetric constraint ties together.
type Pairs = (Vec<(usize, usize)>, Vec<(V, V)>);

#[derive(Clone, Copy)]
enum Shape {
    Line(L),
    Circ(P, V),
    Ell(Ell),
    Spl,
}

enum Ref {
    Point(usize),
    Curve(usize),
}

struct B<'a> {
    input: &'a Input,
    ids: HashMap<&'a str, Ref>,
    parent: Vec<usize>,
    px: Vec<(f64, f64)>,
    pfixed: Vec<bool>,
    pvar: Vec<P>,
    curves: Vec<Cv>,
    /// Extra points known to lie on each curve (root ids), from point-on-curve constraints.
    on: Vec<Vec<usize>>,
    ell_pts: HashMap<(P, usize), (P, P)>,
    mode: Mode,
    s: Sys,
}

fn dot(a: (f64, f64), b: (f64, f64)) -> f64 {
    a.0 * b.0 + a.1 * b.1
}
fn cross(a: (f64, f64), b: (f64, f64)) -> f64 {
    a.0 * b.1 - a.1 * b.0
}
fn sub(a: (f64, f64), b: (f64, f64)) -> (f64, f64) {
    (a.0 - b.0, a.1 - b.1)
}
fn norm(a: (f64, f64)) -> f64 {
    a.0.hypot(a.1)
}

pub fn build(input: &Input) -> Result<Sys, String> {
    build_with(input, Mode::default())
}

pub fn build_with(input: &Input, mode: Mode) -> Result<Sys, String> {
    let mut b = B {
        input,
        ids: HashMap::new(),
        parent: Vec::new(),
        px: Vec::new(),
        pfixed: Vec::new(),
        pvar: Vec::new(),
        curves: Vec::new(),
        on: Vec::new(),
        ell_pts: HashMap::new(),
        mode,
        s: Sys {
            vals: Vec::new(),
            fixed: Vec::new(),
            kind: Vec::new(),
            rider: Vec::new(),
            sizes: Vec::new(),
            lines: Vec::new(),
            arcs: Vec::new(),
            branches: Branches::default(),
            walls: Vec::new(),
            rows: Vec::new(),
            owners: Vec::new(),
            dyns: Vec::new(),
            targets: Vec::new(),
            holds: Vec::new(),
            nonneg: Vec::new(),
            points: Vec::new(),
            curves: Vec::new(),
            samples: Vec::new(),
            splines: Vec::new(),
            pulls: Vec::new(),
            rejected: Vec::new(),
        },
    };
    b.load_points()?;
    b.mark_fixed_curves();
    let conflicts = b.merge_points();
    b.alloc_points();
    b.seed_merged_drag();
    b.alloc_curves()?;
    b.collect_on_points();
    for (i, k) in input.constraints.iter().enumerate() {
        let owner = b.owner(&k.id);
        if b.constraint(k, owner, conflicts.get(&i)).is_none() {
            b.s.rejected.push(k.id.clone());
        }
    }
    for d in &input.dimensions {
        let owner = b.owner(&d.id);
        if b.dimension(d, owner).is_none() {
            b.s.rejected.push(d.id.clone());
        }
    }
    b.lower_branches();
    b.lower_walls();
    Ok(b.s)
}

impl<'a> B<'a> {
    fn lower_walls(&mut self) {
        let input = self.input;
        for [a, b] in &input.walls {
            if let Some((i, j)) = self.pidx(a).zip(self.pidx(b)) {
                let (pa, pb) = (self.px[i], self.px[j]);
                if (pa.0 - pb.0).hypot(pa.1 - pb.1) > 1e-9 {
                    let (u, v) = (self.constant(pa), self.constant(pb));
                    self.s.walls.push([self.pvar[i], self.pvar[j], u, v]);
                }
            }
        }
    }

    fn lower_branches(&mut self) {
        let input = self.input;
        // Each point's own place, not that of what it merged with: a new coincident has not met yet.
        let list = |b: &Self, ids: &[String]| -> Option<(Vec<P>, Vec<Xy>)> {
            let at: Vec<usize> = ids.iter().map(|id| b.pidx(id)).collect::<Option<_>>()?;
            Some((at.iter().map(|&i| b.pvar[i]).collect(), at.iter().map(|&i| b.px[i]).collect()))
        };
        let b_point = |b: &Self, id: &str| b.pidx(id).map(|i| (b.pvar[i], b.px[i]));
        for ids in &input.branches.arcs {
            if let Some((v, w)) = list(self, ids) {
                self.s.branches.arcs.push(([v[0], v[1], v[2]], branch::sweep(w[0], w[1], w[2])));
            }
        }
        for (i, ids) in input.branches.loops.iter().enumerate() {
            if let Some((v, w)) = list(self, ids) {
                let mut vars = Vec::new();
                let mut places = Vec::new();
                for b in input.branches.bulges.get(i).into_iter().flatten() {
                    if let Some(c) = b_point(self, &b.c) {
                        vars.push((b.at, c.0, b.ccw));
                        places.push((b.at, c.1, b.ccw));
                    }
                }
                let on = branch::side_of(&w, &places);
                if on != 0.0 {
                    self.s.branches.loops.push((v, vars, on));
                }
            }
        }
    }

    fn owner(&mut self, id: &str) -> u32 {
        self.s.owners.push(id.to_string());
        (self.s.owners.len() - 1) as u32
    }

    fn add_reserved_point(&mut self, id: &'a str, x: f64, y: f64) -> usize {
        let i = self.px.len();
        self.px.push((x, y));
        self.pfixed.push(true);
        self.parent.push(i);
        self.ids.insert(id, Ref::Point(i));
        i
    }

    fn load_points(&mut self) -> Result<(), String> {
        self.add_reserved_point(ORIGIN, 0.0, 0.0);
        self.add_reserved_point("axis-x-end", AXIS_LEN, 0.0);
        self.add_reserved_point("axis-y-end", 0.0, AXIS_LEN);
        for p in &self.input.points {
            if !p.x.is_finite() || !p.y.is_finite() {
                return Err(format!("point {} is not finite", p.id));
            }
            if self.ids.contains_key(p.id.as_str()) {
                if p.id == ORIGIN {
                    continue;
                }
                return Err(format!("duplicate id {}", p.id));
            }
            let i = self.px.len();
            self.px.push((p.x, p.y));
            self.pfixed.push(p.fixed);
            self.parent.push(i);
            self.ids.insert(&p.id, Ref::Point(i));
        }
        Ok(())
    }

    fn pidx(&self, id: &str) -> Option<usize> {
        match self.ids.get(id) {
            Some(Ref::Point(i)) => Some(*i),
            _ => None,
        }
    }

    fn cidx(&self, id: &str) -> Option<usize> {
        match self.ids.get(id) {
            Some(Ref::Curve(i)) => Some(*i),
            _ => None,
        }
    }

    fn mark_fixed_curves(&mut self) {
        for c in &self.input.curves {
            let (pts, fixed): (Vec<&String>, bool) = match c {
                CurveIn::Line { a, b, fixed, .. } => (vec![a, b], *fixed),
                CurveIn::Circle { c, fixed, .. } => (vec![c], *fixed),
                CurveIn::Arc { c, a, b, fixed, .. } => (vec![c, a, b], *fixed),
                CurveIn::Ellipse {
                    c,
                    major,
                    minor,
                    fixed,
                    ..
                } => (vec![c, major, minor], *fixed),
                CurveIn::EllipticalArc {
                    c,
                    major,
                    minor,
                    a,
                    b,
                    fixed,
                    ..
                } => (vec![c, major, minor, a, b], *fixed),
                CurveIn::Spline {
                    pts,
                    handles,
                    fixed,
                    ..
                } => {
                    let mut v: Vec<&String> = pts.iter().collect();
                    v.extend(handles.iter().flatten());
                    (v, *fixed)
                }
                CurveIn::Frame { pts, fixed, .. } => (pts.iter().collect(), *fixed),
            };
            if fixed {
                for p in pts {
                    if let Some(i) = self.pidx(p) {
                        self.pfixed[i] = true;
                    }
                }
            }
        }
    }

    fn find(&mut self, mut i: usize) -> usize {
        while self.parent[i] != i {
            self.parent[i] = self.parent[self.parent[i]];
            i = self.parent[i];
        }
        i
    }

    fn root_of(&self, mut i: usize) -> usize {
        while self.parent[i] != i {
            i = self.parent[i];
        }
        i
    }

    /// Coincident point pairs and concentric centres share variables. Two immovable points at
    /// different places can't share one, so those stay explicit rows and surface as conflicts.
    /// The first-listed point's position wins ("the first selection is the reference").
    fn merge_points(&mut self) -> HashMap<usize, (usize, usize)> {
        let mut conflicts = HashMap::new();
        let input = self.input;
        for (i, k) in input.constraints.iter().enumerate() {
            let pair = match k.kind.as_str() {
                "coincident" if k.refs.len() == 2 => {
                    self.pidx(&k.refs[0]).zip(self.pidx(&k.refs[1]))
                }
                "concentric" if k.refs.len() == 2 => {
                    self.center_of(&k.refs[0]).zip(self.center_of(&k.refs[1]))
                }
                _ => None,
            };
            let Some((a, b)) = pair else { continue };
            let (ra, rb) = (self.find(a), self.find(b));
            if ra == rb {
                continue;
            }
            let (fa, fb) = (self.pfixed[ra], self.pfixed[rb]);
            if fa && fb && norm(sub(self.px[ra], self.px[rb])) > 1e-9 {
                conflicts.insert(i, (ra, rb));
                continue;
            }
            if fb && !fa {
                self.parent[ra] = rb;
            } else {
                self.parent[rb] = ra;
                self.pfixed[ra] |= fb;
            }
        }
        conflicts
    }

    fn center_of(&self, curve: &str) -> Option<usize> {
        if curve == ORIGIN {
            return self.pidx(ORIGIN);
        }
        for c in &self.input.curves {
            if c.id() == curve {
                return match c {
                    CurveIn::Circle { c, .. }
                    | CurveIn::Arc { c, .. }
                    | CurveIn::Ellipse { c, .. }
                    | CurveIn::EllipticalArc { c, .. } => self.pidx(c),
                    _ => None,
                };
            }
        }
        None
    }

    fn new_var(&mut self, v: f64, fixed: bool) -> V {
        self.s.vals.push(v);
        self.s.fixed.push(fixed);
        self.s.kind.push(0);
        self.s.rider.push(false);
        (self.s.vals.len() - 1) as V
    }

    fn new_size(&mut self, v: f64, fixed: bool) -> V {
        let size = self.new_var(v, fixed);
        self.s.sizes.push(size);
        size
    }

    fn new_point(&mut self, at: (f64, f64), fixed: bool) -> P {
        let p = P(self.new_var(at.0, fixed), self.new_var(at.1, fixed));
        self.s.kind[p.0 as usize] = 1;
        self.s.kind[p.1 as usize] = 2;
        p
    }

    fn hidden(&mut self, at: (f64, f64)) -> P {
        let p = self.new_point(at, false);
        self.ride(p);
        p
    }

    fn ride(&mut self, p: P) {
        self.s.rider[p.0 as usize] = true;
        self.s.rider[p.1 as usize] = true;
    }

    fn constant(&mut self, at: (f64, f64)) -> P {
        self.new_point(at, true)
    }

    fn alloc_points(&mut self) {
        let n = self.px.len();
        self.pvar = vec![P(0, 0); n];
        let mut done = vec![false; n];
        for i in 0..n {
            let r = self.find(i);
            if !done[r] {
                done[r] = true;
                self.pvar[r] = self.new_point(self.px[r], self.pfixed[r]);
            }
            self.pvar[i] = self.pvar[r];
        }
        for p in &self.input.points {
            if let Some(i) = self.pidx(&p.id) {
                let root = self.root_of(i);
                self.s.points.push(PointOut {
                    id: p.id.clone(),
                    root,
                    var: self.pvar[i],
                });
            }
        }
    }

    /// Targets and holds are resolved after merging; a merged group takes the drag position so
    /// that the group, not the arbitrary first member, follows the cursor.
    fn seed_merged_drag(&mut self) {
        for d in &self.input.drag {
            let Some(i) = self.pidx(&d.point) else {
                continue;
            };
            if !d.x.is_finite() || !d.y.is_finite() {
                continue;
            }
            let v = self.pvar[i];
            if !self.s.fixed[v.0 as usize] {
                self.s.targets.push((v, d.x, d.y));
            }
        }
        for h in &self.input.hold {
            let Some(i) = self.pidx(h) else { continue };
            let v = self.pvar[i];
            if !self.s.fixed[v.0 as usize]
                && !self.s.targets.iter().any(|t| t.0 == v)
                && !self.s.holds.contains(&v)
            {
                self.s.holds.push(v);
            }
        }
    }

    fn pos(&self, p: P) -> (f64, f64) {
        (self.s.vals[p.0 as usize], self.s.vals[p.1 as usize])
    }

    fn rows(&mut self, eq: Eq) {
        self.s.rows.push(Row { eq, owner: None });
    }

    fn row(&mut self, owner: u32, eq: Eq) {
        self.s.rows.push(Row {
            eq,
            owner: Some(owner),
        });
    }

    fn need(&self, id: &str) -> Result<usize, String> {
        self.pidx(id).ok_or_else(|| format!("unknown point {id}"))
    }

    fn alloc_curves(&mut self) -> Result<(), String> {
        let (o, xe, ye) = (0usize, 1usize, 2usize);
        self.ids.insert(AXIS_X, Ref::Curve(0));
        self.curves.push(Cv::Line { a: o, b: xe });
        self.ids.insert(AXIS_Y, Ref::Curve(1));
        self.curves.push(Cv::Line { a: o, b: ye });
        let input = self.input;
        for c in &input.curves {
            if self.ids.contains_key(c.id()) {
                return Err(format!("duplicate id {}", c.id()));
            }
            let i = self.curves.len();
            let (cv, out) = self.alloc_curve(c)?;
            self.curves.push(cv);
            self.s.curves.push(out);
            self.ids.insert(c.id(), Ref::Curve(i));
        }
        self.on = vec![Vec::new(); self.curves.len()];
        Ok(())
    }

    fn alloc_curve(&mut self, c: &CurveIn) -> Result<(Cv, CurveOut), String> {
        let pv = |b: &Self, i: usize| b.pvar[i];
        let vars = |ps: &[P]| ps.iter().flat_map(|p| [p.0, p.1]).collect::<Vec<V>>();
        Ok(match c {
            CurveIn::Line { id, a, b, .. } => {
                let (a, b) = (self.need(a)?, self.need(b)?);
                let v = vars(&[pv(self, a), pv(self, b)]);
                self.s.lines.push(L(pv(self, a), pv(self, b)));
                (
                    Cv::Line { a, b },
                    CurveOut {
                        id: id.clone(),
                        vars: v,
                        radius: None,
                    },
                )
            }
            CurveIn::Circle { id, c, r, fixed } => {
                let c = self.need(c)?;
                if !r.is_finite() {
                    return Err(format!("circle {id} has no finite radius"));
                }
                let rv = self.new_size(*r, *fixed);
                self.s.nonneg.push(rv);
                let mut v = vars(&[pv(self, c)]);
                v.push(rv);
                (
                    Cv::Circle { c, r: rv },
                    CurveOut {
                        id: id.clone(),
                        vars: v,
                        radius: Some(rv),
                    },
                )
            }
            CurveIn::Arc { id, c, a, b, fixed } => {
                let (ci, ai, bi) = (self.need(c)?, self.need(a)?, self.need(b)?);
                let (cp, ap, bp) = (pv(self, ci), pv(self, ai), pv(self, bi));
                let r0 = norm(sub(self.pos(ap), self.pos(cp)));
                let rv = self.new_size(r0, *fixed);
                self.s.arcs.push([cp, ap, bp]);
                self.rows(Eq::DistVar(cp, ap, rv));
                self.rows(Eq::DistVar(cp, bp, rv));
                let mut v = vars(&[cp, ap, bp]);
                v.push(rv);
                (
                    Cv::Arc {
                        c: ci,
                        a: ai,
                        b: bi,
                        r: rv,
                    },
                    CurveOut {
                        id: id.clone(),
                        vars: v,
                        radius: Some(rv),
                    },
                )
            }
            CurveIn::Ellipse {
                id,
                c,
                major,
                minor,
                fixed,
            } => {
                let (ci, mi, ni) = (self.need(c)?, self.need(major)?, self.need(minor)?);
                let cv = self.alloc_ellipse(ci, mi, ni, vec![], *fixed);
                let v = vars(&[pv(self, ci), pv(self, mi), pv(self, ni)]);
                (
                    cv,
                    CurveOut {
                        id: id.clone(),
                        vars: v,
                        radius: None,
                    },
                )
            }
            CurveIn::EllipticalArc {
                id,
                c,
                major,
                minor,
                a,
                b,
                fixed,
            } => {
                let (ci, mi, ni) = (self.need(c)?, self.need(major)?, self.need(minor)?);
                let (ai, bi) = (self.need(a)?, self.need(b)?);
                let cv = self.alloc_ellipse(ci, mi, ni, vec![ai, bi], *fixed);
                let Cv::Ellipse { ra, rb, .. } = cv else {
                    unreachable!()
                };
                let e = Ell {
                    c: pv(self, ci),
                    major: pv(self, mi),
                    minor: pv(self, ni),
                    ra,
                    rb,
                };
                let idx = self.curves.len();
                let (pa, pb) = (pv(self, ai), pv(self, bi));
                self.ell_point_rows(e, pa, idx, None);
                self.ell_point_rows(e, pb, idx, None);
                let v = vars(&[pv(self, ci), pv(self, mi), pv(self, ni), pa, pb]);
                (
                    cv,
                    CurveOut {
                        id: id.clone(),
                        vars: v,
                        radius: None,
                    },
                )
            }
            CurveIn::Spline {
                id,
                pts,
                degree,
                fit,
                handles,
                samples,
                rational,
                closed,
                rho,
                ..
            } => {
                if pts.is_empty() {
                    return Err(format!("spline {id} has no points"));
                }
                let idx: Vec<usize> = pts.iter().map(|p| self.need(p)).collect::<Result<_, _>>()?;
                let mut hs = Vec::with_capacity(idx.len());
                for h in handles {
                    hs.push(match h {
                        Some(h) => Some(self.need(h)?),
                        None => None,
                    });
                }
                let mut ps: Vec<P> = idx.iter().map(|&i| pv(self, i)).collect();
                ps.extend(hs.iter().flatten().map(|&i| pv(self, i)));
                self.s.splines.push(SplineVars {
                    pts: idx.iter().map(|&i| pv(self, i)).collect(),
                    handles: hs.iter().map(|h| h.map(|i| pv(self, i))).collect(),
                    fit: *fit,
                    closed: *closed,
                    degree: *degree,
                });
                let spline_vars = self.s.splines.len() - 1;
                let sample = if samples.len() >= 2 {
                    self.s.samples.push(samples.clone());
                    Some(self.s.samples.len() - 1)
                } else {
                    None
                };
                (
                    Cv::Spline(SplineCv {
                        pts: idx,
                        degree: *degree,
                        fit: *fit,
                        rational: *rational,
                        closed: *closed,
                        rho: *rho,
                        handles: hs,
                        samples: sample,
                        vars: spline_vars,
                    }),
                    CurveOut {
                        id: id.clone(),
                        vars: vars(&ps),
                        radius: None,
                    },
                )
            }
            CurveIn::Frame { id, pts, .. } => {
                if pts.len() != 4 {
                    return Err(format!("frame {id} needs 4 points"));
                }
                let mut ps = Vec::new();
                for p in pts {
                    let i = self.need(p)?;
                    ps.push(pv(self, i));
                }
                let (bl, br, tr, tl) = (ps[0], ps[1], ps[2], ps[3]);
                self.rows(Eq::Parallel(L(bl, br), L(tl, tr)));
                self.rows(Eq::Parallel(L(bl, tl), L(br, tr)));
                self.rows(Eq::Perp(L(bl, br), L(bl, tl)));
                (
                    Cv::Frame,
                    CurveOut {
                        id: id.clone(),
                        vars: vars(&ps),
                        radius: None,
                    },
                )
            }
        })
    }

    fn alloc_ellipse(
        &mut self,
        c: usize,
        major: usize,
        minor: usize,
        ends: Vec<usize>,
        fixed: bool,
    ) -> Cv {
        let (cp, mp, np) = (self.pvar[c], self.pvar[major], self.pvar[minor]);
        let ra = self.new_size(norm(sub(self.pos(mp), self.pos(cp))), fixed);
        let rb = self.new_size(norm(sub(self.pos(np), self.pos(cp))), fixed);
        self.rows(Eq::DistVar(cp, mp, ra));
        self.rows(Eq::DistVar(cp, np, rb));
        self.rows(Eq::Perp(L(cp, mp), L(cp, np)));
        Cv::Ellipse {
            c,
            major,
            minor,
            ra,
            rb,
            ends,
        }
    }

    fn collect_on_points(&mut self) {
        let input = self.input;
        for k in &input.constraints {
            if k.kind == "coincident" && k.refs.len() == 2 {
                let (p, c) = (&k.refs[0], &k.refs[1]);
                let pair = self
                    .pidx(p)
                    .zip(self.cidx(c))
                    .or_else(|| self.pidx(c).zip(self.cidx(p)));
                if let Some((p, c)) = pair {
                    let r = self.root_of(p);
                    self.on[c].push(r);
                }
            }
        }
    }

    fn line(&self, c: usize) -> Option<L> {
        match self.curves[c] {
            Cv::Line { a, b } => Some(L(self.pvar[a], self.pvar[b])),
            _ => None,
        }
    }

    fn circ(&self, c: usize) -> Option<(P, V)> {
        match self.curves[c] {
            Cv::Circle { c, r } | Cv::Arc { c, r, .. } => Some((self.pvar[c], r)),
            _ => None,
        }
    }

    fn ell(&self, c: usize) -> Option<Ell> {
        match &self.curves[c] {
            Cv::Ellipse {
                c,
                major,
                minor,
                ra,
                rb,
                ..
            } => Some(Ell {
                c: self.pvar[*c],
                major: self.pvar[*major],
                minor: self.pvar[*minor],
                ra: *ra,
                rb: *rb,
            }),
            _ => None,
        }
    }

    fn shape(&self, c: usize) -> Option<Shape> {
        Some(match &self.curves[c] {
            Cv::Line { .. } => Shape::Line(self.line(c)?),
            Cv::Circle { .. } | Cv::Arc { .. } => {
                let (p, r) = self.circ(c)?;
                Shape::Circ(p, r)
            }
            Cv::Ellipse { .. } => Shape::Ell(self.ell(c)?),
            Cv::Spline(_) => Shape::Spl,
            Cv::Frame => return None,
        })
    }

    /// Every point this curve passes through by construction or constraint.
    fn points_on(&self, c: usize) -> Vec<usize> {
        let mut v: Vec<usize> = match &self.curves[c] {
            Cv::Line { a, b } => vec![*a, *b],
            Cv::Arc { a, b, .. } => vec![*a, *b],
            Cv::Ellipse { ends, .. } => ends.clone(),
            Cv::Spline(s) if s.fit => s.pts.clone(),
            Cv::Spline(s) if !s.pts.is_empty() => vec![s.pts[0], *s.pts.last().unwrap()],
            _ => vec![],
        };
        for i in &mut v {
            *i = self.root_of(*i);
        }
        v.extend_from_slice(&self.on[c]);
        v
    }

    fn contact(&self, a: usize, b: usize) -> Option<usize> {
        let (pa, pb) = (self.points_on(a), self.points_on(b));
        pa.into_iter().find(|p| pb.contains(p))
    }

    /// Point-on-curve. Lines and circles behave as their infinite carriers: a point is not clamped
    /// to the segment or the arc's sweep, matching how a coincident can sit on an extension.
    fn on_curve(&mut self, p: usize, c: usize, owner: u32) -> Option<()> {
        let root = self.root_of(p);
        let pp = self.pvar[p];
        self.ride(pp);
        match self.curves[c].clone() {
            Cv::Line { a, b } => {
                if self.root_of(a) != root && self.root_of(b) != root {
                    let l = L(self.pvar[a], self.pvar[b]);
                    self.row(owner, Eq::PointLine(pp, l, 0.0));
                }
            }
            Cv::Circle { c, r } => self.row(owner, Eq::DistVar(self.pvar[c], pp, r)),
            Cv::Arc { c, a, b, r } => {
                if self.root_of(a) != root && self.root_of(b) != root {
                    self.row(owner, Eq::DistVar(self.pvar[c], pp, r));
                }
            }
            Cv::Ellipse { .. } => {
                let e = self.ell(c)?;
                self.ell_point_rows(e, pp, c, Some(owner));
            }
            Cv::Spline(s) => {
                if !self.points_on_spline_by_definition(&s, root) {
                    let pulls = self.can_pull(&s);
                    if !(pulls && self.mode.pull && self.on_spline(pp, &s, owner).is_some()) {
                        if pulls {
                            self.s.pulls.push(pp);
                        }
                        self.on_samples(pp, &s, owner)?;
                    }
                }
            }
            Cv::Frame => return None,
        }
        Some(())
    }

    fn points_on_spline_by_definition(&self, s: &SplineCv, root: usize) -> bool {
        if s.fit {
            s.pts.iter().any(|&q| self.root_of(q) == root)
        } else {
            [s.pts.first(), s.pts.last()]
                .iter()
                .flatten()
                .any(|&&q| self.root_of(q) == root)
        }
    }

    fn on_samples(&mut self, point: P, s: &SplineCv, owner: u32) -> Option<()> {
        let curve = s.samples?;
        let at = self.pos(point);
        let a = self.constant(at);
        let b = self.constant((at.0 + 1.0, at.1));
        let row = self.s.rows.len();
        let spline = (!s.rational).then_some(s.vars);
        self.s.dyns.push(Dyn::OnSamples { point, a, b, curve, row, spline });
        self.row(owner, Eq::PointLine(point, L(a, b), 0.0));
        Some(())
    }
}

/// Curvature of a clamped uniform B-spline at its end is `factor * h / a^2`, where a is the first
/// leg's length and h the offset of the third control point from it.
fn curvature_factor(degree: u32, n: usize) -> f64 {
    // Knots as in geom/spline.ts: the degree drops to n - 1 when there are too few points.
    let p = (degree as usize).min(n - 1).max(1) as f64;
    if n as f64 == p + 1.0 {
        (p - 1.0) / p
    } else {
        (p - 1.0) / (2.0 * p)
    }
}

impl Sys {
    pub fn pos(&self, p: P) -> (f64, f64) {
        (self.vals[p.0 as usize], self.vals[p.1 as usize])
    }

    /// Recompute dynamic rows from current values. Returns the largest change in the geometry they
    /// describe, so the outer loop can stop.
    pub fn refresh_dyns(&mut self) -> f64 {
        let mut change: f64 = 0.0;
        for i in 0..self.dyns.len() {
            match self.dyns[i].clone() {
                Dyn::OnSamples { point, a, b, curve, .. } => {
                    let tgt = self
                        .targets
                        .iter()
                        .find(|t| t.0 == point)
                        .map(|t| (t.1, t.2));
                    let at = tgt.unwrap_or(self.pos(point));
                    let (foot, dir) = nearest_on_polyline(&self.samples[curve], at);
                    change = change.max(norm(sub(self.pos(point), foot)));
                    self.vals[a.0 as usize] = foot.0;
                    self.vals[a.1 as usize] = foot.1;
                    self.vals[b.0 as usize] = foot.0 + dir.0 * 100.0;
                    self.vals[b.1 as usize] = foot.1 + dir.1 * 100.0;
                    if let Some(t) = self.targets.iter_mut().find(|t| t.0 == point) {
                        t.1 = foot.0;
                        t.2 = foot.1;
                    }
                }
                Dyn::Curvature {
                    row,
                    end,
                    leg,
                    sign,
                    factor,
                    kappa,
                    prev,
                    ..
                } => {
                    let a = norm(sub(self.pos(leg), self.pos(end)));
                    let k = match kappa {
                        Kappa::Radius(r) => 1.0 / self.vals[r as usize].max(1e-9),
                        Kappa::Spline {
                            end,
                            leg,
                            third,
                            factor,
                        } => {
                            let (e, l, t) = (self.pos(end), self.pos(leg), self.pos(third));
                            let u = sub(l, e);
                            let n = norm(u).max(1e-9);
                            factor * (cross(u, sub(t, e)) / n).abs() / (n * n)
                        }
                        Kappa::Signed(t) => {
                            let e = self.pos(end);
                            let u = sub(self.pos(leg), e);
                            let u = (u.0 / a.max(1e-9), u.1 / a.max(1e-9));
                            self.target_kappa(t, u, e).unwrap_or(0.0)
                        }
                    };
                    let wanted = sign * k * a * a / factor;
                    let Eq::PointLine(_, _, d) = &mut self.rows[row].eq else {
                        continue;
                    };
                    let now = *d;
                    change = change.max((wanted - now).abs());
                    // The leg shortens as the offset grows, so plain substitution contracts at
                    // only about 0.6 per round. A secant step on offset - wanted(offset) settles
                    // in a few.
                    *d = match prev {
                        Some((h0, g0)) if ((wanted - now) - (g0 - h0)).abs() > 1e-12 => {
                            let r1 = wanted - now;
                            now - r1 * (now - h0) / (r1 - (g0 - h0))
                        }
                        _ => wanted,
                    };
                    if let Dyn::Curvature { prev, .. } = &mut self.dyns[i] {
                        *prev = Some((now, wanted));
                    }
                }
                d @ Dyn::OnSpline { .. } => change = change.max(self.refresh_on_spline(&d)),
                Dyn::FitCurvature { .. } => change = change.max(self.refresh_fit_curvature(i)),
            }
        }
        change
    }
}

fn nearest_on_polyline(pts: &[[f64; 2]], p: (f64, f64)) -> ((f64, f64), (f64, f64)) {
    let mut best = (f64::INFINITY, (pts[0][0], pts[0][1]), (1.0, 0.0));
    for w in pts.windows(2) {
        let a = (w[0][0], w[0][1]);
        let d = (w[1][0] - a.0, w[1][1] - a.1);
        let l2 = dot(d, d);
        if l2 < 1e-24 {
            continue;
        }
        let t = (dot(sub(p, a), d) / l2).clamp(0.0, 1.0);
        let f = (a.0 + d.0 * t, a.1 + d.1 * t);
        let s = norm(sub(p, f));
        if s < best.0 {
            let n = l2.sqrt();
            best = (s, f, (d.0 / n, d.1 / n));
        }
    }
    (best.1, best.2)
}
