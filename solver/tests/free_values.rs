//! A value the constraints leave free stays where it was when something else in the sketch is
//! edited. Every row shares its residual among all its variables, so without `undisturbed` a
//! dimension on one edge of a rectangle changes its height and the radius of a circle whose rim
//! point happens to be on the diagonal.
mod common;
use common::*;

const T: f64 = 1e-6;

/// A Center Rectangle as the tool builds it: edges, both diagonals, centre on the origin. 120 x 124.
fn rectangle(d: &mut Doc) {
    d.pt("sw", -60., -62.)
        .pt("se", 60., -62.)
        .pt("ne", 60., 62.)
        .pt("nw", -60., 62.)
        .pt("mid", 0., 0.);
    d.line("bottom", "sw", "se")
        .line("right", "se", "ne")
        .line("top", "ne", "nw")
        .line("left", "nw", "sw")
        .line("diagonal", "sw", "ne")
        .line("other", "se", "nw");
    d.con("midpoint", &["mid", "diagonal"]);
    d.con("midpoint", &["mid", "other"]);
    d.con("coincident", &["origin", "mid"]);
    d.con("horizontal", &["bottom"]);
    d.con("horizontal", &["top"]);
    d.con("vertical", &["left"]);
    d.con("vertical", &["right"]);
}

/// The point of the diagonal `s` from the origin, in the rectangle as drawn.
fn along(s: f64) -> (f64, f64) {
    let n = 60f64.hypot(62.);
    (s * 60. / n, s * 62. / n)
}

/// A circle about `centre` with a rim point on the diagonal, which is what a click near the
/// diagonal leaves behind.
fn circle_on_diagonal(d: &mut Doc, id: &str, centre: &str, r: f64) {
    let rim = format!("{id}-rim");
    let c = d.p(centre);
    let n = 60f64.hypot(62.);
    let u = (60. / n, 62. / n);
    let foot = c.0 * u.0 + c.1 * u.1;
    let off = (c.0 - foot * u.0).hypot(c.1 - foot * u.1);
    let (x, y) = along(foot + (r * r - off * off).sqrt());
    d.pt(&rim, x, y).circle(id, centre, r);
    d.con("coincident", &[&rim, "diagonal"]);
    d.con("coincident", &[&rim, id]);
}

fn centred_circle(d: &mut Doc, id: &str, r: f64) {
    let centre = format!("{id}-centre");
    d.pt(&centre, 0., 0.);
    d.con("coincident", &["origin", &centre]);
    circle_on_diagonal(d, id, &centre, r);
}

fn on_line(d: &Doc, p: &str, a: &str, b: &str) {
    near(side(d.p(p), d.p(a), d.p(b)), 0., T);
}

#[test]
fn a_width_dimension_leaves_a_circle_on_the_diagonal_alone() {
    // 70 is the outlet tutorial's step. The rest are the same step at sizes up to ten times over.
    for width in [70., 120.12, 30., 12., 240., 1200.] {
        let mut d = Doc::new();
        rectangle(&mut d);
        centred_circle(&mut d, "hole", 9.898165);
        d.dim("distance", &["ne", "nw"], width);
        assert!(d.solve().ok, "width {width}");
        near(d.r("hole"), 9.898165, T);
        near(d.dist("se", "ne"), 124., T);
        near(d.dist("ne", "nw"), width, T);
        // The point on both curves had to move for that, and it is still on both.
        on_line(&d, "hole-rim", "sw", "ne");
        near(d.dist("hole-centre", "hole-rim"), 9.898165, T);
    }
}

#[test]
fn it_holds_at_any_scale() {
    for scale in [0.1, 0.01, 0.001] {
        let mut d = Doc::new();
        rectangle(&mut d);
        centred_circle(&mut d, "hole", 9.898165);
        for p in &mut d.input.points {
            p.x *= scale;
            p.y *= scale;
        }
        let r = 9.898165 * scale;
        d.input.curves.iter_mut().for_each(|c| {
            if let sketch_solver::api::CurveIn::Circle { r: v, .. } = c {
                *v = r;
            }
        });
        d.dim("distance", &["ne", "nw"], 12. * scale);
        assert!(d.solve().ok, "scale {scale}");
        near(d.r("hole"), r, T * scale);
    }
}

#[test]
fn several_circles_keep_their_own_radii_and_a_free_centre_stays() {
    let mut d = Doc::new();
    rectangle(&mut d);
    centred_circle(&mut d, "a", 9.898165);
    centred_circle(&mut d, "b", 20.);
    d.pt("c-centre", 20., -30.);
    circle_on_diagonal(&mut d, "c", "c-centre", 45.);
    d.dim("distance", &["ne", "nw"], 70.);
    assert!(d.solve().ok);
    near(d.r("a"), 9.898165, T);
    near(d.r("b"), 20., T);
    near(d.r("c"), 45., T);
    near_p(d.p("c-centre"), (20., -30.), T);
    near(d.dist("se", "ne"), 124., T);
}

