//! Every ConstraintType on a small system, verified by measuring the solved geometry.
mod common;
use common::*;
use std::f64::consts::{FRAC_PI_2, FRAC_PI_4, PI};

const T: f64 = 1e-6;

fn ok(d: &mut Doc) {
    let o = d.solve();
    assert!(o.ok, "{o:?}");
    assert!(o.unsatisfied.is_empty(), "{o:?}");
}

/// Line tangent check for an ellipse: a^2 (u.n)^2 + b^2 (v.n)^2 = (n.(p-c))^2.
fn ellipse_tangent_residual(d: &Doc, c: &str, major: &str, minor: &str, p: &str, q: &str) -> f64 {
    let (pc, pm, pn, a, b) = (d.p(c), d.p(major), d.p(minor), d.p(p), d.p(q));
    let (ra, rb) = (d.dist(c, major), d.dist(c, minor));
    let u = ((pm.0 - pc.0) / ra, (pm.1 - pc.1) / ra);
    let v = ((pn.0 - pc.0) / rb, (pn.1 - pc.1) / rb);
    let l = (b.0 - a.0).hypot(b.1 - a.1);
    let n = (-(b.1 - a.1) / l, (b.0 - a.0) / l);
    let un = u.0 * n.0 + u.1 * n.1;
    let vn = v.0 * n.0 + v.1 * n.1;
    let dist = n.0 * (a.0 - pc.0) + n.1 * (a.1 - pc.1);
    (ra * ra * un * un + rb * rb * vn * vn).sqrt() - dist.abs()
}

fn on_ellipse_residual(d: &Doc, c: &str, major: &str, minor: &str, p: &str) -> f64 {
    let (pc, pm, pn, q) = (d.p(c), d.p(major), d.p(minor), d.p(p));
    let (ra, rb) = (d.dist(c, major), d.dist(c, minor));
    let w = (q.0 - pc.0, q.1 - pc.1);
    let x = (w.0 * (pm.0 - pc.0) + w.1 * (pm.1 - pc.1)) / ra / ra;
    let y = (w.0 * (pn.0 - pc.0) + w.1 * (pn.1 - pc.1)) / rb / rb;
    (x * x + y * y).sqrt() - 1.0
}

#[test]
fn coincident_points_share_position_first_ref_wins() {
    let mut d = Doc::new();
    d.pt("a", 1., 2.).pt("b", 5., 6.);
    d.con("coincident", &["a", "b"]);
    ok(&mut d);
    near_p(d.p("a"), (1., 2.), T);
    near_p(d.p("b"), (1., 2.), T);
}

#[test]
fn coincident_to_origin() {
    let mut d = Doc::new();
    d.pt("a", 3., 2.);
    d.con("coincident", &["a", "origin"]);
    ok(&mut d);
    near_p(d.p("a"), (0., 0.), T);
}

#[test]
fn coincident_point_on_line_stays_on_carrier() {
    let mut d = Doc::new();
    d.seg("l", (0., 0.), (10., 10.)).pt("p", 8., 2.);
    d.con("coincident", &["p", "l"]);
    ok(&mut d);
    near(side(d.p("p"), d.p("la"), d.p("lb")), 0., T);
}

#[test]
fn coincident_point_on_axis() {
    let mut d = Doc::new();
    d.pt("p", 8., 2.).pt("q", 3., 7.);
    d.con("coincident", &["p", "axis-x"]);
    d.con("coincident", &["q", "axis-y"]);
    ok(&mut d);
    near(d.p("p").1, 0., T);
    near(d.p("q").0, 0., T);
}

#[test]
fn coincident_point_on_circle_and_arc() {
    let mut d = Doc::new();
    d.pt("c", 0., 0.).circle("k", "c", 10.).pt("p", 3., 2.);
    d.pt("c2", 30., 0.)
        .pt("a", 40., 0.)
        .pt("b", 30., 10.)
        .arc("r", "c2", "a", "b")
        .pt("q", 33., 3.);
    d.con("coincident", &["p", "k"]);
    d.con("coincident", &["q", "r"]);
    ok(&mut d);
    near(d.dist("c", "p"), d.r("k"), T);
    near(d.dist("c2", "q"), d.dist("c2", "a"), T);
}

#[test]
fn coincident_point_on_ellipse_is_two_way() {
    let mut d = Doc::new();
    d.pt("c", 0., 0.)
        .pt("m", 20., 0.)
        .pt("n", 0., 10.)
        .ellipse("e", "c", "m", "n");
    d.pt("p", 12., 11.);
    d.con("coincident", &["p", "e"]);
    ok(&mut d);
    near(on_ellipse_residual(&d, "c", "m", "n", "p"), 0., T);

    // Fixing the point and moving the centre: the ellipse answers to the point.
    d.fix("p");
    let o = d.drag("c", 1., 3.);
    assert!(o.ok);
    near_p(d.p("c"), (1., 3.), T);
    near(on_ellipse_residual(&d, "c", "m", "n", "p"), 0., 1e-6);
}

