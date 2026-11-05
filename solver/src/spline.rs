//! Fit and control splines as `src/geom/spline.ts` draws them, so the solver can read a curve at the
//! geometry it has now rather than at the `samples` the solve began with. A row of this crate is
//! only ever as good as this agreement: `src/solver/spline-limits.test.ts` measures every result
//! with the TypeScript curve.

use crate::eq::P;

pub type Xy = (f64, f64);

/// As `EPS_CHORD` in `src/geom/tolerance.ts`.
const EPS_CHORD: f64 = 1e-9;
const EPS_ZERO: f64 = 1e-12;
/// Places tried per span when looking for the foot of a point.
const SEARCH_PER_SPAN: usize = 24;

/// The variables of a spline, by index in `Sys::splines`.
#[derive(Clone, Debug)]
pub struct SplineVars {
    pub pts: Vec<P>,
    pub handles: Vec<Option<P>>,
    pub fit: bool,
    pub closed: bool,
    pub degree: u32,
}

fn cross(a: Xy, b: Xy) -> f64 {
    a.0 * b.1 - a.1 * b.0
}
fn sub(a: Xy, b: Xy) -> Xy {
    (a.0 - b.0, a.1 - b.1)
}
fn dot(a: Xy, b: Xy) -> f64 {
    a.0 * b.0 + a.1 * b.1
}
fn scale(a: Xy, s: f64) -> Xy {
    (a.0 * s, a.1 * s)
}
fn norm(a: Xy) -> f64 {
    a.0.hypot(a.1)
}

fn tridiagonal(lower: &[f64], diag: &[f64], upper: &[f64], rhs: &[f64]) -> Vec<f64> {
    let n = diag.len();
    let mut c = vec![0.0; n];
    let mut d = vec![0.0; n];
    c[0] = upper[0] / diag[0];
    d[0] = rhs[0] / diag[0];
    for i in 1..n {
        let m = diag[i] - lower[i] * c[i - 1];
        c[i] = upper[i] / m;
        d[i] = (rhs[i] - lower[i] * d[i - 1]) / m;
    }
    for i in (0..n - 1).rev() {
        d[i] -= c[i] * d[i + 1];
    }
    d
}

fn dense(mut a: Vec<Vec<f64>>, mut b: Vec<f64>) -> Vec<f64> {
    let n = b.len();
    for c in 0..n {
        let best = (c..n).fold(c, |m, r| if a[r][c].abs() > a[m][c].abs() { r } else { m });
        if a[best][c].abs() < EPS_ZERO {
            continue;
        }
        a.swap(c, best);
        b.swap(c, best);
        for r in c + 1..n {
            let f = a[r][c] / a[c][c];
            if f != 0.0 {
                let (top, low) = a.split_at_mut(r);
                low[0].iter_mut().zip(&top[c]).skip(c).for_each(|(x, y)| *x -= f * y);
                b[r] -= f * b[c];
            }
        }
    }
    let mut x = vec![0.0; n];
    for r in (0..n).rev() {
        let s: f64 = b[r] - (r + 1..n).map(|k| a[r][k] * x[k]).sum::<f64>();
        x[r] = if a[r][r].abs() < EPS_ZERO { 0.0 } else { s / a[r][r] };
    }
    x
}

/// Tridiagonal with corner terms `lower[0]` and `upper[n - 1]`, by Sherman-Morrison.
fn cyclic(lower: &[f64], diag: &[f64], upper: &[f64], rhs: &[f64]) -> Vec<f64> {
    let n = diag.len();
    if n < 5 {
        let mut m = vec![vec![0.0; n]; n];
        for i in 0..n {
            m[i][i] += diag[i];
            m[i][(i + 1) % n] += upper[i];
            m[i][(i + n - 1) % n] += lower[i];
        }
        return dense(m, rhs.to_vec());
    }
    let (alpha, beta, gamma) = (upper[n - 1], lower[0], -diag[0]);
    let mut d2 = diag.to_vec();
    d2[0] -= gamma;
    d2[n - 1] -= alpha * beta / gamma;
    let x = tridiagonal(lower, &d2, upper, rhs);
    let mut u = vec![0.0; n];
    u[0] = gamma;
    u[n - 1] = alpha;
    let z = tridiagonal(lower, &d2, upper, &u);
    let fact = (x[0] + beta * x[n - 1] / gamma) / (1.0 + z[0] + beta * z[n - 1] / gamma);
    x.iter().zip(&z).map(|(v, w)| v - fact * w).collect()
}