#[test]
fn a_free_arc_with_a_point_on_the_diagonal_stays() {
    let (a, b, c) = ((22., 42.), (22., 16.), (0., 29.));
    let r = 22f64.hypot(13.);
    for width in [70., 12.] {
        let mut d = Doc::new();
        rectangle(&mut d);
        d.pt("c", c.0, c.1).pt("a", a.0, a.1).pt("b", b.0, b.1);
        d.arc("arc", "c", "b", "a");
        // Where the diagonal crosses the arc.
        let n = 60f64.hypot(62.);
        let along_c = 29. * 62. / n;
        d.pt("rim", 0., 0.);
        let s = along_c + (r * r - 29. * 29. + along_c * along_c).sqrt();
        let (x, y) = along(s);
        d.input.points.last_mut().unwrap().x = x;
        d.input.points.last_mut().unwrap().y = y;
        d.con("coincident", &["rim", "diagonal"]);
        d.con("coincident", &["rim", "arc"]);
        d.dim("distance", &["ne", "nw"], width);
        assert!(d.solve().ok, "width {width}");
        near_p(d.p("c"), c, T);
        near_p(d.p("a"), a, T);
        near_p(d.p("b"), b, T);
        near(d.dist("c", "rim"), r, T);
        near(d.dist("se", "ne"), 124., T);
    }
}

#[test]
fn a_line_that_follows_keeps_its_length_and_the_rectangle_keeps_its_height() {
    for (constraint, width) in [
        ("parallel", 70.),
        ("parallel", 12.),
        ("collinear", 70.),
        ("collinear", 12.),
    ] {
        let mut d = Doc::new();
        rectangle(&mut d);
        let ((ax, ay), (bx, by)) = (along(20.), along(60.));
        d.pt("a", ax, ay).pt("b", bx, by).line("free", "a", "b");
        d.con(constraint, &["diagonal", "free"]);
        d.dim("distance", &["ne", "nw"], width);
        assert!(d.solve().ok, "{constraint} {width}");
        near(d.dist("a", "b"), 40., T);
        near(d.dist("se", "ne"), 124., T);
        near(cross(d.p("sw"), d.p("ne"), d.p("a"), d.p("b")), 0., 1e-3);
    }
}

#[test]
fn a_line_with_both_ends_on_the_diagonal_keeps_its_length() {
    let mut d = Doc::new();
    rectangle(&mut d);
    let ((ax, ay), (bx, by)) = (along(20.), along(60.));
    d.pt("a", ax, ay).pt("b", bx, by).line("free", "a", "b");
    d.con("coincident", &["a", "diagonal"]);
    d.con("coincident", &["b", "diagonal"]);
    d.dim("distance", &["ne", "nw"], 12.);
    assert!(d.solve().ok);
    near(d.dist("a", "b"), 40., T);
    near(d.dist("se", "ne"), 124., T);
    on_line(&d, "a", "sw", "ne");
    on_line(&d, "b", "sw", "ne");
}

#[test]
fn a_dimension_on_a_line_hung_off_a_corner_moves_the_free_end_only() {
    let mut d = Doc::new();
    rectangle(&mut d);
    d.pt("end", 90., 80.).line("arm", "ne", "end");
    d.dim("distance", &["ne", "end"], 100.);
    assert!(d.solve().ok);
    near_p(d.p("ne"), (60., 62.), T);
    near(d.dist("ne", "end"), 100., T);
}

#[test]
fn a_tangent_circle_travels_with_the_edge_and_keeps_its_radius() {
    let mut d = Doc::new();
    rectangle(&mut d);
    d.pt("c", 10., 40.).circle("round", "c", 22.);
    d.con("tangent", &["top", "round"]);
    d.dim("distance", &["se", "ne"], 200.);
    assert!(d.solve().ok);
    near(d.r("round"), 22., T);
    near_p(d.p("c"), (10., 78.), T);
}