#[test]
fn coincident_point_on_spline_outer_iteration() {
    let samples: Vec<[f64; 2]> = (0..=100)
        .map(|i| {
            let x = i as f64 * 0.2;
            [x, (x * 0.5).sin() * 5.0]
        })
        .collect();
    let mut d = Doc::new();
    d.pt("s0", 0., 0.)
        .pt("s1", 7., 5.)
        .pt("s2", 14., -2.)
        .pt("s3", 20., 0.);
    d.spline("s", &["s0", "s1", "s2", "s3"], 3, samples);
    d.pt("p", 9., 1.);
    d.con("coincident", &["p", "s"]);
    ok(&mut d);
    let (x, y) = d.p("p");
    near(y, (x * 0.5).sin() * 5.0, 1e-3);
    // One way: the spline's own points don't move.
    near_p(d.p("s1"), (7., 5.), 1e-12);
}

#[test]
fn horizontal_and_vertical_line() {
    let mut d = Doc::new();
    d.seg("h", (0., 0.), (10., 3.))
        .seg("v", (20., 0.), (23., 10.));
    d.con("horizontal", &["h"]);
    d.con("vertical", &["v"]);
    ok(&mut d);
    near(d.p("ha").1, d.p("hb").1, T);
    near(d.p("va").0, d.p("vb").0, T);
}

#[test]
fn horizontal_and_vertical_two_points() {
    let mut d = Doc::new();
    d.pt("a", 0., 0.).pt("b", 10., 3.).pt("c", 3., 20.);
    d.con("horizontal", &["a", "b"]);
    d.con("vertical", &["a", "c"]);
    ok(&mut d);
    near(d.p("a").1, d.p("b").1, T);
    near(d.p("a").0, d.p("c").0, T);
}

#[test]
fn vertical_to_origin_uses_reserved_point() {
    let mut d = Doc::new();
    d.pt("a", 5., 9.);
    d.con("vertical", &["origin", "a"]);
    ok(&mut d);
    near(d.p("a").0, 0., T);
    near(d.p("a").1, 9., 1e-3);
}

#[test]
fn parallel_lines_and_with_axis() {
    let mut d = Doc::new();
    d.seg("a", (0., 0.), (10., 1.))
        .seg("b", (0., 5.), (10., 8.))
        .seg("c", (0., 9.), (5., 10.));
    d.con("parallel", &["a", "b"]);
    d.con("parallel", &["c", "axis-y"]);
    ok(&mut d);
    near(cross(d.p("aa"), d.p("ab"), d.p("ba"), d.p("bb")), 0., T);
    near(d.p("ca").0, d.p("cb").0, T);
}

#[test]
fn perpendicular_lines() {
    let mut d = Doc::new();
    d.seg("a", (0., 0.), (10., 1.))
        .seg("b", (0., 5.), (2., 15.));
    d.con("perpendicular", &["a", "b"]);
    ok(&mut d);
    near(dot(d.p("aa"), d.p("ab"), d.p("ba"), d.p("bb")), 0., T);
}

#[test]
fn perpendicular_line_circle_is_radial() {
    let mut d = Doc::new();
    d.seg("l", (0., 3.), (10., 4.))
        .pt("c", 5., -8.)
        .circle("k", "c", 3.);
    d.con("perpendicular", &["l", "k"]);
    ok(&mut d);
    near(side(d.p("c"), d.p("la"), d.p("lb")), 0., T);
}

#[test]
fn tangent_line_circle_keeps_side() {
    for (cy, sign) in [(6.0, 1.0), (-6.0, -1.0)] {
        let mut d = Doc::new();
        d.seg("l", (-10., 0.), (10., 0.))
            .pt("c", 0., cy)
            .circle("k", "c", 5.);
        d.con("tangent", &["l", "k"]);
        ok(&mut d);
        let s = side(d.p("c"), d.p("la"), d.p("lb"));
        near(s, sign * d.r("k"), T);
    }
}

#[test]
fn tangent_line_arc_free_contact() {
    let mut d = Doc::new();
    d.seg("l", (-10., 0.), (10., 0.));
    d.pt("c", 0., 7.)
        .pt("a", 5., 7.)
        .pt("b", 0., 12.)
        .arc("r", "c", "a", "b");
    d.con("tangent", &["l", "r"]);
    ok(&mut d);
    near(
        side(d.p("c"), d.p("la"), d.p("lb")).abs(),
        d.dist("c", "a"),
        T,
    );
    near(d.dist("c", "a"), d.dist("c", "b"), T);
}

#[test]
fn tangent_line_arc_at_shared_end_point() {
    let mut d = Doc::new();
    d.pt("p", 0., 0.).pt("q", 10., 1.).line("l", "p", "q");
    d.pt("c", 12., 8.).pt("e", 20., 8.);
    // End of the line is the start of the arc.
    d.pt("s", 10.5, 1.5).arc("r", "c", "s", "e");
    d.con("coincident", &["q", "s"]);
    d.con("tangent", &["l", "r"]);
    let o = d.analyze();
    assert!(o.ok, "{o:?}");
    near(dot(d.p("p"), d.p("q"), d.p("c"), d.p("q")), 0., T);
    near(d.dist("c", "q"), d.dist("c", "e"), T);
    // line 4 vars, arc c/e 4, r 1 minus 2 radius rows minus tangent: 6 dof. A double-root
    // formulation reports 7 here.
    assert_eq!(o.dof, Some(6));
}

