//! Degrees of freedom and per-variable freedom.
//!
//! ezpz's `FreedomAnalysis` reports which variables are free but not the rank, so it cannot give
//! `dof` (a point rotating about a fixed centre has two free variables and one dof), and it runs a
//! dense SVD of the whole Jacobian. This does sparse Gauss-Jordan elimination on the Jacobian at
//! the solution: dof is variables minus rank, and a variable is free when it is a non-pivot column
//! or its pivot row still reaches a non-pivot column. `tests/analysis.rs` checks the classification
//! against ezpz's SVD result.

use crate::eq::{Dual, Eq, V};
use std::collections::HashMap;

const PIVOT_TOL: f64 = 1e-8;
const DROP_TOL: f64 = 1e-12;
const DETERMINED_TOL: f64 = 1e-7;

pub struct Freedom {
    pub free: Vec<bool>,
    pub dof: usize,
    /// Reduced row echelon form of the Jacobian; each pivot row has a pivot of 1 plus entries in
    /// non-pivot columns only.
    rows: Vec<Vec<(u32, f64)>>,
    pivot_of_col: Vec<u32>,
}

impl Freedom {
    /// Whether a row can only be met by what the other rows already fix, at `vals`: once the pivot
    /// variables are written in terms of the free ones, nothing of its gradient is left.
    pub fn settles(&self, eq: &Eq, vals: &[f64], fixed: &[bool]) -> bool {
        let mut rows = Vec::new();
        jacobian_rows(eq, vals, fixed, &mut rows);
        rows.iter().all(|row| {
            let mut left: HashMap<u32, f64> = HashMap::new();
            for &(v, g) in row {
                match self.pivot_of_col[v as usize] {
                    u32::MAX => *left.entry(v).or_default() += g,
                    p => {
                        for e in self.rows[p as usize].iter().filter(|e| e.0 != v) {
                            *left.entry(e.0).or_default() -= g * e.1;
                        }
                    }
                }
            }
            left.values().all(|x| x.abs() < DETERMINED_TOL)
        })
    }

    /// The tangent-space motion whose `targets` variables best match the wanted displacements
    /// `(var, delta)`. Writing x for the non-pivot variables, every pivot variable is a linear
    /// function of x, so the targets are T x; x = T' (T T' + e I)^-1 delta is the regularised
    /// pseudo-inverse. T has one row per target, so this is a tiny solve however large the sketch.
    #[allow(clippy::needless_range_loop)]
    pub fn tangent_motion(&self, targets: &[(V, f64)], fixed: &[bool]) -> Option<Vec<f64>> {
        let k = targets.len();
        let t: Vec<Vec<(u32, f64)>> = targets
            .iter()
            .map(|&(v, _)| {
                if fixed[v as usize] {
                    return vec![];
                }
                match self.pivot_of_col[v as usize] {
                    u32::MAX => vec![(v, 1.0)],
                    p => self.rows[p as usize]
                        .iter()
                        .filter(|e| e.0 != v)
                        .map(|e| (e.0, -e.1))
                        .collect(),
                }
            })
            .collect();
        let mut sparse_dot = vec![0.0; self.pivot_of_col.len()];
        let mut a = vec![vec![0.0; k + 1]; k];
        for i in 0..k {
            for e in &t[i] {
                sparse_dot[e.0 as usize] = e.1;
            }
            for j in 0..k {
                a[i][j] = t[j].iter().map(|e| sparse_dot[e.0 as usize] * e.1).sum();
            }
            for e in &t[i] {
                sparse_dot[e.0 as usize] = 0.0;
            }
            a[i][k] = targets[i].1;
        }
        let trace: f64 = (0..k).map(|i| a[i][i]).sum();
        if trace <= 0.0 {
            return None;
        }
        for i in 0..k {
            a[i][i] += 1e-10 * trace / k as f64;
        }
        for c in 0..k {
            let piv = (c..k).max_by(|&p, &q| a[p][c].abs().total_cmp(&a[q][c].abs()))?;
            a.swap(c, piv);
            let d = a[c][c];
            if d.abs() < 1e-300 {
                return None;
            }
            for r in 0..k {
                if r != c {
                    let m = a[r][c] / d;
                    if m != 0.0 {
                        for j in c..=k {
                            a[r][j] -= m * a[c][j];
                        }
                    }
                }
            }
        }
        let y: Vec<f64> = (0..k).map(|i| a[i][k] / a[i][i]).collect();

        let n = self.pivot_of_col.len();
        let mut d = vec![0.0; n];
        for i in 0..k {
            for e in &t[i] {
                d[e.0 as usize] += e.1 * y[i];
            }
        }
        let x = d.clone();
        for v in 0..n {
            if let Some(row) = self.rows.get(self.pivot_of_col[v] as usize) {
                d[v] = -row
                    .iter()
                    .filter(|e| e.0 as usize != v)
                    .map(|e| e.1 * x[e.0 as usize])
                    .sum::<f64>();
            }
        }
        Some(d)
    }
}

