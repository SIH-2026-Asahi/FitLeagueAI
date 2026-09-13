// Stub for @mediapipe/pose. We only use the MoveNet model from
// @tensorflow-models/pose-detection, but the package statically imports
// @mediapipe/pose for BlazePose, whose CommonJS bundle has no ESM exports.
export class Pose {
  constructor() {
    throw new Error("@mediapipe/pose is not bundled in this app (MoveNet only).");
  }
}

export default { Pose };