#[test]
fn tangent_circle_circle_external_and_internal() {
    let mut d = Doc::new();
    d.pt("c1", 0., 0.)
        .circle("a", "c1", 5.)
        .pt("c2", 9., 0.)
        .circle("b", "c2", 3.);
    d.con("tangent", &["a", "b"]);
    ok(&mut d);
    near(d.dist("c1", "c2"), d.r("a") + d.r("b"), T);

    let mut d = Doc::new();
    d.pt("c1", 0., 0.)
        .circle("a", "c1", 10.)
        .pt("c2", 6., 0.)
        .circle("b", "c2", 3.);
    d.con("tangent", &["a", "b"]);
    ok(&mut d);
    near(d.dist("c1", "c2"), (d.r("a") - d.r("b")).abs(), T);
}

#[test]
fn tangent_circle_circle_variant_forces_kind() {
    let mut d = Doc::new();
    d.pt("c1", 0., 0.)
        .circle("a", "c1", 10.)
        .pt("c2", 12., 0.)
        .circle("b", "c2", 3.);
    d.conv("tangent", &["a", "b"], 1);
    ok(&mut d);
    near(d.dist("c1", "c2"), (d.r("a") - d.r("b")).abs(), T);
}

#[test]
fn tangent_arc_arc_at_shared_point() {
    let mut d = Doc::new();
    d.pt("c1", 0., 0.)
        .pt("a", 10., 0.)
        .pt("j", 0., 10.)
        .arc("r", "c1", "a", "j");
    d.pt("c2", 1., 16.)
        .pt("j2", 0.5, 10.5)
        .pt("b", 1., 22.)
        .arc("s", "c2", "j2", "b");
    d.con("coincident", &["j", "j2"]);
    d.con("tangent", &["r", "s"]);
    let o = d.analyze();
    assert!(o.ok, "{o:?}");
    near(cross(d.p("c1"), d.p("j"), d.p("c2"), d.p("j")), 0., 1e-5);
    near(d.dist("c1", "c2"), d.dist("c1", "j") + d.dist("c2", "j"), T);
    // Arcs 5 dof each, minus 2 for the shared point, minus 1 for tangency.
    assert_eq!(o.dof, Some(7));
}

#[test]
fn tangent_arc_arc_no_shared_point() {
    let mut d = Doc::new();
    d.pt("c1", 0., 0.)
        .pt("a", 5., 0.)
        .pt("b", 0., 5.)
        .arc("r", "c1", "a", "b");
    d.pt("c2", 9., 0.)
        .pt("e", 12., 0.)
        .pt("f", 9., 3.)
        .arc("s", "c2", "e", "f");
    d.con("tangent", &["r", "s"]);
    ok(&mut d);
    near(d.dist("c1", "c2"), d.dist("c1", "a") + d.dist("c2", "e"), T);
}

#[test]
fn tangent_circle_arc() {
    let mut d = Doc::new();
    d.pt("c1", 0., 0.).circle("k", "c1", 5.);
    d.pt("c2", 9., 0.)
        .pt("e", 12., 0.)
        .pt("f", 9., 3.)
        .arc("s", "c2", "e", "f");
    d.con("tangent", &["s", "k"]);
    ok(&mut d);
    near(d.dist("c1", "c2"), d.r("k") + d.dist("c2", "e"), T);
}

#[test]
fn tangent_spline_line_at_shared_end() {
    let mut d = Doc::new();
    d.pt("a", -10., 0.).pt("j", 0., 0.).line("l", "a", "j");
    d.pt("s0", 0.5, 0.2)
        .pt("s1", 5., 3.)
        .pt("s2", 10., 3.)
        .pt("s3", 15., 0.);
    d.spline("s", &["s0", "s1", "s2", "s3"], 3, vec![]);
    d.con("coincident", &["j", "s0"]);
    d.con("tangent", &["s", "l"]);
    ok(&mut d);
    near_p(d.p("j"), d.p("s0"), T);
    near(cross(d.p("a"), d.p("j"), d.p("s0"), d.p("s1")), 0., 1e-4);
    assert!(
        dot(d.p("a"), d.p("j"), d.p("s0"), d.p("s1")) > 0.0,
        "leg must continue the line"
    );
}

