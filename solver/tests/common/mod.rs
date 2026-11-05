#![allow(dead_code)]
use sketch_solver::api::*;
use sketch_solver::solve::solve;

/// Small document builder; a test reads as the sequence of things a user does.
#[derive(Clone, Default)]
pub struct Doc {
    pub input: Input,
    n: usize,
}

impl Doc {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn pt(&mut self, id: &str, x: f64, y: f64) -> &mut Self {
        self.input.points.push(PointIn {
            id: id.into(),
            x,
            y,
            fixed: false,
        });
        self
    }
    pub fn fix(&mut self, id: &str) -> &mut Self {
        self.input
            .points
            .iter_mut()
            .find(|p| p.id == id)
            .unwrap()
            .fixed = true;
        self
    }
    pub fn line(&mut self, id: &str, a: &str, b: &str) -> &mut Self {
        self.input.curves.push(CurveIn::Line {
            id: id.into(),
            a: a.into(),
            b: b.into(),
            fixed: false,
        });
        self
    }
    /// Line with its own two new points, `<id>a` and `<id>b`.
    pub fn seg(&mut self, id: &str, a: (f64, f64), b: (f64, f64)) -> &mut Self {
        let (pa, pb) = (format!("{id}a"), format!("{id}b"));
        self.pt(&pa, a.0, a.1).pt(&pb, b.0, b.1).line(id, &pa, &pb)
    }
    pub fn circle(&mut self, id: &str, c: &str, r: f64) -> &mut Self {
        self.input.curves.push(CurveIn::Circle {
            id: id.into(),
            c: c.into(),
            r,
            fixed: false,
        });
        self
    }
    pub fn arc(&mut self, id: &str, c: &str, a: &str, b: &str) -> &mut Self {
        self.input.curves.push(CurveIn::Arc {
            id: id.into(),
            c: c.into(),
            a: a.into(),
            b: b.into(),
            fixed: false,
        });
        self
    }
    pub fn ellipse(&mut self, id: &str, c: &str, major: &str, minor: &str) -> &mut Self {
        self.input.curves.push(CurveIn::Ellipse {
            id: id.into(),
            c: c.into(),
            major: major.into(),
            minor: minor.into(),
            fixed: false,
        });
        self
    }
    pub fn spline(
        &mut self,
        id: &str,
        pts: &[&str],
        degree: u32,
        samples: Vec<[f64; 2]>,
    ) -> &mut Self {
        self.input.curves.push(CurveIn::Spline {
            id: id.into(),
            pts: pts.iter().map(|s| s.to_string()).collect(),
            degree,
            fit: false,
            closed: false,
            handles: vec![],
            samples,
            rational: false,
            rho: None,
            fixed: false,
        });
        self
    }
    pub fn fit(
        &mut self,
        id: &str,
        pts: &[&str],
        handles: &[Option<&str>],
        samples: Vec<[f64; 2]>,
    ) -> &mut Self {
        self.input.curves.push(CurveIn::Spline {
            id: id.into(),
            pts: pts.iter().map(|s| s.to_string()).collect(),
            degree: 3,
            fit: true,
            closed: false,
            handles: handles.iter().map(|h| h.map(|s| s.to_string())).collect(),
            samples,
            rational: false,
            rho: None,
            fixed: false,
        });
        self
    }
    pub fn con(&mut self, kind: &str, refs: &[&str]) -> String {
        self.n += 1;
        let id = format!("k{}", self.n);
        self.input.constraints.push(ConstraintIn {
            id: id.clone(),
            kind: kind.into(),
            refs: refs.iter().map(|s| s.to_string()).collect(),
            ..Default::default()
        });
        id
    }
    pub fn conv(&mut self, kind: &str, refs: &[&str], variant: i64) -> String {
        let id = self.con(kind, refs);
        self.input.constraints.last_mut().unwrap().variant = Some(variant);
        id
    }
    pub fn offset(&mut self, p: &str, q: &str, dx: f64, dy: f64) -> String {
        let id = self.con("offsetCopy", &[p, q]);
        let k = self.input.constraints.last_mut().unwrap();
        k.dx = Some(dx);
        k.dy = Some(dy);
        id
    }
    pub fn rotated(&mut self, c: &str, p: &str, q: &str, angle: f64) -> String {
        let id = self.con("rotatedCopy", &[c, p, q]);
        self.input.constraints.last_mut().unwrap().angle = Some(angle);
        id
    }
    pub fn dim(&mut self, kind: &str, refs: &[&str], value: f64) -> String {
        self.n += 1;
        let id = format!("d{}", self.n);
        self.input.dimensions.push(DimensionIn {
            id: id.clone(),
            kind: kind.into(),
            refs: refs.iter().map(|s| s.to_string()).collect(),
            value,
            variant: None,
        });
        id
    }
    pub fn dimv(&mut self, kind: &str, refs: &[&str], value: f64, variant: i64) -> String {
        let id = self.dim(kind, refs, value);
        self.input.dimensions.last_mut().unwrap().variant = Some(variant);
        id
    }
    pub fn set_dim(&mut self, id: &str, value: f64) {
        self.input
            .dimensions
            .iter_mut()
            .find(|d| d.id == id)
            .unwrap()
            .value = value;
    }