#[test]
fn a_fillet_keeps_its_radius_and_the_rest_its_height() {
    for width in [70., 110., 240.] {
        let mut d = Doc::new();
        d.pt("sw", 0., 0.)
            .pt("se", 120., 0.)
            .pt("e", 120., 70.)
            .pt("n", 110., 80.)
            .pt("nw", 0., 80.)
            .pt("sw2", 0., 0.)
            .pt("c", 110., 70.)
            .pt("arc-e", 120., 70.)
            .pt("arc-n", 110., 80.);
        d.line("bottom", "sw", "se")
            .line("right", "se", "e")
            .line("top", "n", "nw")
            .line("left", "nw", "sw2")
            .arc("fillet", "c", "arc-e", "arc-n");
        for (a, b) in [
            ("e", "arc-e"),
            ("n", "arc-n"),
            ("sw", "sw2"),
            ("origin", "sw"),
        ] {
            d.con("coincident", &[a, b]);
        }
        d.con("horizontal", &["bottom"]);
        d.con("horizontal", &["top"]);
        d.con("vertical", &["right"]);
        d.con("vertical", &["left"]);
        d.con("tangent", &["right", "fillet"]);
        d.con("tangent", &["top", "fillet"]);
        d.dim("distance", &["sw", "se"], width);
        assert!(d.solve().ok, "width {width}");
        near(d.dist("c", "arc-e"), 10., T);
        near(d.dist("sw", "nw"), 80., 1e-5);
    }
}

#[test]
fn what_the_constraints_set_still_changes() {
    // A dimension on the radius moves the rim point, and nothing else.
    let mut d = Doc::new();
    rectangle(&mut d);
    centred_circle(&mut d, "hole", 9.898165);
    d.dim("radius", &["hole"], 15.);
    assert!(d.solve().ok);
    near(d.r("hole"), 15., T);
    near(d.dist("se", "ne"), 124., T);
    near(d.dist("ne", "nw"), 120., T);

    // The dimension reaches another circle through Equal.
    let mut d = Doc::new();
    rectangle(&mut d);
    centred_circle(&mut d, "a", 20.);
    centred_circle(&mut d, "b", 20.);
    d.con("equal", &["a", "b"]);
    d.dim("radius", &["a"], 12.);
    assert!(d.solve().ok);
    near(d.r("a"), 12., T);
    near(d.r("b"), 12., T);

    // A fully defined rectangle goes where its dimensions put it.
    let mut d = Doc::new();
    rectangle(&mut d);
    d.dim("distance", &["ne", "nw"], 70.);
    d.dim("distance", &["se", "ne"], 114.);
    assert!(d.solve().ok);
    near_p(d.p("ne"), (35., 57.), T);
    near_p(d.p("sw"), (-35., -57.), T);
}

#[test]
fn a_size_that_cannot_stay_gives_way_and_the_others_hold() {
    // The ends go further apart than the arc's diameter, so its radius has to change. The circle
    // in the same component still has no reason to.
    let mut d = Doc::new();
    rectangle(&mut d);
    centred_circle(&mut d, "hole", 9.898165);
    d.pt("c", 0., 42.).pt("a", -60., 62.).pt("b", 60., 62.);
    d.arc("arc", "c", "b", "a");
    d.con("coincident", &["a", "nw"]);
    d.con("coincident", &["b", "ne"]);
    d.dim("distance", &["ne", "nw"], 140.);
    assert!(d.solve().ok);
    near(d.r("hole"), 9.898165, T);
    near(d.dist("ne", "nw"), 140., T);
    assert!(d.dist("c", "a") >= 70. - T);
    near(d.dist("c", "a"), d.dist("c", "b"), T);
}

#[test]
fn circles_tied_by_a_gap_share_the_change_and_a_third_stays() {
    let mut d = Doc::new();
    d.pt("c1", 0., 0.).pt("c2", 32., 0.);
    d.con("coincident", &["origin", "c1"]);
    d.con("horizontal", &["c1", "c2"]);
    d.circle("a", "c1", 20.).circle("b", "c2", 12.);
    d.conv("tangent", &["a", "b"], 0);
    // A third circle in the same component, through a line from the first.
    d.pt("rim", 0., 20.).pt("far", 100., 10.).pt("o", 80., 0.);
    d.con("coincident", &["rim", "a"]);
    d.line("spoke", "rim", "far").circle("e", "o", 10.);
    d.pt("touch", 80., 10.);
    d.con("coincident", &["touch", "e"]);
    d.con("coincident", &["touch", "spoke"]);
    d.dim("distance", &["c1", "c2"], 40.);
    assert!(d.solve().ok);
    near(d.dist("c1", "c2"), d.r("a") + d.r("b"), T);
    near(d.r("e"), 10., T);
}

#[test]
fn a_drag_is_left_to_the_minimum_norm_step() {
    // Nothing is held in a drag: the corner goes to the cursor and the rim point with the diagonal.
    // The drift is second order in the step, so at mouse-event size it is out of sight.
    let mut d = Doc::new();
    rectangle(&mut d);
    centred_circle(&mut d, "hole", 9.898165);
    for i in 1..=120 {
        let x = 60. - 25. * i as f64 / 120.;
        assert!(d.drag("ne", x, 62.).ok);
    }
    near_p(d.p("ne"), (35., 62.), T);
    near(d.r("hole"), 9.898165, 1e-4);
}