#[test]
fn tangent_spline_line_end_chosen_by_variant() {
    let mut d = Doc::new();
    d.seg("l", (-10., -5.), (30., -5.));
    d.pt("s0", 0., 0.)
        .pt("s1", 5., 3.)
        .pt("s2", 10., 3.)
        .pt("s3", 15., 1.);
    d.spline("s", &["s0", "s1", "s2", "s3"], 3, vec![]);
    d.conv("tangent", &["s", "l"], 1);
    ok(&mut d);
    near(side(d.p("s3"), d.p("la"), d.p("lb")), 0., T);
    near(cross(d.p("la"), d.p("lb"), d.p("s3"), d.p("s2")), 0., 1e-4);
}

#[test]
fn tangent_spline_arc_at_shared_end() {
    let mut d = Doc::new();
    d.pt("c", 0., 0.)
        .pt("a", 0., 10.)
        .pt("j", 10., 0.)
        .arc("r", "c", "j", "a");
    d.pt("s0", 10.1, -0.1)
        .pt("s1", 12., -5.)
        .pt("s2", 15., -7.)
        .pt("s3", 20., -8.);
    d.spline("s", &["s0", "s1", "s2", "s3"], 3, vec![]);
    d.con("coincident", &["j", "s0"]);
    d.con("tangent", &["s", "r"]);
    ok(&mut d);
    near(dot(d.p("s0"), d.p("s1"), d.p("c"), d.p("s0")), 0., 1e-5);
}

#[test]
fn tangent_spline_spline_at_shared_end() {
    let mut d = Doc::new();
    d.pt("a0", 0., 0.)
        .pt("a1", 3., 4.)
        .pt("a2", 6., 4.)
        .pt("a3", 10., 0.);
    d.pt("b0", 10., 0.1)
        .pt("b1", 13., -3.5)
        .pt("b2", 16., 0.)
        .pt("b3", 20., 0.);
    d.spline("s", &["a0", "a1", "a2", "a3"], 3, vec![]);
    d.spline("t", &["b0", "b1", "b2", "b3"], 3, vec![]);
    d.con("coincident", &["a3", "b0"]);
    d.conv("tangent", &["s", "t"], 1);
    ok(&mut d);
    near(cross(d.p("a2"), d.p("a3"), d.p("b0"), d.p("b1")), 0., 1e-4);
    assert!(
        dot(d.p("a2"), d.p("a3"), d.p("b0"), d.p("b1")) > 0.0,
        "no cusp"
    );
}

#[test]
fn tangent_fit_spline_with_handle_drives_spline() {
    let mut d = Doc::new();
    d.pt("a", -10., 1.).pt("j", 0., 0.).line("l", "a", "j");
    d.pt("s0", 0., 0.)
        .pt("h", 2., 4.)
        .pt("s1", 5., 3.)
        .pt("s2", 10., 0.);
    d.fit("s", &["s0", "s1", "s2"], &[Some("h"), None, None], vec![]);
    d.con("coincident", &["j", "s0"]);
    d.con("tangent", &["l", "s"]);
    d.con("horizontal", &["l"]);
    ok(&mut d);
    near(cross(d.p("a"), d.p("j"), d.p("s0"), d.p("h")), 0., 1e-4);
}

#[test]
fn tangent_fit_spline_without_handle_is_one_way() {
    let samples = vec![[0., 0.], [1., 1.], [2., 2.], [3., 2.5]];
    let mut d = Doc::new();
    d.pt("a", -10., 1.).pt("j", 0., 0.).line("l", "a", "j");
    d.pt("s0", 0., 0.).pt("s1", 5., 3.);
    d.fit("s", &["s0", "s1"], &[None, None], samples);
    d.con("coincident", &["j", "s0"]);
    d.con("tangent", &["l", "s"]);
    ok(&mut d);
    // The line turned to match the spline's 45 degree start; the spline was not touched.
    near(cross(d.p("a"), d.p("j"), (0., 0.), (1., 1.)), 0., 1e-4);
    near_p(d.p("s1"), (5., 3.), 1e-9);
}

#[test]
fn tangent_line_ellipse() {
    for (c, mx, my, nx, ny, a, b) in [
        ((0., 0.), 20., 0., 0., 10., (-30., 12.), (30., 13.)),
        ((5., 3.), 14.14, 14.14, -7.07, 7.07, (-30., 30.), (30., 30.)),
        ((0., 0.), 20., 0., 0., 10., (22., -20.), (23., 20.)),
    ] {
        let mut d = Doc::new();
        d.pt("c", c.0, c.1)
            .pt("m", c.0 + mx, c.1 + my)
            .pt("n", c.0 + nx, c.1 + ny);
        d.ellipse("e", "c", "m", "n");
        d.seg("l", a, b);
        d.con("tangent", &["l", "e"]);
        ok(&mut d);
        near(
            ellipse_tangent_residual(&d, "c", "m", "n", "la", "lb"),
            0.,
            1e-6,
        );
    }
}

