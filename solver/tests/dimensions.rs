//! Every DimensionKind, verified by measuring the solved geometry.
mod common;
use common::*;
use std::f64::consts::{FRAC_PI_4, FRAC_PI_6, PI};

const T: f64 = 1e-6;

fn ok(d: &mut Doc) {
    let o = d.solve();
    assert!(o.ok, "{o:?}");
}

#[test]
fn distance_points_and_line_form() {
    let mut d = Doc::new();
    d.pt("a", 0., 0.).pt("b", 3., 4.);
    d.dim("distance", &["a", "b"], 25.4);
    d.seg("l", (20., 0.), (25., 5.));
    d.dim("distance", &["l"], 9.);
    ok(&mut d);
    near(d.dist("a", "b"), 25.4, T);
    near(d.dist("la", "lb"), 9., T);
}

#[test]
fn distance_to_reserved_origin() {
    let mut d = Doc::new();
    d.pt("a", 3., 4.);
    d.dim("distance", &["origin", "a"], 10.);
    ok(&mut d);
    near(d.p("a").0.hypot(d.p("a").1), 10., T);
}

#[test]
fn horizontal_and_vertical_keep_their_sign() {
    let mut d = Doc::new();
    d.pt("a", 0., 0.).pt("b", -3., -4.);
    d.dim("horizontal", &["a", "b"], 7.);
    d.dim("vertical", &["a", "b"], 11.);
    ok(&mut d);
    let (a, b) = (d.p("a"), d.p("b"));
    near(a.0 - b.0, 7., T);
    near(a.1 - b.1, 11., T);
}

#[test]
fn horizontal_variant_overrides_geometry() {
    let mut d = Doc::new();
    d.pt("a", 0., 0.).pt("b", -3., -4.);
    d.dimv("horizontal", &["a", "b"], 7., 0);
    ok(&mut d);
    near(d.p("b").0 - d.p("a").0, 7., T);
}

#[test]
fn point_line_either_side() {
    for (y, sign) in [(3.0, 1.0), (-3.0, -1.0)] {
        let mut d = Doc::new();
        d.seg("l", (0., 0.), (10., 0.)).pt("p", 5., y);
        d.fix("la").fix("lb");
        d.dim("pointLine", &["p", "l"], 12.);
        ok(&mut d);
        near(d.p("p").1, sign * 12., T);
    }
}

#[test]
fn point_line_on_axis() {
    let mut d = Doc::new();
    d.pt("p", 5., 3.);
    d.dim("pointLine", &["p", "axis-x"], 12.);
    d.pt("q", -5., 3.);
    d.dim("pointLine", &["q", "axis-y"], 2.);
    ok(&mut d);
    near(d.p("p").1, 12., T);
    near(d.p("q").0, -2., T);
}

#[test]
fn line_line_parallel_distance() {
    let mut d = Doc::new();
    d.seg("a", (0., 0.), (10., 0.))
        .seg("b", (0., 3.), (10., 3.));
    d.con("horizontal", &["a"]);
    d.con("parallel", &["a", "b"]);
    d.dim("lineLine", &["a", "b"], 11.);
    ok(&mut d);
    near((d.p("ba").1 - d.p("aa").1).abs(), 11., T);
    near((d.p("bb").1 - d.p("ab").1).abs(), 11., T);
}

#[test]
fn line_line_to_axis_moves_the_real_line() {
    let mut d = Doc::new();
    d.seg("a", (0., 5.), (10., 5.));
    d.con("horizontal", &["a"]);
    d.dim("lineLine", &["axis-x", "a"], 11.);
    ok(&mut d);
    near(d.p("aa").1, 11., T);
}

#[test]
fn angle_uses_current_sign() {
    for y in [4.0, -4.0] {
        let mut d = Doc::new();
        d.pt("o", 0., 0.).pt("a", 10., 0.).pt("b", 7., y);
        d.line("l", "o", "a").line("m", "o", "b");
        d.fix("o").fix("a");
        d.dim("angle", &["l", "m"], FRAC_PI_6);
        ok(&mut d);
        let b = d.p("b");
        near(b.1.atan2(b.0), FRAC_PI_6 * y.signum(), T);
    }
}

