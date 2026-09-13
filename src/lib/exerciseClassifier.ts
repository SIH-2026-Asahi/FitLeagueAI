import type { ExerciseId, KP, Pt } from "@/lib/exercises";
import { angleDeg } from "@/lib/exercises";

/**
 * Auto-exercise classification. Deliberately NOT another ML model — this
 * reuses the same MoveNet keypoints the exercise engines already consume and
 * layers a small geometry/movement heuristic on top:
 *
 *   MoveNet keypoints -> per-frame joint features -> short rolling window ->
 *   movement-range heuristic -> per-frame "candidate" -> majority vote over
 *   a longer window -> "stable" result
 *
 * Only exercises with an existing engine (squat/lunge/jumping-jack/high-knee)
 * are ever returned. When the signal is weak or ambiguous this returns
 * `null` rather than guessing — callers should show "Detecting exercise…"
 * (or, after a longer timeout, "Unable to identify exercise") instead of
 * activating an engine.
 */

function conf(p: Pt | undefined, min = 0.3): p is Pt {
  return !!p && (p.score ?? 0) > min;
}

function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

type Features = {
  kneeL: number | null;
  kneeR: number | null;
  hipL: number | null;
  hipR: number | null;
  arm: number | null;
  spread: number | null;
};

function extractFeatures(kp: KP): Features {
  const lhip = kp["left_hip"];
  const rhip = kp["right_hip"];
  const lknee = kp["left_knee"];
  const rknee = kp["right_knee"];
  const lankle = kp["left_ankle"];
  const rankle = kp["right_ankle"];
  const lsh = kp["left_shoulder"];
  const rsh = kp["right_shoulder"];
  const lwr = kp["left_wrist"];
  const rwr = kp["right_wrist"];

  const kneeL = conf(lhip) && conf(lknee) && conf(lankle) ? angleDeg(lhip, lknee, lankle) : null;
  const kneeR = conf(rhip) && conf(rknee) && conf(rankle) ? angleDeg(rhip, rknee, rankle) : null;
  const hipL = conf(lsh) && conf(lhip) && conf(lknee) ? angleDeg(lsh, lhip, lknee) : null;
  const hipR = conf(rsh) && conf(rhip) && conf(rknee) ? angleDeg(rsh, rhip, rknee) : null;

  let arm: number | null = null;
  if (conf(lsh) && conf(lhip) && conf(lwr) && conf(rsh) && conf(rhip) && conf(rwr)) {
    arm = (angleDeg(lhip, lsh, lwr) + angleDeg(rhip, rsh, rwr)) / 2;
  }

  let spread: number | null = null;
  if (conf(lsh) && conf(rsh) && conf(lankle) && conf(rankle)) {
    const shoulderWidth = Math.max(1, dist(lsh, rsh));
    spread = dist(lankle, rankle) / shoulderWidth;
  }

  return { kneeL, kneeR, hipL, hipR, arm, spread };
}

/** Range (max-min) over a window, ignoring frames where the feature was
 * unavailable. Returns 0 if fewer than 2 usable samples. */
function rangeOf(samples: (number | null)[]): number {
  const vals = samples.filter((v): v is number => v !== null);
  if (vals.length < 2) return 0;
  return Math.max(...vals) - Math.min(...vals);
}

const WINDOW_FRAMES = 24; // ~0.8-1s of motion at typical rAF rates — long
// enough to see a rep's movement, short enough to react quickly.
const VOTE_FRAMES = 18; // per-frame candidates considered for the stability vote
const STABLE_VOTES_NEEDED = 14; // ~78% agreement required to lock in a result
const MIN_KNEE_RANGE = 14; // degrees — minimum bend to call it a leg exercise
const MIN_HIP_RANGE = 22; // degrees — minimum thigh lift to call it a high knee
const MIN_ARM_RANGE = 25; // degrees — minimum arm swing for a jumping jack
const MIN_SPREAD_RANGE = 0.15; // ratio units — minimum leg-spread change

export type DetectionResult = {
  /** This frame's best guess, before stability voting. */
  candidate: ExerciseId | null;
  /** Only set once the same candidate has won a clear majority of recent
   * frames — this is what should actually activate an exercise engine. */
  stable: ExerciseId | null;
};

export class ExerciseClassifier {
  private buf: Features[] = [];
  private votes: (ExerciseId | null)[] = [];

  push(kp: KP): DetectionResult {
    this.buf.push(extractFeatures(kp));
    if (this.buf.length > WINDOW_FRAMES) this.buf.shift();

    const candidate = this.classifyWindow();

    this.votes.push(candidate);
    if (this.votes.length > VOTE_FRAMES) this.votes.shift();

    return { candidate, stable: this.stableVote() };
  }

  private classifyWindow(): ExerciseId | null {
    if (this.buf.length < WINDOW_FRAMES) return null;

    const kneeLRange = rangeOf(this.buf.map((f) => f.kneeL));
    const kneeRRange = rangeOf(this.buf.map((f) => f.kneeR));
    const hipLRange = rangeOf(this.buf.map((f) => f.hipL));
    const hipRRange = rangeOf(this.buf.map((f) => f.hipR));
    const armRange = rangeOf(this.buf.map((f) => f.arm));
    const spreadRange = rangeOf(this.buf.map((f) => f.spread));

    const kneeMax = Math.max(kneeLRange, kneeRRange);
    const hipMax = Math.max(hipLRange, hipRRange);

    // Jumping jack: arms and legs both swinging through a wide range —
    // the only exercise where both signals move a lot at once.
    if (armRange > MIN_ARM_RANGE && spreadRange > MIN_SPREAD_RANGE) {
      return "jumping-jack";
    }

    // High knee: hip flexion (thigh lift) dominates over knee bend, and is
    // the more reliable signal per side for this movement.
    if (hipMax > MIN_HIP_RANGE && hipMax >= kneeMax * 0.8) {
      return "high-knee";
    }

    // Squat vs lunge both show up mainly as knee-angle range. Squats bend
    // both legs roughly together; lunges bend one leg noticeably more than
    // the other (front leg vs. back leg).
    if (kneeMax > MIN_KNEE_RANGE) {
      const symmetry = Math.min(kneeLRange, kneeRRange) / Math.max(kneeLRange, kneeRRange, 1);
      return symmetry > 0.55 ? "squat" : "lunge";
    }

    return null;
  }

  private stableVote(): ExerciseId | null {
    if (this.votes.length < VOTE_FRAMES) return null;
    const counts = new Map<ExerciseId, number>();
    for (const v of this.votes) {
      if (!v) continue;
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    let best: ExerciseId | null = null;
    let bestCount = 0;
    counts.forEach((count, id) => {
      if (count > bestCount) {
        bestCount = count;
        best = id;
      }
    });
    return best && bestCount >= STABLE_VOTES_NEEDED ? best : null;
  }

  reset() {
    this.buf = [];
    this.votes = [];
  }
}