#[test]
fn tangent_circle_ellipse() {
    let mut d = Doc::new();
    d.pt("c", 0., 0.)
        .pt("m", 20., 0.)
        .pt("n", 0., 10.)
        .ellipse("e", "c", "m", "n");
    d.pt("q", 30., 8.).circle("k", "q", 9.);
    d.con("tangent", &["k", "e"]);
    let o = d.analyze();
    assert!(o.ok, "{o:?}");
    // Distance from the circle centre to the ellipse, by dense sampling, equals the radius.
    let (qp, r, c, m, n) = (d.p("q"), d.r("k"), d.p("c"), d.p("m"), d.p("n"));
    let best = (0..200000)
        .map(|i| {
            let t = i as f64 / 200000.0 * 2.0 * PI;
            let x = c.0 + (m.0 - c.0) * t.cos() + (n.0 - c.0) * t.sin();
            let y = c.1 + (m.1 - c.1) * t.cos() + (n.1 - c.1) * t.sin();
            (x - qp.0).hypot(y - qp.1)
        })
        .fold(f64::INFINITY, f64::min);
    near(best, r, 1e-4);
}

#[test]
fn tangent_is_one_dof_on_ellipse() {
    let mut d = Doc::new();
    d.pt("c", 0., 0.)
        .pt("m", 20., 0.)
        .pt("n", 0., 10.)
        .ellipse("e", "c", "m", "n");
    d.seg("l", (-30., 12.), (30., 13.));
    d.con("tangent", &["l", "e"]);
    let o = d.analyze();
    assert!(o.ok, "{o:?}");
    assert_eq!(o.dof, Some(5 + 4 - 1));
}

#[test]
fn tangent_spline_ellipse() {
    let mut d = Doc::new();
    d.pt("c", 0., 0.)
        .pt("m", 20., 0.)
        .pt("n", 0., 10.)
        .ellipse("e", "c", "m", "n");
    d.pt("s0", 21., 1.)
        .pt("s1", 22., 8.)
        .pt("s2", 26., 10.)
        .pt("s3", 30., 10.);
    d.spline("s", &["s0", "s1", "s2", "s3"], 3, vec![]);
    d.con("tangent", &["s", "e"]);
    ok(&mut d);
    near(on_ellipse_residual(&d, "c", "m", "n", "s0"), 0., 1e-6);
    near(
        ellipse_tangent_residual(&d, "c", "m", "n", "s0", "s1"),
        0.,
        1e-6,
    );
}

#[test]
fn tangent_ellipse_ellipse() {
    let mut d = Doc::new();
    d.pt("c", 0., 0.)
        .pt("m", 20., 0.)
        .pt("n", 0., 10.)
        .ellipse("e", "c", "m", "n");
    d.pt("c2", 32., 0.)
        .pt("m2", 42., 0.)
        .pt("n2", 32., 5.)
        .ellipse("f", "c2", "m2", "n2");
    d.con("tangent", &["e", "f"]);
    let o = d.analyze();
    assert!(o.ok, "{o:?}");
    assert_eq!(o.dof, Some(9));
    // Along the X axis the two touch at a vertex, and they keep their size to do it.
    near(
        (d.p("c2").0 - d.dist("c2", "m2")) - (d.p("c").0 + d.dist("c", "m")),
        0.,
        1.0,
    );
    near(d.dist("c", "m"), 20., T);
    near(d.dist("c", "n"), 10., T);
    near(d.dist("c2", "m2"), 10., T);
    near(d.dist("c2", "n2"), 5., T);
}

#[test]
fn equal_lines() {
    let mut d = Doc::new();
    d.seg("a", (0., 0.), (10., 0.))
        .seg("b", (0., 5.), (0., 12.));
    d.con("equal", &["a", "b"]);
    ok(&mut d);
    near(d.dist("aa", "ab"), d.dist("ba", "bb"), T);
}

#[test]
fn equal_circle_arc() {
    let mut d = Doc::new();
    d.pt("c", 0., 0.).circle("k", "c", 4.);
    d.pt("c2", 20., 0.)
        .pt("a", 30., 0.)
        .pt("b", 20., 10.)
        .arc("r", "c2", "a", "b");
    d.con("equal", &["k", "r"]);
    ok(&mut d);
    near(d.r("k"), d.dist("c2", "a"), T);
    near(d.dist("c2", "b"), d.dist("c2", "a"), T);
}

#[test]
fn midpoint_line_and_arc() {
    let mut d = Doc::new();
    d.seg("l", (0., 0.), (10., 4.)).pt("m", 3., 9.);
    d.con("midpoint", &["m", "l"]);
    d.pt("c", 30., 0.)
        .pt("a", 40., 0.)
        .pt("b", 30., 10.)
        .arc("r", "c", "a", "b")
        .pt("q", 31., 1.);
    d.con("midpoint", &["q", "r"]);
    ok(&mut d);
    let (a, b, m) = (d.p("la"), d.p("lb"), d.p("m"));
    near_p(m, ((a.0 + b.0) / 2., (a.1 + b.1) / 2.), T);
    near(d.dist("c", "q"), d.dist("c", "a"), T);
    near(d.dist("a", "q"), d.dist("b", "q"), T);
    let (c, q) = (d.p("c"), d.p("q"));
    assert!(
        q.0 > c.0 && q.1 > c.1,
        "midpoint must be inside the sweep, {q:?}"
    );
}