#[test]
fn angle_large_value_keeps_quadrant_and_variant_selects_supplement() {
    let mut d = Doc::new();
    d.pt("o", 0., 0.).pt("a", 10., 0.).pt("b", 7., 7.);
    d.line("l", "o", "a").line("m", "o", "b");
    d.fix("o").fix("a");
    let id = d.dim("angle", &["l", "m"], FRAC_PI_4);
    ok(&mut d);
    d.set_dim(&id, 2.5);
    ok(&mut d);
    let b = d.p("b");
    near(b.1.atan2(b.0), 2.5, T);

    let mut d = Doc::new();
    d.pt("o", 0., 0.).pt("a", 10., 0.).pt("b", 7., 7.);
    d.line("l", "o", "a").line("m", "o", "b");
    d.fix("o").fix("a");
    d.dimv("angle", &["l", "m"], FRAC_PI_4, 1 | 4);
    ok(&mut d);
    // Measured to the reversed second line, negative sense: the line sits at 135 degrees.
    let b = d.p("b");
    near(b.1.atan2(b.0), 3.0 * FRAC_PI_4, T);
}

#[test]
fn angle_with_axis() {
    let mut d = Doc::new();
    d.seg("l", (0., 0.), (10., 2.));
    d.dim("angle", &["axis-x", "l"], FRAC_PI_4);
    ok(&mut d);
    let (a, b) = (d.p("la"), d.p("lb"));
    near((b.1 - a.1).atan2(b.0 - a.0), FRAC_PI_4, T);
}

#[test]
fn radius_and_diameter_of_circle_and_arc() {
    let mut d = Doc::new();
    d.pt("c", 0., 0.)
        .circle("k", "c", 3.)
        .pt("c2", 0., 30.)
        .circle("q", "c2", 3.);
    d.dim("radius", &["k"], 5.);
    d.dim("diameter", &["q"], 12.);
    d.pt("c3", 50., 0.)
        .pt("a", 60., 0.)
        .pt("b", 50., 10.)
        .arc("r", "c3", "a", "b");
    d.dim("radius", &["r"], 17.);
    d.pt("c4", 90., 0.)
        .pt("e", 100., 0.)
        .pt("f", 90., 10.)
        .arc("s", "c4", "e", "f");
    d.dim("diameter", &["s"], 30.);
    ok(&mut d);
    near(d.r("k"), 5., T);
    near(d.r("q"), 6., T);
    near(d.dist("c3", "a"), 17., T);
    near(d.dist("c3", "b"), 17., T);
    near(d.dist("c4", "e"), 15., T);
}

#[test]
fn diameter_about_centerline() {
    let mut d = Doc::new();
    d.seg("l", (0., -20.), (0., 20.)).pt("p", 8., 3.);
    d.fix("la").fix("lb");
    d.dim("diameter", &["l", "p"], 40.);
    ok(&mut d);
    near(d.p("p").0.abs(), 20., T);
}

#[test]
fn arc_length() {
    let mut d = Doc::new();
    d.pt("c", 0., 0.)
        .pt("a", 10., 0.)
        .pt("b", 7., 7.)
        .arc("r", "c", "a", "b");
    d.fix("c").fix("a");
    d.dim("arcLength", &["r"], 10.0 * PI / 3.0);
    ok(&mut d);
    let b = d.p("b");
    near(b.1.atan2(b.0), PI / 3.0, 1e-5);
    near(d.dist("c", "b"), 10., T);
}

#[test]
fn ellipse_axes_are_semi_axis_lengths() {
    let mut d = Doc::new();
    d.pt("c", 0., 0.)
        .pt("m", 20., 0.)
        .pt("n", 0., 10.)
        .ellipse("e", "c", "m", "n");
    d.dimv("ellipseAxis", &["e"], 30., 0);
    d.dimv("ellipseAxis", &["e"], 12., 1);
    ok(&mut d);
    near(d.dist("c", "m"), 30., T);
    near(d.dist("c", "n"), 12., T);
    near(dot(d.p("c"), d.p("m"), d.p("c"), d.p("n")), 0., 1e-5);
}
