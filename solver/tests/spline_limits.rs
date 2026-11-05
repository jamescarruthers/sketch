//! A point that pulls a spline, and a fit spline's end taking a curvature. What the app draws is
//! measured in `src/solver/spline-limits.test.ts`; here is the mapping, native and quick.

mod common;

use common::*;
use sketch_solver::eq::{Dual, Eq, P};
use sketch_solver::spline::Curve;
use std::time::Instant;

fn samples(c: &Curve) -> Vec<[f64; 2]> {
    (0..=240)
        .map(|i| {
            let p = c.at(i as f64 / 240.0);
            [p.0, p.1]
        })
        .collect()
}

/// Same ids as ezpz's row: what the crate lowers it to must be what `eval` says it is.
#[test]
fn a_lerp_row_is_linear_in_its_ends_and_exact() {
    let e = Eq::Lerp { out: 0, a: 1, b: 2, r: 3, ends: P(4, 5) };
    let vals = [0.0, 10.0, 30.0, 0.25, 0.0, 1.0];
    let at = |v: u32| vals[v as usize];
    assert_eq!(e.eval::<f64>(&at)[0], -15.0);
    let by = |wrt: u32| {
        let x = |v: u32| Dual { v: vals[v as usize], d: if v == wrt { 1.0 } else { 0.0 } };
        e.eval::<Dual>(&x)[0].d
    };
    near(by(0), 1.0, 1e-12);
    near(by(1), -0.75, 1e-12);
    near(by(2), -0.25, 1e-12);
}

#[test]
fn a_hidden_lever_is_not_a_degree_of_freedom() {
    let c = Curve::control(&[(0., 0.), (15., 20.), (35., 20.), (50., 0.)], 3);
    let mut d = Doc::new();
    d.pt("s0", 0., 0.).pt("s1", 15., 20.).pt("s2", 35., 20.).pt("s3", 50., 0.);
    d.spline("s", &["s0", "s1", "s2", "s3"], 3, samples(&c));
    d.pt("p", 25., 15.);
    d.fix("p");
    d.con("coincident", &["p", "s"]);
    let o = d.analyze();
    assert!(o.ok, "{o:?}");
    assert_eq!(o.dof, Some(8 - 1));
}

#[test]
fn dragging_a_point_on_a_free_spline_moves_the_spline_and_reaches_the_cursor() {
    let at = [(0., 0.), (15., 20.), (35., 20.), (50., 0.), (70., 5.)];
    let c = Curve::control(&at, 3);
    let mut d = Doc::new();
    for (i, q) in at.iter().enumerate() {
        d.pt(&format!("s{i}"), q.0, q.1);
    }
    d.spline("s", &["s0", "s1", "s2", "s3", "s4"], 3, samples(&c));
    let foot = c.at(0.4);
    d.pt("p", foot.0, foot.1);
    d.con("coincident", &["p", "s"]);
    let o = d.drag("p", foot.0, foot.1 + 6.0);
    assert!(o.ok, "{o:?}");
    near_p(d.p("p"), (foot.0, foot.1 + 6.0), 1e-6);
    let moved: Vec<(f64, f64)> = (0..5).map(|i| d.p(&format!("s{i}"))).collect();
    let now = Curve::control(&moved, 3);
    let q = now.at(now.nearest(d.p("p")));
    near_p(q, d.p("p"), 1e-5);
}

#[test]
fn a_fixed_spline_gives_nothing_and_the_point_slides() {
    let at = [(0., 0.), (20., 10.), (40., 0.)];
    let c = Curve::fit(&at, false, &[]);
    let mut d = Doc::new();
    for (i, q) in at.iter().enumerate() {
        d.pt(&format!("s{i}"), q.0, q.1);
    }
    d.fix("s0").fix("s1").fix("s2");
    d.fit("s", &["s0", "s1", "s2"], &[None, None, None], samples(&c));
    let foot = c.at(0.3);
    d.pt("p", foot.0, foot.1);
    d.con("coincident", &["p", "s"]);
    let o = d.drag("p", foot.0 + 3.0, foot.1 + 40.0);
    assert!(o.ok, "{o:?}");
    near_p(d.p("s1"), (20., 10.), 1e-12);
    let q = c.at(c.nearest(d.p("p")));
    near_p(q, d.p("p"), 5e-3);
}