/// One Jacobian row per residual of `eq`, over the non-fixed variables, scaled to unit max-norm.
fn jacobian_rows(eq: &Eq, vals: &[f64], fixed: &[bool], out: &mut Vec<Vec<(u32, f64)>>) {
    let mut vars: Vec<V> = Vec::with_capacity(8);
    eq.vars(&mut vars);
    vars.sort_unstable();
    vars.dedup();
    let dim = eq.dim();
    let mut rows: [Vec<(u32, f64)>; 2] = [Vec::new(), Vec::new()];
    for &v in vars.iter().filter(|&&v| !fixed[v as usize]) {
        let x = |id: V| Dual {
            v: vals[id as usize],
            d: if id == v { 1.0 } else { 0.0 },
        };
        let r = eq.eval::<Dual>(&x);
        for k in 0..dim {
            if r[k].d != 0.0 && r[k].d.is_finite() {
                rows[k].push((v, r[k].d));
            }
        }
    }
    for row in rows {
        let scale = row.iter().map(|e| e.1.abs()).fold(0.0, f64::max);
        if scale > 1e-14 {
            out.push(row.into_iter().map(|(v, d)| (v, d / scale)).collect());
        }
    }
}

/// `a -= k * b`, both sorted by column.
fn eliminate(a: &[(u32, f64)], k: f64, b: &[(u32, f64)], out: &mut Vec<(u32, f64)>) {
    out.clear();
    let (mut i, mut j) = (0, 0);
    while i < a.len() || j < b.len() {
        let (col, val) = if j >= b.len() || (i < a.len() && a[i].0 < b[j].0) {
            i += 1;
            (a[i - 1].0, a[i - 1].1)
        } else if i >= a.len() || b[j].0 < a[i].0 {
            j += 1;
            (b[j - 1].0, -k * b[j - 1].1)
        } else {
            i += 1;
            j += 1;
            (a[i - 1].0, a[i - 1].1 - k * b[j - 1].1)
        };
        if val.abs() > DROP_TOL {
            out.push((col, val));
        }
    }
}

pub fn analyze<'a>(eqs: impl Iterator<Item = &'a Eq>, vals: &[f64], fixed: &[bool]) -> Freedom {
    let n = vals.len();
    let mut rows: Vec<Vec<(u32, f64)>> = Vec::new();
    for eq in eqs {
        jacobian_rows(eq, vals, fixed, &mut rows);
    }

    // Short rows first keeps fill low on chain-shaped sketches.
    rows.sort_by_key(|r| r.len());
    let mut in_col: Vec<Vec<u32>> = vec![Vec::new(); n];
    for (i, r) in rows.iter().enumerate() {
        for e in r {
            in_col[e.0 as usize].push(i as u32);
        }
    }

    let mut pivot_of_col = vec![u32::MAX; n];
    let mut scratch = Vec::new();
    for i in 0..rows.len() {
        let Some(&(col, val)) = rows[i]
            .iter()
            .max_by(|a, b| a.1.abs().total_cmp(&b.1.abs()))
        else {
            continue;
        };
        if val.abs() < PIVOT_TOL {
            rows[i].clear();
            continue;
        }
        for e in &mut rows[i] {
            e.1 /= val;
        }
        pivot_of_col[col as usize] = i as u32;
        let pivot = std::mem::take(&mut rows[i]);
        let mut users = std::mem::take(&mut in_col[col as usize]);
        users.sort_unstable();
        users.dedup();
        for &u in &users {
            let u = u as usize;
            if u == i {
                continue;
            }
            let Ok(pos) = rows[u].binary_search_by_key(&col, |e| e.0) else {
                continue;
            };
            let k = rows[u][pos].1;
            eliminate(&rows[u], k, &pivot, &mut scratch);
            std::mem::swap(&mut rows[u], &mut scratch);
            for e in &pivot {
                if e.0 != col {
                    in_col[e.0 as usize].push(u as u32);
                }
            }
        }
        rows[i] = pivot;
    }

    let mut free: Vec<bool> = (0..n)
        .map(|v| !fixed[v] && pivot_of_col[v] == u32::MAX)
        .collect();
    let free_cols = free.clone();
    for v in 0..n {
        let p = pivot_of_col[v];
        if p != u32::MAX {
            free[v] = rows[p as usize]
                .iter()
                .any(|e| e.1.abs() > PIVOT_TOL && free_cols[e.0 as usize]);
        }
    }
    let dof = free_cols.iter().filter(|&&f| f).count();
    Freedom {
        free,
        dof,
        rows,
        pivot_of_col,
    }
}

/// ezpz's own dense-SVD classification of the same system, ids of free points. For cross-checks:
/// too slow for production and only available through its solve entry point.
pub fn ezpz_free_points(input: &crate::api::Input) -> Vec<String> {
    use kcl_ezpz::ConstraintRequest;
    let Ok(sys) = crate::sys::build(input) else {
        return vec![];
    };
    let mut reqs: Vec<ConstraintRequest> = sys
        .rows
        .iter()
        .map(|r| ConstraintRequest::highest_priority(r.eq.lower()))
        .collect();
    for (v, f) in sys.fixed.iter().enumerate() {
        if *f {
            reqs.push(ConstraintRequest::highest_priority(
                Eq::Fixed(v as V, sys.vals[v]).lower(),
            ));
        }
    }
    let guess: Vec<(V, f64)> = sys
        .vals
        .iter()
        .enumerate()
        .map(|(i, &x)| (i as V, x))
        .collect();
    let Ok(out) = kcl_ezpz::solve_analysis(&reqs, guess, crate::solve::config()) else {
        return vec![];
    };
    let free = out.analysis.underconstrained();
    sys.points
        .iter()
        .filter(|p| free.contains(&p.var.0) || free.contains(&p.var.1))
        .map(|p| p.id.clone())
        .collect()
}
