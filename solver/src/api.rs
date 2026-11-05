//! JSON contract of `solve(json) -> json` (docs/SPEC.md section 4).

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct Input {
    #[serde(default)]
    pub points: Vec<PointIn>,
    #[serde(default)]
    pub curves: Vec<CurveIn>,
    #[serde(default)]
    pub constraints: Vec<ConstraintIn>,
    #[serde(default)]
    pub dimensions: Vec<DimensionIn>,
    #[serde(default)]
    pub drag: Vec<DragIn>,
    #[serde(default)]
    pub hold: Vec<String>,
    #[serde(default)]
    pub analyze: bool,
    /// What must not jump in a solve. Empty for a drag.
    #[serde(default)]
    pub branches: Branches,
    /// How far a row may be from met and count as met, when asking what the geometry satisfies.
    #[serde(default)]
    pub slack: Option<f64>,
    /// Solve from the geometry as it stands, with nothing but the rows: no sizes or spans held.
    #[serde(default)]
    pub plain: bool,
    /// Lines of a closed profile, by their ends: each stays on the line it is on before it keeps its length.
    #[serde(default)]
    pub walls: Vec<[String; 2]>,
}

/// What must not jump in a solve: arcs by `[centre, a, b]`, closed loops by their corners.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct Branches {
    #[serde(default)]
    pub arcs: Vec<[String; 3]>,
    #[serde(default)]
    pub loops: Vec<Vec<String>>,
    /// The arc edges of each of `loops`, by the same index: a loop is its true outline, not its chords.
    #[serde(default)]
    pub bulges: Vec<Vec<Bulge>>,
}

/// An arc edge of a loop: from corner `at` to the next, about `c`.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct Bulge {
    pub at: usize,
    pub c: String,
    pub ccw: bool,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct PointIn {
    pub id: String,
    pub x: f64,
    pub y: f64,
    #[serde(default)]
    pub fixed: bool,
}

/// `fixed` locks every point and the radius of a curve (Fix, projected, and derived geometry).
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum CurveIn {
    Line {
        id: String,
        a: String,
        b: String,
        #[serde(default)]
        fixed: bool,
    },
    Circle {
        id: String,
        c: String,
        r: f64,
        #[serde(default)]
        fixed: bool,
    },
    Arc {
        id: String,
        c: String,
        a: String,
        b: String,
        #[serde(default)]
        fixed: bool,
    },
    Ellipse {
        id: String,
        c: String,
        major: String,
        minor: String,
        #[serde(default)]
        fixed: bool,
    },
    EllipticalArc {
        id: String,
        c: String,
        major: String,
        minor: String,
        a: String,
        b: String,
        #[serde(default)]
        fixed: bool,
    },
    Spline {
        id: String,
        pts: Vec<String>,
        #[serde(default = "default_degree")]
        degree: u32,
        #[serde(default)]
        fit: bool,
        #[serde(default)]
        closed: bool,
        #[serde(default)]
        handles: Vec<Option<String>>,
        #[serde(default)]
        samples: Vec<[f64; 2]>,
        /// Not a B-spline: legs are valid, and nothing in it is steered for curvature (conics).
        #[serde(default)]
        rational: bool,
        /// A conic's rho: with it, what its end's curvature is can be read.
        #[serde(default)]
        rho: Option<f64>,
        #[serde(default)]
        fixed: bool,
    },
    /// Text frame: four corners, ccw from bottom-left, kept a rectangle.
    Frame {
        id: String,
        pts: Vec<String>,
        #[serde(default)]
        fixed: bool,
    },
}

fn default_degree() -> u32 {
    3
}

impl CurveIn {
    pub fn id(&self) -> &str {
        match self {
            CurveIn::Line { id, .. }
            | CurveIn::Circle { id, .. }
            | CurveIn::Arc { id, .. }
            | CurveIn::Ellipse { id, .. }
            | CurveIn::EllipticalArc { id, .. }
            | CurveIn::Spline { id, .. }
            | CurveIn::Frame { id, .. } => id,
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct ConstraintIn {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub refs: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub variant: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dx: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dy: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub angle: Option<f64>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct DimensionIn {
    pub id: String,
    pub kind: String,
    pub refs: Vec<String>,
    pub value: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub variant: Option<i64>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct DragIn {
    pub point: String,
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Output {
    pub ok: bool,
    pub points: BTreeMap<String, [f64; 2]>,
    pub radii: BTreeMap<String, f64>,
    pub unsatisfied: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub free_points: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub free_curves: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dof: Option<usize>,
    pub iterations: usize,
    pub error: Option<String>,
    /// `arc` or `loop`: a solution was found and turned down for jumping. See `Input::branches`.
    pub crossed: Option<String>,
    /// Every free size and span stayed.
    pub kept: bool,
    /// Curves whose radius the rows left free and the solve still could not keep.
    pub resized: Vec<String>,
}