    /// Solve, writing the result back like the bridge does.
    pub fn solve(&mut self) -> Output {
        self.input.analyze = false;
        self.run()
    }
    pub fn analyze(&mut self) -> Output {
        self.input.analyze = true;
        let o = self.run();
        self.input.analyze = false;
        o
    }
    fn run(&mut self) -> Output {
        let o = solve(&self.input);
        self.apply(&o);
        o
    }
    pub fn apply(&mut self, o: &Output) {
        for p in &mut self.input.points {
            if let Some(v) = o.points.get(&p.id) {
                p.x = v[0];
                p.y = v[1];
            }
        }
        for c in &mut self.input.curves {
            if let CurveIn::Circle { id, r, .. } = c
                && let Some(v) = o.radii.get(id)
            {
                *r = *v;
            }
        }
    }
    pub fn drag(&mut self, point: &str, x: f64, y: f64) -> Output {
        self.input.drag = vec![DragIn {
            point: point.into(),
            x,
            y,
        }];
        let o = solve(&self.input);
        self.apply(&o);
        self.input.drag.clear();
        o
    }
    pub fn p(&self, id: &str) -> (f64, f64) {
        let q = self.input.points.iter().find(|p| p.id == id).unwrap();
        (q.x, q.y)
    }
    pub fn r(&self, id: &str) -> f64 {
        for c in &self.input.curves {
            if let CurveIn::Circle { id: i, r, .. } = c
                && i == id
            {
                return *r;
            }
        }
        panic!("no circle {id}")
    }
    pub fn dist(&self, a: &str, b: &str) -> f64 {
        let (p, q) = (self.p(a), self.p(b));
        (p.0 - q.0).hypot(p.1 - q.1)
    }
}

pub fn near(a: f64, b: f64, tol: f64) {
    assert!((a - b).abs() <= tol, "{a} != {b} (tol {tol})");
}

pub fn near_p(a: (f64, f64), b: (f64, f64), tol: f64) {
    assert!(
        (a.0 - b.0).hypot(a.1 - b.1) <= tol,
        "{a:?} != {b:?} (tol {tol})"
    );
}

pub fn cross(a: (f64, f64), b: (f64, f64), c: (f64, f64), d: (f64, f64)) -> f64 {
    (b.0 - a.0) * (d.1 - c.1) - (b.1 - a.1) * (d.0 - c.0)
}

pub fn dot(a: (f64, f64), b: (f64, f64), c: (f64, f64), d: (f64, f64)) -> f64 {
    (b.0 - a.0) * (d.0 - c.0) + (b.1 - a.1) * (d.1 - c.1)
}

/// Signed distance of p from line a->b, left positive.
pub fn side(p: (f64, f64), a: (f64, f64), b: (f64, f64)) -> f64 {
    cross(a, b, a, p) / (b.0 - a.0).hypot(b.1 - a.1)
}
