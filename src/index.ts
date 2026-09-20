// Operator-safe public surface.
// GroundTruth is intentionally NOT exported here. God-mode consumers must use
// the explicit "./ground-truth" or "./evaluation" package subpaths.
export * from "./core/units.js";
export * from "./observation/types.js";
export * from "./observation/operator-boundary.js";