#[test]
fn a_drag_step_with_a_pull_stays_in_a_frame() {
    let at: Vec<(f64, f64)> = (0..20).map(|i| (i as f64 * 15.0, (i as f64).sin() * 12.0)).collect();
    let c = Curve::fit(&at, false, &[]);
    let names: Vec<String> = (0..20).map(|i| format!("s{i}")).collect();
    let refs: Vec<&str> = names.iter().map(|s| s.as_str()).collect();
    let mut d = Doc::new();
    for (i, q) in at.iter().enumerate() {
        d.pt(&names[i], q.0, q.1);
    }
    d.fit("s", &refs, &vec![None; 20], samples(&c));
    let foot = c.at(0.5);
    d.pt("p", foot.0, foot.1);
    d.con("coincident", &["p", "s"]);
    let t = Instant::now();
    for i in 1..=40 {
        let o = d.drag("p", foot.0, foot.1 + i as f64 * 0.25);
        assert!(o.ok, "{o:?}");
    }
    let each = t.elapsed().as_secs_f64() * 1000.0 / 40.0;
    println!("pull drag step: {each:.3} ms");
    assert!(each < 16.0, "{each} ms");
}

/// Curvature leaving the start of a two point fit spline, from its handle: Hermite with a natural
/// far end, so `cross(T, D) / (3 a^2)`, where `a` is the handle's length.
fn start_kappa(d: &Doc) -> f64 {
    let (e, h, f) = (d.p("f0"), d.p("h"), d.p("f1"));
    let a = (h.0 - e.0).hypot(h.1 - e.1);
    let t = ((h.0 - e.0) / a, (h.1 - e.1) / a);
    (t.0 * (f.1 - e.1) - t.1 * (f.0 - e.0)) / (3.0 * a * a)
}

#[test]
fn a_two_point_fit_spline_takes_an_arcs_curvature_by_its_handle() {
    let mut d = Doc::new();
    d.pt("c", 0., -30.).pt("j", 0., 0.).pt("o", -30., -30.).arc("r", "c", "j", "o");
    d.pt("f0", 0., 0.).pt("f1", 40., -18.).pt("h", 12., 0.);
    d.fit("f", &["f0", "f1"], &[Some("h"), None], vec![]);
    d.con("coincident", &["j", "f0"]);
    d.conv("curvature", &["f", "r"], 0);
    let o = d.solve();
    assert!(o.ok, "{o:?}");
    near(start_kappa(&d), -1.0 / 30.0, 1e-5);
    near_p(d.p("f1"), (40., -18.), 1e-9);
    assert!((d.p("h").1).abs() < 1e-6);
}

#[test]
fn a_new_curvature_leaves_the_joint_and_the_arc_alone() {
    let mut d = Doc::new();
    d.pt("c", 0., -30.).pt("j", 0., 0.).pt("o", -30., -30.).arc("r", "c", "j", "o");
    d.pt("f0", 0., 0.).pt("f1", 30., 15.).pt("f2", 55., 40.).pt("h", 10., 0.);
    d.fit("f", &["f0", "f1", "f2"], &[Some("h"), None, None], vec![]);
    d.con("coincident", &["j", "f0"]);
    d.conv("curvature", &["f", "r"], 0);
    let o = d.solve();
    assert!(o.ok, "{o:?}");
    near_p(d.p("j"), (0., 0.), 1e-7);
    near_p(d.p("c"), (0., -30.), 1e-7);
    near_p(d.p("f2"), (55., 40.), 1e-9);
    let s = Curve::fit(&[d.p("f0"), d.p("f1"), d.p("f2")], false, &[Some(d.p("h"))]);
    near(s.end(true).unwrap().1, -1.0 / 30.0, 1e-5);
}

#[test]
fn a_curvature_nothing_can_meet_is_reported_and_moves_nothing() {
    let mut d = Doc::new();
    d.pt("c", 0., -30.).pt("j", 0., 0.).pt("o", -30., -30.).arc("r", "c", "j", "o");
    d.pt("f0", 0., 0.).pt("f1", 30., 15.).pt("f2", 55., 40.).pt("h", 10., 0.);
    d.fix("f1").fix("h");
    d.fit("f", &["f0", "f1", "f2"], &[Some("h"), None, None], vec![]);
    d.con("coincident", &["j", "f0"]);
    let k = d.conv("curvature", &["f", "r"], 0);
    let o = d.solve();
    assert!(!o.ok);
    assert!(o.unsatisfied.contains(&k), "{o:?}");
    near_p(d.p("j"), (0., 0.), 1e-9);
    near_p(d.p("f2"), (55., 40.), 1e-9);
}