#[test]
fn midpoint_arc_seeded_from_outside_the_sweep() {
    let mut d = Doc::new();
    d.pt("c", 0., 0.)
        .pt("a", 10., 0.)
        .pt("b", 0., 10.)
        .arc("r", "c", "a", "b")
        .pt("q", -7., -7.);
    d.con("midpoint", &["q", "r"]);
    ok(&mut d);
    let q = d.p("q");
    assert!(q.0 > 0. && q.1 > 0., "{q:?}");
}

#[test]
fn concentric_circles_arcs_ellipses() {
    let mut d = Doc::new();
    d.pt("c1", 0., 0.)
        .circle("k", "c1", 4.)
        .pt("c2", 3., 3.)
        .circle("q", "c2", 9.);
    d.pt("c3", 7., 1.)
        .pt("a", 12., 1.)
        .pt("b", 7., 6.)
        .arc("r", "c3", "a", "b");
    d.pt("c4", -4., 2.)
        .pt("m", 8., 2.)
        .pt("n", -4., 8.)
        .ellipse("e", "c4", "m", "n");
    d.con("concentric", &["k", "q"]);
    d.con("concentric", &["k", "r"]);
    d.con("concentric", &["k", "e"]);
    ok(&mut d);
    for c in ["c2", "c3", "c4"] {
        near_p(d.p("c1"), d.p(c), T);
    }
    near(d.dist("c3", "a"), d.dist("c3", "b"), T);
    near(dot(d.p("c4"), d.p("m"), d.p("c4"), d.p("n")), 0., 1e-5);
}

#[test]
fn collinear_lines_and_shared_end() {
    let mut d = Doc::new();
    d.seg("a", (0., 0.), (10., 1.))
        .seg("b", (15., 3.), (22., 2.));
    d.con("collinear", &["a", "b"]);
    ok(&mut d);
    near(side(d.p("ba"), d.p("aa"), d.p("ab")), 0., T);
    near(side(d.p("bb"), d.p("aa"), d.p("ab")), 0., T);

    let mut d = Doc::new();
    d.pt("p", 0., 0.)
        .pt("q", 10., 0.)
        .pt("r", 20., 3.)
        .line("a", "p", "q")
        .line("b", "q", "r");
    d.con("collinear", &["a", "b"]);
    let o = d.analyze();
    assert!(o.ok);
    near(side(d.p("r"), d.p("p"), d.p("q")), 0., T);
    assert_eq!(o.dof, Some(5));
}

#[test]
fn symmetric_points_across_line_and_axis() {
    let mut d = Doc::new();
    d.seg("l", (0., 0.), (10., 10.))
        .pt("a", 2., 7.)
        .pt("b", 8., 1.);
    d.con("symmetric", &["a", "b", "l"]);
    d.pt("p", 3., 5.).pt("q", -2., 4.);
    d.con("symmetric", &["p", "q", "axis-y"]);
    ok(&mut d);
    let (a, b, p0, p1) = (d.p("a"), d.p("b"), d.p("la"), d.p("lb"));
    near(side(((a.0 + b.0) / 2., (a.1 + b.1) / 2.), p0, p1), 0., T);
    near(dot(a, b, p0, p1), 0., 1e-4);
    near(d.p("p").0, -d.p("q").0, T);
    near(d.p("p").1, d.p("q").1, T);
}

#[test]
fn symmetric_curves_match_end_points_by_geometry() {
    let mut d = Doc::new();
    // Second line is drawn the opposite way round: pairing must be a<->qb.
    d.pt("a", -5., 2.).pt("b", -9., 8.).line("l", "a", "b");
    d.pt("qa", 8., 7.).pt("qb", 6., 3.).line("m", "qa", "qb");
    d.con("symmetric", &["l", "m", "axis-y"]);
    d.pt("c", -5., 12.)
        .circle("k", "c", 3.)
        .pt("c2", 5., 12.)
        .circle("q", "c2", 2.);
    d.con("symmetric", &["k", "q", "axis-y"]);
    d.pt("c3", -5., -10.)
        .pt("sa", -9., -10.)
        .pt("sb", -5., -14.)
        .arc("r", "c3", "sb", "sa");
    d.pt("c4", 5., -10.)
        .pt("ta", 5., -14.)
        .pt("tb", 9., -10.)
        .arc("s", "c4", "ta", "tb");
    d.con("symmetric", &["r", "s", "axis-y"]);
    ok(&mut d);
    near(d.p("a").0, -d.p("qb").0, T);
    near(d.p("a").1, d.p("qb").1, T);
    near(d.r("k"), d.r("q"), T);
    near(d.p("sa").0, -d.p("tb").0, T);
    near(d.p("sb").0, -d.p("ta").0, T);
}