/// A fit spline's chords, which are what make it nonlinear in its points: held still, the curve is
/// linear in them, and that is what `Curve::weights` reads.
#[derive(Clone, Debug)]
struct Chords {
    h: Vec<f64>,
    closed: bool,
}

impl Chords {
    fn new(pts: &[Xy], closed: bool) -> Chords {
        let n = pts.len();
        let closed = closed && n >= 3;
        let count = if closed { n } else { n - 1 };
        let h = (0..count)
            .map(|i| norm(sub(pts[i], pts[(i + 1) % n])).max(EPS_CHORD))
            .collect();
        Chords { h, closed }
    }

    fn local(&self, i: usize, n: usize) -> f64 {
        let h = &self.h;
        if self.closed {
            (h[(i + n - 1) % n] + h[i]) / 2.0
        } else if i == 0 {
            h[0]
        } else if i == n - 1 {
            h[n - 2]
        } else {
            (h[i - 1] + h[i]) / 2.0
        }
    }
}

#[derive(Clone, Debug)]
pub struct Hermite {
    u: Vec<f64>,
    p: Vec<Xy>,
    d: Vec<Xy>,
    total: f64,
    closed: bool,
}

fn hermite(pts: &[Xy], handles: &[Option<Xy>], ch: &Chords) -> Hermite {
    let n = pts.len();
    let (h, closed) = (&ch.h, ch.closed);
    let (mut lower, mut diag, mut upper) = (vec![0.0; n], vec![1.0; n], vec![0.0; n]);
    let (mut rx, mut ry) = (vec![0.0; n], vec![0.0; n]);
    for i in 0..n {
        if let Some(Some(handle)) = handles.get(i) {
            let t = scale(sub(*handle, pts[i]), 3.0 / ch.local(i, n).max(EPS_CHORD));
            rx[i] = t.0;
            ry[i] = t.1;
        } else if !closed && i == 0 {
            diag[i] = 2.0 / h[0];
            upper[i] = 1.0 / h[0];
            let d = sub(pts[1], pts[0]);
            rx[i] = 3.0 * d.0 / (h[0] * h[0]);
            ry[i] = 3.0 * d.1 / (h[0] * h[0]);
        } else if !closed && i == n - 1 {
            let hl = h[n - 2];
            lower[i] = 1.0 / hl;
            diag[i] = 2.0 / hl;
            let d = sub(pts[n - 1], pts[n - 2]);
            rx[i] = 3.0 * d.0 / (hl * hl);
            ry[i] = 3.0 * d.1 / (hl * hl);
        } else {
            let (hp, hn) = (h[(i + n - 1) % n], h[i]);
            let (prev, next) = (pts[(i + n - 1) % n], pts[(i + 1) % n]);
            lower[i] = 1.0 / hp;
            diag[i] = 2.0 * (1.0 / hp + 1.0 / hn);
            upper[i] = 1.0 / hn;
            rx[i] = 3.0 * ((pts[i].0 - prev.0) / (hp * hp) + (next.0 - pts[i].0) / (hn * hn));
            ry[i] = 3.0 * ((pts[i].1 - prev.1) / (hp * hp) + (next.1 - pts[i].1) / (hn * hn));
        }
    }
    let solve = if closed { cyclic } else { tridiagonal };
    let (dx, dy) = (solve(&lower, &diag, &upper, &rx), solve(&lower, &diag, &upper, &ry));
    let mut d: Vec<Xy> = dx.into_iter().zip(dy).collect();
    let mut u = vec![0.0];
    for c in h {
        u.push(u[u.len() - 1] + c);
    }
    let mut p = pts.to_vec();
    if closed {
        p.push(pts[0]);
        d.push(d[0]);
    }
    let total = u[u.len() - 1];
    Hermite { u, p, d, total, closed }
}

impl Hermite {
    fn span(&self, x: f64) -> usize {
        let (mut lo, mut hi) = (0, self.u.len() - 2);
        while lo < hi {
            let m = (lo + hi).div_ceil(2);
            if self.u[m] <= x {
                lo = m;
            } else {
                hi = m - 1;
            }
        }
        lo
    }

    fn coef(&self, t: f64) -> (usize, f64, f64) {
        let t = if self.closed { t - t.floor() } else { t };
        let x = t * self.total;
        let i = self.span(x);
        let h = self.u[i + 1] - self.u[i];
        (i, h, (x - self.u[i]) / h)
    }

