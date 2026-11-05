// Every numerical tolerance in the geometry and model layers lives here.

/** Two positions closer than this (mm) are the same place. */
export const EPS_POINT = 1e-6;
/** Position tolerance when joining curve ends into profiles (mm). */
export const EPS_JOIN = 1e-4;
/** Angles closer than this (radians) are equal; also the parallel test. */
export const EPS_ANGLE = 1e-9;
/** Curve parameters closer than this are equal. */
export const EPS_PARAM = 1e-9;
/** Below this a denominator or length counts as zero. */
export const EPS_ZERO = 1e-12;
/** Parameter margin keeping an intersection from counting as a curve end. */
export const EPS_END_PARAM = 1e-7;
/** A sweep this close to a full turn is one. */
export const EPS_SWEEP = 1e-12;
/** Newton stops when its parameter step falls below this. */
export const EPS_STEP = 1e-13;
/** Shortest chord (mm) used as a divisor. */
export const EPS_CHORD = 1e-9;
/** Diagonal loading for least-squares normal equations. */
export const EPS_RIDGE = 1e-9;
/** Intersections closer than this along a curve (mm) are one intersection. */
export const EPS_HIT = 1e-5;
/** Parameter slack when deciding which piece of a split curve holds a location. */
export const EPS_PIECE = 1e-6;
/** Parameter step for reading a tangent at a zero-speed knot. */
export const TANGENT_PROBE = 1e-5;
/** Self-intersections closer than this in parameter are one. */
export const EPS_SELF = 1e-4;
/** A self-intersection's two parameters must differ by at least this. */
export const EPS_SELF_SPLIT = 1e-6;
/** Smallest angular step (radians) when flattening circles and ellipses. */
export const MIN_ARC_STEP = 1e-3;
/** Smallest zoom honoured when deriving a render tolerance. */
export const MIN_ZOOM = 1e-6;
/** Default chord deviation (mm) for flattening. */
export const FLATTEN_TOL = 0.01;
/** Coarser chord deviation (mm) for intersection search; Newton does the rest. */
export const SEARCH_FLATTEN_TOL = 0.05;
/** Chord deviation (mm) for drawn curves at 1:1. Renderers should divide by zoom. */
export const RENDER_FLATTEN_TOL = 0.05;
/** Chord deviation (mm) for DXF polylines. */
export const DXF_FLATTEN_TOL = 0.005;
/** Chord deviation (mm) for glyph outlines. */
export const TEXT_FLATTEN_TOL = 0.02;
/** Min Distance seeds: chord error of the sample polyline as a fraction of the curve's size (never above FLATTEN_TOL). */
export const MIN_DIST_FLATTEN = 2e-4;
/** Min Distance seeds: a polyline gap this many chord errors above the smallest can still hold the true minimum. */
export const MIN_DIST_SLACK = 4;
/** Min Distance: most places a pair of curves is polished from. */
export const MIN_DIST_STARTS = 128;
/** Min Distance: first step (in t) of the last search that settles a minimum at a kink. */
export const MIN_DIST_REACH = 1e-3;
/** Newton iteration cap. */
export const NEWTON_ITERS = 32;
/** Newton residual (mm). */
export const NEWTON_TOL = 1e-9;
/** Hard cap on segments produced by flattening a single curve. */
export const MAX_FLATTEN_SEGMENTS = 4096;
/** Samples passed to the solver per spline span. */
export const SOLVER_SAMPLES_PER_SPAN = 8;
/** AutoConstrain default position tolerance (mm). */
export const AUTO_POS_TOL = 0.05;
/** AutoConstrain default angular tolerance (radians, about 1 degree). */
export const AUTO_ANGLE_TOL = 0.0175;
/** Relative length/radius tolerance for AutoConstrain equal detection. */
export const AUTO_EQUAL_TOL = 0.01;