#[test]
fn curvature_with_line_makes_first_three_control_points_collinear() {
    let mut d = Doc::new();
    d.pt("a", -10., 0.).pt("j", 0., 0.).line("l", "a", "j");
    d.pt("s0", 0., 0.)
        .pt("s1", 4., 2.)
        .pt("s2", 8., 3.)
        .pt("s3", 14., 9.);
    d.spline("s", &["s0", "s1", "s2", "s3"], 3, vec![]);
    d.con("coincident", &["j", "s0"]);
    d.con("curvature", &["s", "l"]);
    ok(&mut d);
    near(side(d.p("s1"), d.p("a"), d.p("j")), 0., T);
    near(side(d.p("s2"), d.p("a"), d.p("j")), 0., T);
}

/// Curvature at the start of a clamped uniform cubic B-spline, from its derivatives.
fn start_curvature(p: [(f64, f64); 5]) -> f64 {
    let k = 1.0;
    let d = 3.0;
    let c1 = ((p[1].0 - p[0].0) * d / k, (p[1].1 - p[0].1) * d / k);
    let a = (
        (p[2].0 - p[1].0) / (2.0 * k) - (p[1].0 - p[0].0) / k,
        (p[2].1 - p[1].1) / (2.0 * k) - (p[1].1 - p[0].1) / k,
    );
    let c2 = (a.0 * d * (d - 1.0) / k, a.1 * d * (d - 1.0) / k);
    (c1.0 * c2.1 - c1.1 * c2.0).abs() / c1.0.hypot(c1.1).powi(3)
}

#[test]
fn curvature_with_arc_matches_by_outer_iteration() {
    let mut d = Doc::new();
    d.pt("c", 0., 0.)
        .pt("a", 0., 20.)
        .pt("j", 20., 0.)
        .arc("r", "c", "j", "a");
    d.pt("s0", 20., 0.)
        .pt("s1", 20., -6.)
        .pt("s2", 18., -12.)
        .pt("s3", 14., -18.)
        .pt("s4", 8., -22.);
    d.spline("s", &["s0", "s1", "s2", "s3", "s4"], 3, vec![]);
    d.con("coincident", &["j", "s0"]);
    d.con("curvature", &["s", "r"]);
    d.dim("radius", &["r"], 20.);
    let o = d.solve();
    assert!(o.ok, "{o:?}");
    let k = start_curvature([d.p("s0"), d.p("s1"), d.p("s2"), d.p("s3"), d.p("s4")]);
    near(k, 1.0 / 20.0, 1e-5);
    // Tangency comes with it.
    near(dot(d.p("s0"), d.p("s1"), d.p("c"), d.p("s0")), 0., 1e-4);
}

#[test]
fn offset_copy_and_with_reserved_origin() {
    let mut d = Doc::new();
    d.pt("p", 1., 2.).pt("q", 4., 4.);
    d.offset("p", "q", 10., -5.);
    ok(&mut d);
    let (p, q) = (d.p("p"), d.p("q"));
    near(q.0 - p.0, 10., T);
    near(q.1 - p.1, -5., T);

    let mut d = Doc::new();
    d.pt("q", 4., 4.);
    d.offset("origin", "q", 3., 7.);
    ok(&mut d);
    near_p(d.p("q"), (3., 7.), T);
}

#[test]
fn rotated_copy() {
    let mut d = Doc::new();
    d.pt("c", 1., 1.).pt("p", 11., 1.).pt("q", 2., 12.);
    d.rotated("c", "p", "q", FRAC_PI_2);
    d.fix("c").fix("p");
    ok(&mut d);
    near_p(d.p("q"), (1., 11.), T);
}

#[test]
fn rotated_copy_negative_angle_about_origin() {
    let mut d = Doc::new();
    d.pt("p", 10., 0.).pt("q", 6., -5.);
    d.fix("p");
    d.rotated("origin", "p", "q", -FRAC_PI_4);
    ok(&mut d);
    let s = FRAC_PI_4.cos() * 10.;
    near_p(d.p("q"), (s, -s), T);
}

#[test]
fn fixed_point_never_moves() {
    let mut d = Doc::new();
    d.pt("a", 0., 0.).pt("b", 10., 2.).line("l", "a", "b");
    d.fix("a");
    d.con("horizontal", &["l"]);
    d.dim("distance", &["a", "b"], 20.);
    ok(&mut d);
    near_p(d.p("a"), (0., 0.), 1e-12);
    near_p(d.p("b"), (20., 0.), T);
}

#[test]
fn fixed_curve_locks_points_and_radius() {
    use sketch_solver::api::CurveIn;
    let mut d = Doc::new();
    d.pt("c", 0., 0.)
        .circle("k", "c", 5.)
        .pt("q", 20., 0.)
        .circle("m", "q", 7.);
    if let CurveIn::Circle { fixed, .. } = &mut d.input.curves[0] {
        *fixed = true;
    }
    d.con("equal", &["k", "m"]);
    ok(&mut d);
    near(d.r("k"), 5., 1e-12);
    near(d.r("m"), 5., T);
}