    fn mix(&self, i: usize, a: f64, b: f64, c: f64, e: f64) -> Xy {
        let (p0, p1, d0, d1) = (self.p[i], self.p[i + 1], self.d[i], self.d[i + 1]);
        (
            a * p0.0 + b * d0.0 + c * p1.0 + e * d1.0,
            a * p0.1 + b * d0.1 + c * p1.1 + e * d1.1,
        )
    }

    fn at(&self, t: f64) -> Xy {
        let (i, h, r) = self.coef(t);
        let (r2, r3) = (r * r, r * r * r);
        self.mix(
            i,
            2.0 * r3 - 3.0 * r2 + 1.0,
            h * (r3 - 2.0 * r2 + r),
            -2.0 * r3 + 3.0 * r2,
            h * (r3 - r2),
        )
    }

    fn d1(&self, t: f64) -> Xy {
        let (i, h, r) = self.coef(t);
        let a = (6.0 * r * r - 6.0 * r) / h;
        let v = self.mix(i, a, 3.0 * r * r - 4.0 * r + 1.0, -a, 3.0 * r * r - 2.0 * r);
        scale(v, self.total)
    }

    fn d2(&self, t: f64) -> Xy {
        let (i, h, r) = self.coef(t);
        let a = (12.0 * r - 6.0) / (h * h);
        let v = self.mix(i, a, (6.0 * r - 4.0) / h, -a, (6.0 * r - 2.0) / h);
        scale(v, self.total * self.total)
    }
}

/// Clamped uniform knots, the degree dropping when there are too few points.
fn knots(n: usize, degree: u32) -> (usize, Vec<f64>) {
    let p = (degree as usize).min(n - 1);
    let spans = n - p;
    let mut k = vec![0.0; p + 1];
    k.extend((1..spans).map(|i| i as f64 / spans as f64));
    k.extend(std::iter::repeat_n(1.0, p + 1));
    (p, k)
}

#[derive(Clone, Debug)]
pub struct BSpline {
    p: usize,
    knots: Vec<f64>,
    ctrl: Vec<Xy>,
}

impl BSpline {
    fn span(&self, u: f64) -> usize {
        let n = self.ctrl.len() - 1;
        if u >= self.knots[n + 1] {
            return n;
        }
        if u <= self.knots[self.p] {
            return self.p;
        }
        let (mut lo, mut hi) = (self.p, n + 1);
        while hi - lo > 1 {
            let m = (lo + hi) >> 1;
            if u < self.knots[m] {
                hi = m;
            } else {
                lo = m;
            }
        }
        lo
    }

    fn at(&self, u: f64) -> Xy {
        let (p, k) = (self.p, self.span(u));
        if p == 0 {
            return self.ctrl[k];
        }
        let mut d: Vec<Xy> = (0..=p).map(|j| self.ctrl[j + k - p]).collect();
        for r in 1..=p {
            for j in (r..=p).rev() {
                let i = j + k - p;
                let den = self.knots[i + p - r + 1] - self.knots[i];
                let a = if den == 0.0 { 0.0 } else { (u - self.knots[i]) / den };
                d[j] = (
                    (1.0 - a) * d[j - 1].0 + a * d[j].0,
                    (1.0 - a) * d[j - 1].1 + a * d[j].1,
                );
            }
        }
        d[p]
    }

    fn derivative(&self) -> BSpline {
        let p = self.p;
        if p == 0 {
            return BSpline { p: 0, knots: vec![0.0, 1.0], ctrl: vec![(0.0, 0.0)] };
        }
        let ctrl = (0..self.ctrl.len() - 1)
            .map(|i| {
                let den = self.knots[i + p + 1] - self.knots[i + 1];
                let f = if den == 0.0 { 0.0 } else { p as f64 / den };
                scale(sub(self.ctrl[i + 1], self.ctrl[i]), f)
            })
            .collect();
        BSpline { p: p - 1, knots: self.knots[1..self.knots.len() - 1].to_vec(), ctrl }
    }
}

#[derive(Clone, Debug)]
enum Form {
    Fit(Hermite, Chords, Vec<bool>),
    Control(BSpline, BSpline, BSpline),
}

/// A spline at given points. `t` runs over [0, 1], as `SplineEval`.
#[derive(Clone, Debug)]
pub struct Curve {
    form: Form,
    n: usize,
}

impl Curve {
    pub fn fit(pts: &[Xy], closed: bool, handles: &[Option<Xy>]) -> Curve {
        let ch = Chords::new(pts, closed);
        let mask = (0..pts.len()).map(|i| matches!(handles.get(i), Some(Some(_)))).collect();
        Curve { form: Form::Fit(hermite(pts, handles, &ch), ch, mask), n: pts.len() }
    }