/// The row keeps the handle's direction to the tangent, so its length is the only thing it adds.
#[test]
fn curvature_takes_one_more_equation_on_a_fit_end() {
    let dof = |curvature: bool| {
        let mut d = Doc::new();
        d.pt("c", 0., -30.).pt("j", 0., 0.).pt("o", -30., -30.).arc("r", "c", "j", "o");
        d.pt("f0", 0., 0.).pt("f1", 30., -15.).pt("f2", 55., -40.).pt("h", 10., 0.);
        d.fit("f", &["f0", "f1", "f2"], &[Some("h"), None, None], vec![]);
        d.con("coincident", &["j", "f0"]);
        d.conv(if curvature { "curvature" } else { "tangent" }, &["f", "r"], 0);
        let o = d.analyze();
        assert!(o.ok, "{o:?}");
        o.dof.unwrap()
    };
    assert_eq!(dof(true) + 1, dof(false));
}

#[test]
fn a_draft_of_one_point_reads_as_that_point() {
    let mut d = Doc::new();
    d.pt("f0", 0., 0.).pt("g0", 0., 0.).pt("g1", 20., 5.).pt("h", 8., 0.);
    d.fit("f", &["f0"], &[None], vec![]);
    d.fit("g", &["g0", "g1"], &[Some("h"), None], vec![]);
    d.con("coincident", &["f0", "g0"]);
    d.conv("curvature", &["g", "f"], 0);
    d.solve();
    assert!(d.p("g1").0.is_finite());
}

/// Status never lies: over random joints, a control spline reported as matched is matched, by the
/// real curve at the end of the solve and not by the row that was steering it.
#[test]
fn a_control_spline_reported_as_matched_is_matched() {
    let mut seed = 12345u64;
    let mut rnd = move |lo: f64, hi: f64| {
        seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        lo + (hi - lo) * ((seed >> 33) as f64 / (1u64 << 31) as f64)
    };
    let mut lies = Vec::new();
    for case in 0..1500 {
        let n = 4 + (case % 3);
        let degree = if case % 2 == 0 { 3 } else { 5 };
        let mut d = Doc::new();
        let names: Vec<String> = (0..n).map(|i| format!("g{i}")).collect();
        let mut at = vec![(0.0, 0.0)];
        for i in 1..n {
            at.push((-(i as f64) * rnd(8., 20.), rnd(-25., 25.)));
        }
        for (i, q) in at.iter().enumerate() {
            d.pt(&names[i], q.0, q.1);
        }
        let refs: Vec<&str> = names.iter().map(|s| s.as_str()).collect();
        d.spline("g", &refs, degree, vec![]);
        let (fx, fy, gx, gy) = (rnd(15., 40.), rnd(-30., 30.), rnd(40., 70.), rnd(-40., 40.));
        let h = (rnd(4., 20.), rnd(-8., 8.));
        d.pt("f0", 0., 0.).pt("f1", fx, fy).pt("f2", gx, gy).pt("h", h.0, h.1);
        d.fit("f", &["f0", "f1", "f2"], &[Some("h"), None, None], vec![]);
        d.con("coincident", &["g0", "f0"]);
        d.conv("curvature", &["g", "f"], 0);
        if case % 5 == 0 {
            d.fix("g1").fix("g2");
        }
        if case % 7 == 0 {
            d.fix("f1").fix("f2");
        }
        let o = d.solve();
        if !o.ok {
            continue;
        }
        let g: Vec<(f64, f64)> = names.iter().map(|i| d.p(i)).collect();
        let f = Curve::fit(&[d.p("f0"), d.p("f1"), d.p("f2")], false, &[Some(d.p("h"))]);
        let (Some(a), Some(b)) = (Curve::control(&g, degree).end(true), f.end(true)) else {
            continue;
        };
        let want = if a.0.0 * b.0.0 + a.0.1 * b.0.1 < 0.0 { -b.1 } else { b.1 };
        if (a.1 - want).abs() > 1e-6 + 1e-3 * want.abs() {
            lies.push((case, a.1, want));
        }
    }
    assert!(lies.is_empty(), "{} lies, first {:?}", lies.len(), &lies[..lies.len().min(4)]);
}