#[test]
fn text_frame_stays_a_rectangle() {
    use sketch_solver::api::CurveIn;
    let mut d = Doc::new();
    d.pt("a", 0., 0.)
        .pt("b", 10., 0.)
        .pt("c", 10., 5.)
        .pt("e", 0., 5.);
    d.input.curves.push(CurveIn::Frame {
        id: "t".into(),
        pts: ["a", "b", "c", "e"].map(String::from).to_vec(),
        fixed: false,
    });
    let o = d.analyze();
    assert_eq!(o.dof, Some(5));
    let o = d.drag("b", 12., 4.);
    assert!(o.ok);
    near(dot(d.p("a"), d.p("b"), d.p("a"), d.p("e")), 0., 1e-5);
    near(cross(d.p("a"), d.p("b"), d.p("e"), d.p("c")), 0., 1e-5);
}

#[test]
fn elliptical_arc_ends_stay_on_the_ellipse() {
    use sketch_solver::api::CurveIn;
    let mut d = Doc::new();
    d.pt("c", 0., 0.)
        .pt("m", 20., 0.)
        .pt("n", 0., 10.)
        .pt("a", 20., 0.5)
        .pt("b", 0.5, 10.);
    d.input.curves.push(CurveIn::EllipticalArc {
        id: "e".into(),
        c: "c".into(),
        major: "m".into(),
        minor: "n".into(),
        a: "a".into(),
        b: "b".into(),
        fixed: false,
    });
    let o = d.analyze();
    assert!(o.ok, "{o:?}");
    near(on_ellipse_residual(&d, "c", "m", "n", "a"), 0., 1e-6);
    near(on_ellipse_residual(&d, "c", "m", "n", "b"), 0., 1e-6);
    assert_eq!(o.dof, Some(7));
}

#[test]
fn reserved_ids_need_no_declaration() {
    let mut d = Doc::new();
    d.seg("l", (1., 1.), (9., 3.));
    d.con("coincident", &["la", "origin"]);
    d.con("collinear", &["l", "axis-x"]);
    d.con("perpendicular", &["l", "axis-y"]);
    let o = d.solve();
    // Collinear with the X axis also implies perpendicular to Y; the duplicate must not conflict.
    assert!(o.ok, "{o:?}");
    near(d.p("lb").1, 0., T);
}

#[test]
fn degenerate_input_never_panics() {
    use sketch_solver::solve::solve;
    // Zero-length lines, zero radii and coincident centres through every row type.
    let mut d = Doc::new();
    d.pt("a", 5., 5.).pt("b", 5., 5.).line("l", "a", "b");
    d.pt("p", 5., 5.).pt("q", 5., 5.).line("m", "p", "q");
    d.pt("c", 5., 5.).circle("k", "c", 0.);
    d.pt("x", 5., 5.)
        .pt("y", 5., 5.)
        .pt("z", 5., 5.)
        .arc("r", "x", "y", "z");
    d.pt("e", 5., 5.)
        .pt("f", 5., 5.)
        .pt("g", 5., 5.)
        .ellipse("el", "e", "f", "g");
    d.pt("s0", 5., 5.).pt("s1", 5., 5.).pt("s2", 5., 5.).spline(
        "s",
        &["s0", "s1", "s2"],
        3,
        vec![],
    );
    for t in ["parallel", "perpendicular", "collinear", "equal", "tangent"] {
        d.con(t, &["l", "m"]);
    }
    for (a, b) in [
        ("l", "k"),
        ("l", "r"),
        ("k", "r"),
        ("l", "el"),
        ("k", "el"),
        ("l", "s"),
        ("k", "s"),
        ("el", "s"),
    ] {
        d.con("tangent", &[a, b]);
    }
    d.con("midpoint", &["q", "r"]);
    d.con("midpoint", &["q", "l"]);
    d.con("symmetric", &["a", "p", "l"]);
    d.con("symmetric", &["l", "m", "m"]);
    d.con("curvature", &["s", "l"]);
    d.con("curvature", &["s", "r"]);
    d.rotated("c", "c", "x", 1.0);
    for (k, r) in [
        ("distance", vec!["a", "b"]),
        ("angle", vec!["l", "m"]),
        ("arcLength", vec!["r"]),
        ("pointLine", vec!["p", "l"]),
    ] {
        d.dim(k, &r, 5.0);
    }
    d.input.analyze = true;
    let _ = solve(&d.input);
    d.input.analyze = false;
    d.input.drag = vec![sketch_solver::api::DragIn {
        point: "a".into(),
        x: 9.,
        y: 9.,
    }];
    let _ = solve(&d.input);
}

#[test]
fn malformed_input_reports_an_error() {
    let o = sketch_solver::solve::solve(&{
        let mut d = Doc::new();
        d.pt("a", f64::NAN, 0.);
        d.input
    });
    assert!(!o.ok && o.error.is_some());
    let out = sketch_solver::solve("{ not json");
    assert!(out.contains("\"ok\":false"), "{out}");
    let mut d = Doc::new();
    d.pt("a", 0., 0.).line("l", "a", "missing");
    let o = sketch_solver::solve::solve(&d.input);
    assert!(!o.ok && o.error.is_some());
}