    pub fn control(pts: &[Xy], degree: u32) -> Curve {
        let (p, k) = knots(pts.len(), degree);
        let b = BSpline { p, knots: k, ctrl: pts.to_vec() };
        let b1 = b.derivative();
        let b2 = b1.derivative();
        Curve { form: Form::Control(b, b1, b2), n: pts.len() }
    }

    pub fn closed(&self) -> bool {
        matches!(&self.form, Form::Fit(_, c, _) if c.closed)
    }

    pub fn at(&self, t: f64) -> Xy {
        match &self.form {
            Form::Fit(h, ..) => h.at(t),
            Form::Control(b, ..) => b.at(t.clamp(0.0, 1.0)),
        }
    }

    pub fn d1(&self, t: f64) -> Xy {
        match &self.form {
            Form::Fit(h, ..) => h.d1(t),
            Form::Control(_, b, _) => b.at(t.clamp(0.0, 1.0)),
        }
    }

    pub fn d2(&self, t: f64) -> Xy {
        match &self.form {
            Form::Fit(h, ..) => h.d2(t),
            Form::Control(.., b) => b.at(t.clamp(0.0, 1.0)),
        }
    }

    pub fn spans(&self) -> usize {
        match &self.form {
            Form::Fit(h, ..) => h.u.len() - 1,
            Form::Control(b, ..) => self.n - b.p,
        }
    }

    /// Unit direction out of an end into the curve, and signed curvature travelling that way.
    pub fn end(&self, at_start: bool) -> Option<(Xy, f64)> {
        let (t, s) = if at_start { (0.0, 1.0) } else { (1.0, -1.0) };
        let (d, dd) = (self.d1(t), self.d2(t));
        let speed = norm(d);
        (speed >= EPS_ZERO).then(|| (scale(d, s / speed), s * cross(d, dd) / speed.powi(3)))
    }

    /// The parameter of the place on the curve nearest `p`.
    pub fn nearest(&self, p: Xy) -> f64 {
        let n = self.spans().max(1) * SEARCH_PER_SPAN;
        let miss = |t: f64| norm(sub(self.at(t), p));
        let mut t = (0..=n).map(|i| i as f64 / n as f64).fold((0.0, f64::INFINITY), |best, u| {
            let m = miss(u);
            if m < best.1 { (u, m) } else { best }
        }).0;
        let closed = self.closed();
        let inside = |x: f64| if closed { x } else { x.clamp(0.0, 1.0) };
        for _ in 0..8 {
            let (r, d, dd) = (sub(self.at(t), p), self.d1(t), self.d2(t));
            let (g, h) = (dot(r, d), dot(d, d) + dot(r, dd));
            if h.abs() < EPS_ZERO {
                break;
            }
            let next = inside(t - g / h);
            if miss(next) > miss(t) || (next - t).abs() < 1e-14 {
                break;
            }
            t = next;
        }
        t
    }

    /// The points that matter most at `t`, by index: a control spline's span, a fit spline's span and
    /// the point either side of it.
    pub fn around(&self, t: f64) -> Vec<usize> {
        let n = self.n;
        match &self.form {
            Form::Fit(h, c, _) => {
                let (i, ..) = h.coef(t);
                let wide = i as isize - 1..=i as isize + 2;
                let mut out = Vec::new();
                for k in wide {
                    let at = if c.closed {
                        Some(k.rem_euclid(n as isize) as usize)
                    } else {
                        (0..n as isize).contains(&k).then_some(k as usize)
                    };
                    if let Some(at) = at.filter(|a| !out.contains(a)) {
                        out.push(at);
                    }
                }
                out
            }
            Form::Control(b, ..) => {
                let k = b.span(t.clamp(0.0, 1.0));
                (k - b.p..=k).collect()
            }
        }
    }

    /// How far the curve at `t` moves per unit of each of `idx`, chords held still.
    pub fn weights(&self, idx: &[usize], t: f64) -> Vec<f64> {
        let n = self.n;
        idx.iter()
            .map(|&j| {
                let mut unit = vec![(0.0, 0.0); n];
                unit[j] = (1.0, 0.0);
                match &self.form {
                    Form::Fit(_, c, mask) => {
                        let held: Vec<Option<Xy>> = mask.iter().map(|&m| m.then_some((0.0, 0.0))).collect();
                        hermite(&unit, &held, c).at(t).0
                    }
                    Form::Control(b, ..) => {
                        BSpline { p: b.p, knots: b.knots.clone(), ctrl: unit }.at(t.clamp(0.0, 1.0)).0
                    }
                }
            })
            .collect()
    }
}
