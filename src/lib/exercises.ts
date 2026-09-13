export type Pt = { x: number; y: number; score?: number };
export type KP = Record<string, Pt>;

export function angleDeg(a: Pt, b: Pt, c: Pt): number {
  const abx = a.x - b.x;
  const aby = a.y - b.y;
  const cbx = c.x - b.x;
  const cby = c.y - b.y;
  const dot = abx * cbx + aby * cby;
  const mag = Math.hypot(abx, aby) * Math.hypot(cbx, cby);
  if (mag === 0) return 180;
  const cos = Math.min(1, Math.max(-1, dot / mag));
  return (Math.acos(cos) * 180) / Math.PI;
}

function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function conf(p: Pt | undefined, min = 0.3): p is Pt {
  return !!p && (p.score ?? 0) > min;
}

/** Generic exponential-moving-average smoother for any number of named metrics. */
export class MetricSmoother {
  private vals = new Map<string, number>();
  constructor(private alpha = 0.35) {}

  push(key: string, raw: number): number {
    const prev = this.vals.get(key);
    const next = prev === undefined ? raw : prev + this.alpha * (raw - prev);
    this.vals.set(key, next);
    return next;
  }

  get(key: string): number | undefined {
    return this.vals.get(key);
  }

  reset() {
    this.vals.clear();
  }
}

export type FormStatus = "good" | "warn" | "idle";
/** "up" = rest/start position, "down" = the active/exertion position — kept as
 * one pair of labels across exercises so the HUD doesn't need per-exercise UI. */
export type Phase = "up" | "down";

export type ExerciseFrame = {
  status: FormStatus;
  message: string;
  repCompleted: boolean;
  phase: Phase;
  /** What to show in the HUD's secondary metric readout, e.g. "Knee angle". */
  metricLabel: string;
  metricValue: number;
};

export type ExerciseId = "squat" | "lunge" | "jumping-jack" | "high-knee";

export const EXERCISES: Record<
  ExerciseId,
  { label: string; short: string; setupTips: string[]; ruleLines: string[] }
> = {
  squat: {
    label: "Squats",
    short: "Squat",
    setupTips: ["Stand side-on to the camera so your knee bend is visible"],
    ruleLines: [
      "Knee angle under ~105° (calibrates to you) counts as the bottom",
      "Standing back up past ~155° completes the rep",
      "Torso angle under 150° triggers “Keep back straight”",
    ],
  },
  lunge: {
    label: "Lunges",
    short: "Lunge",
    setupTips: ["Stand side-on with your stepping leg closest to the camera"],
    ruleLines: [
      "Front knee bending under ~100° (calibrates to you) counts as the bottom",
      "Pushing back up past ~160° completes the rep",
      "Front knee drifting far past your toes triggers “Watch your front knee”",
    ],
  },
  "jumping-jack": {
    label: "Jumping Jacks",
    short: "Jumping jack",
    setupTips: ["Face the camera straight-on with arms and legs fully visible"],
    ruleLines: [
      "Arms overhead and feet apart counts as the open position",
      "Arms back at your sides with feet together completes the rep",
      "Arms raised without feet spreading (or vice versa) triggers “Sync arms and legs”",
    ],
  },
  "high-knee": {
    label: "High Knees",
    short: "High knee",
    setupTips: ["Stand side-on so your hip-to-knee lift is visible"],
    ruleLines: [
      "Driving a knee up toward hip height counts as a rep",
      "Leaning your torso back to compensate triggers “Stay upright”",
      "Thresholds calibrate to your own range as you go",
    ],
  },
};

/** Shared adaptive down/up threshold pair: fixed cutoffs assume everyone
 * moves through the same range, which isn't true across body types and
 * camera angles, so thresholds re-center on what the user actually
 * demonstrated after each rep (blended, not snapped, so one odd rep can't
 * wildly swing detection). */
class AdaptiveThreshold {
  down: number;
  up: number;
  private minSeen = Infinity;
  private maxSeen = -Infinity;

  constructor(
    initialDown: number,
    initialUp: number,
    /** true if "down" means the metric falls below `down` (e.g. knee angle
     * closing); false if "down" means the metric rises above it (e.g. arm
     * angle opening for a jumping jack). */
    private risingIsDown = false,
  ) {
    this.down = initialDown;
    this.up = initialUp;
  }

  note(value: number) {
    this.minSeen = Math.min(this.minSeen, value);
    this.maxSeen = Math.max(this.maxSeen, value);
  }

  /** Call once a full rep (down→up) has completed. */
  recalibrate() {
    const range = this.maxSeen - this.minSeen;
    if (range > 20 && Number.isFinite(range)) {
      const lowTarget = this.minSeen + range * 0.3;
      const highTarget = this.maxSeen - range * 0.1;
      const target = this.risingIsDown
        ? { down: highTarget, up: lowTarget }
        : { down: lowTarget, up: highTarget };
      this.down = this.down * 0.6 + target.down * 0.4;
      this.up = this.up * 0.6 + target.up * 0.4;
    }
    this.minSeen = Infinity;
    this.maxSeen = -Infinity;
  }

  reset(initialDown: number, initialUp: number) {
    this.down = initialDown;
    this.up = initialUp;
    this.minSeen = Infinity;
    this.maxSeen = -Infinity;
  }
}

export interface ExerciseEngine {
  reps: number;
  phase: Phase;
  /** Full body must be visible for every exercise, so calibration reuses one
   * required-keypoint check regardless of which exercise is selected. */
  update(kp: KP, side: "left" | "right"): ExerciseFrame;
  reset(): void;
}

/** Squats and lunges are both single-leg, knee-angle-driven exercises with a
 * torso-angle form check — they share this base and differ only in
 * thresholds/messages/extra checks. */
abstract class LegAngleEngine implements ExerciseEngine {
  reps = 0;
  phase: Phase = "up";
  protected reachedDepth = false;
  protected smoother = new MetricSmoother();
  protected threshold: AdaptiveThreshold;

  constructor(
    initialDown: number,
    initialUp: number,
    protected metricLabel: string,
  ) {
    this.threshold = new AdaptiveThreshold(initialDown, initialUp, false);
  }

  protected abstract depthMessage(
    kneeAngle: number,
    phase: Phase,
  ): { status: FormStatus; message: string };
  /** Optional extra per-exercise form check beyond depth/back angle. */
  protected extraCheck?(
    kp: KP,
    side: "left" | "right",
  ): { status: FormStatus; message: string } | null;

  update(kp: KP, side: "left" | "right"): ExerciseFrame {
    const hip = kp[`${side}_hip`];
    const knee = kp[`${side}_knee`];
    const ankle = kp[`${side}_ankle`];
    const shoulder = kp[`${side}_shoulder`];

    const trackingOk = conf(hip) && conf(knee) && conf(ankle);
    const kneeRaw = trackingOk ? angleDeg(hip, knee, ankle) : (this.smoother.get("knee") ?? 175);
    const backRaw =
      conf(shoulder) && conf(hip) && conf(knee)
        ? angleDeg(shoulder, hip, knee)
        : (this.smoother.get("back") ?? 175);

    const kneeAngle = this.smoother.push("knee", kneeRaw);
    const backAngle = this.smoother.push("back", backRaw);
    this.threshold.note(kneeAngle);

    let repCompleted = false;
    if (this.phase === "up" && kneeAngle < this.threshold.down) {
      this.phase = "down";
      this.reachedDepth = true;
    } else if (this.phase === "down" && kneeAngle > this.threshold.up) {
      this.phase = "up";
      if (this.reachedDepth) {
        this.reps += 1;
        repCompleted = true;
        this.threshold.recalibrate();
      }
      this.reachedDepth = false;
    }

    let status: FormStatus = "good";
    let message = "Good form";

    if (backAngle < 150) {
      status = "warn";
      message = "Keep back straight";
    } else {
      const extra = this.extraCheck?.(kp, side);
      if (extra) {
        status = extra.status;
        message = extra.message;
      } else {
        const depth = this.depthMessage(kneeAngle, this.phase);
        status = depth.status;
        message = depth.message;
      }
    }

    return {
      status,
      message,
      repCompleted,
      phase: this.phase,
      metricLabel: this.metricLabel,
      metricValue: Math.round(kneeAngle),
    };
  }

  reset() {
    this.phase = "up";
    this.reps = 0;
    this.reachedDepth = false;
    this.smoother.reset();
  }
}

// Deliberately more permissive than a "real" 90/160 squat — starting too
// strict was the main reason reps weren't registering for a lot of body
// types and camera angles. Loosens further as the user's own range calibrates.
export class SquatCounter extends LegAngleEngine {
  constructor() {
    super(105, 155, "Knee angle");
  }
  protected depthMessage(kneeAngle: number, phase: Phase) {
    if (phase === "up" && kneeAngle > 110 && kneeAngle < 150) {
      return { status: "warn" as FormStatus, message: "Squat deeper" };
    }
    if (kneeAngle >= 150)
      return { status: "good" as FormStatus, message: "Ready — start your squat" };
    if (phase === "down") return { status: "good" as FormStatus, message: "Good depth — drive up" };
    return { status: "good" as FormStatus, message: "Good form" };
  }
}

/** Lunges bend deeper than squats and add a "knee past toes" horizontal
 * check, which squats don't need since the shin stays roughly vertical. */
export class LungeCounter extends LegAngleEngine {
  constructor() {
    super(100, 160, "Front knee angle");
  }
  protected depthMessage(kneeAngle: number, phase: Phase) {
    if (phase === "up" && kneeAngle > 105 && kneeAngle < 155) {
      return { status: "warn" as FormStatus, message: "Lunge deeper" };
    }
    if (kneeAngle >= 155)
      return { status: "good" as FormStatus, message: "Ready — step into your lunge" };
    if (phase === "down")
      return { status: "good" as FormStatus, message: "Good depth — push back up" };
    return { status: "good" as FormStatus, message: "Good form" };
  }
  protected override extraCheck(kp: KP, side: "left" | "right") {
    const knee = kp[`${side}_knee`];
    const ankle = kp[`${side}_ankle`];
    const hip = kp[`${side}_hip`];
    if (!conf(knee) || !conf(ankle) || !conf(hip)) return null;
    const stanceWidth = Math.max(1, Math.abs(hip.x - ankle.x));
    const kneePastToe = knee.x - ankle.x;
    // Positive/negative depends on which way the person faces the camera;
    // compare magnitude against stance width rather than a fixed pixel value.
    if (this.phase === "down" && Math.abs(kneePastToe) > stanceWidth * 1.4) {
      return { status: "warn" as FormStatus, message: "Watch your front knee" };
    }
    return null;
  }
}

/** High knees drive the hip-knee-ankle chain quickly, but the signal that
 * actually distinguishes "knee raised" is hip flexion (shoulder-hip-knee),
 * not knee bend — a high knee can have almost any knee angle depending on
 * how tucked the lower leg is. */
export class HighKneeCounter implements ExerciseEngine {
  reps = 0;
  phase: Phase = "up";
  private reachedTop = false;
  private smoother = new MetricSmoother();
  private threshold = new AdaptiveThreshold(110, 155, true);

  update(kp: KP, side: "left" | "right"): ExerciseFrame {
    const hip = kp[`${side}_hip`];
    const knee = kp[`${side}_knee`];
    const shoulder = kp[`${side}_shoulder`];

    const trackingOk = conf(shoulder) && conf(hip) && conf(knee);
    const hipRaw = trackingOk ? angleDeg(shoulder, hip, knee) : (this.smoother.get("hip") ?? 175);
    const hipAngle = this.smoother.push("hip", hipRaw);
    this.threshold.note(hipAngle);

    let repCompleted = false;
    // Rising phase ("down"→raised knee) is when the hip angle *drops* below
    // threshold.down (thigh swinging up toward the torso).
    if (this.phase === "up" && hipAngle < this.threshold.down) {
      this.phase = "down";
      this.reachedTop = true;
    } else if (this.phase === "down" && hipAngle > this.threshold.up) {
      this.phase = "up";
      if (this.reachedTop) {
        this.reps += 1;
        repCompleted = true;
        this.threshold.recalibrate();
      }
      this.reachedTop = false;
    }

    let status: FormStatus = "good";
    let message = "Good form";
    const ankle = kp[`${side}_ankle`];
    if (conf(shoulder) && conf(hip) && conf(ankle)) {
      const torsoLean = angleDeg({ x: shoulder.x, y: shoulder.y - 100 }, shoulder, hip);
      if (torsoLean > 25) {
        status = "warn";
        message = "Stay upright";
      }
    }
    if (status === "good") {
      if (this.phase === "up" && hipAngle < 160 && hipAngle > this.threshold.down + 10) {
        status = "warn";
        message = "Drive that knee higher";
      } else if (this.phase === "down") {
        message = "Good height — drive down";
      } else {
        message = "Ready — drive a knee up";
      }
    }

    return {
      status,
      message,
      repCompleted,
      phase: this.phase,
      metricLabel: "Hip lift angle",
      metricValue: Math.round(hipAngle),
    };
  }

  reset() {
    this.phase = "up";
    this.reps = 0;
    this.reachedTop = false;
    this.smoother.reset();
  }
}

/** Jumping jacks are the odd one out: no single tracked "side", and the rep
 * is defined by two signals moving together — arms raising (shoulder-hip-
 * wrist angle) and legs spreading (ankle-to-ankle distance relative to
 * shoulder width, so it works regardless of distance from the camera). */
export class JumpingJackCounter implements ExerciseEngine {
  reps = 0;
  phase: Phase = "up";
  private reachedOpen = false;
  private smoother = new MetricSmoother();
  private armThreshold = new AdaptiveThreshold(70, 35, true);
  private legThreshold = new AdaptiveThreshold(1.3, 1.05, true);

  update(kp: KP): ExerciseFrame {
    const lsh = kp["left_shoulder"];
    const rsh = kp["right_shoulder"];
    const lhip = kp["left_hip"];
    const rhip = kp["right_hip"];
    const lwr = kp["left_wrist"];
    const rwr = kp["right_wrist"];
    const lank = kp["left_ankle"];
    const rank = kp["right_ankle"];

    let armRaw = this.smoother.get("arm") ?? 30;
    if (conf(lsh) && conf(lhip) && conf(lwr) && conf(rsh) && conf(rhip) && conf(rwr)) {
      const leftArm = angleDeg(lhip, lsh, lwr);
      const rightArm = angleDeg(rhip, rsh, rwr);
      armRaw = (leftArm + rightArm) / 2;
    }
    let spreadRaw = this.smoother.get("spread") ?? 1;
    if (conf(lsh) && conf(rsh) && conf(lank) && conf(rank)) {
      const shoulderWidth = Math.max(1, dist(lsh, rsh));
      spreadRaw = dist(lank, rank) / shoulderWidth;
    }

    const armAngle = this.smoother.push("arm", armRaw);
    const spread = this.smoother.push("spread", spreadRaw);
    this.armThreshold.note(armAngle);
    this.legThreshold.note(spread);

    // "Open" (arms up + legs apart) is treated as the "down" phase so the
    // HUD's generic up/down phase semantics still line up with "rest vs
    // active position".
    const armOpen = armAngle > this.armThreshold.down;
    const legOpen = spread > this.legThreshold.down;
    const armClosed = armAngle < this.armThreshold.up;
    const legClosed = spread < this.legThreshold.up;

    let repCompleted = false;
    if (this.phase === "up" && armOpen && legOpen) {
      this.phase = "down";
      this.reachedOpen = true;
    } else if (this.phase === "down" && armClosed && legClosed) {
      this.phase = "up";
      if (this.reachedOpen) {
        this.reps += 1;
        repCompleted = true;
        this.armThreshold.recalibrate();
        this.legThreshold.recalibrate();
      }
      this.reachedOpen = false;
    }

    let status: FormStatus = "good";
    let message = "Good form";
    if ((armOpen && !legOpen) || (!armOpen && legOpen && this.phase === "up")) {
      status = "warn";
      message = "Sync arms and legs";
    } else if (this.phase === "up") {
      message = "Ready — jump out";
    } else {
      message = "Nice and wide — snap back in";
    }

    return {
      status,
      message,
      repCompleted,
      phase: this.phase,
      metricLabel: "Arm angle",
      metricValue: Math.round(armAngle),
    };
  }

  reset() {
    this.phase = "up";
    this.reps = 0;
    this.reachedOpen = false;
    this.smoother.reset();
  }
}

export function createEngine(id: ExerciseId): ExerciseEngine {
  switch (id) {
    case "squat":
      return new SquatCounter();
    case "lunge":
      return new LungeCounter();
    case "high-knee":
      return new HighKneeCounter();
    case "jumping-jack":
      return new JumpingJackCounter();
  }
}

/** Simulated keypoints used when live inference is unavailable (no camera /
 * model load failure), so the coach is still explorable. Each exercise gets
 * its own believable cycling pose instead of reusing the squat's. */
export function simulateSkeleton(id: ExerciseId, tMs: number, w: number, h: number): KP {
  const cycle = 3200;
  const p = (tMs % cycle) / cycle;
  const wave = (1 - Math.cos(p * Math.PI * 2)) / 2; // 0..1..0
  const cx = w / 2;

  if (id === "jumping-jack") {
    const armsUp = wave; // 0 = arms down, 1 = arms overhead
    const spread = wave; // 0 = feet together, 1 = feet wide
    const shoulderY = h * 0.32;
    const hipY = h * 0.52;
    const sw = w * 0.11;
    const hw = w * 0.08 + spread * w * 0.05;
    const wristY = shoulderY - armsUp * h * 0.22 + (1 - armsUp) * h * 0.16;
    const wristX = sw + (1 - armsUp) * w * 0.02 + armsUp * w * 0.03;
    return {
      nose: { x: cx, y: shoulderY - h * 0.09, score: 1 },
      left_shoulder: { x: cx - sw, y: shoulderY, score: 1 },
      right_shoulder: { x: cx + sw, y: shoulderY, score: 1 },
      left_elbow: {
        x: cx - sw - w * 0.03,
        y: shoulderY - armsUp * h * 0.1 + (1 - armsUp) * h * 0.09,
        score: 1,
      },
      right_elbow: {
        x: cx + sw + w * 0.03,
        y: shoulderY - armsUp * h * 0.1 + (1 - armsUp) * h * 0.09,
        score: 1,
      },
      left_wrist: { x: cx - wristX, y: wristY, score: 1 },
      right_wrist: { x: cx + wristX, y: wristY, score: 1 },
      left_hip: { x: cx - hw * 0.7, y: hipY, score: 1 },
      right_hip: { x: cx + hw * 0.7, y: hipY, score: 1 },
      left_knee: { x: cx - hw, y: h * 0.72, score: 1 },
      right_knee: { x: cx + hw, y: h * 0.72, score: 1 },
      left_ankle: { x: cx - hw, y: h * 0.9, score: 1 },
      right_ankle: { x: cx + hw, y: h * 0.9, score: 1 },
    };
  }

  if (id === "high-knee") {
    const lift = wave; // one leg cycles up (and forward) while the other stays planted
    const hipY = h * 0.5;
    const shoulderY = h * 0.26;
    const sw = w * 0.11;
    const hw = w * 0.08;
    return {
      nose: { x: cx, y: shoulderY - h * 0.09, score: 1 },
      left_shoulder: { x: cx - sw, y: shoulderY, score: 1 },
      right_shoulder: { x: cx + sw, y: shoulderY, score: 1 },
      left_elbow: { x: cx - sw - w * 0.04, y: shoulderY + h * 0.09, score: 1 },
      right_elbow: { x: cx + sw + w * 0.04, y: shoulderY + h * 0.09, score: 1 },
      left_wrist: { x: cx - sw - w * 0.02, y: shoulderY + h * 0.17, score: 1 },
      right_wrist: { x: cx + sw + w * 0.02, y: shoulderY + h * 0.17, score: 1 },
      left_hip: { x: cx - hw, y: hipY, score: 1 },
      right_hip: { x: cx + hw, y: hipY, score: 1 },
      // A raised knee swings forward, not just up — without the x shift the
      // hip-shoulder-knee angle barely changes (knee stays directly below
      // the hip the whole time).
      left_knee: { x: cx - hw + lift * w * 0.09, y: hipY + (1 - lift) * h * 0.2, score: 1 },
      right_knee: { x: cx + hw, y: h * 0.72, score: 1 },
      left_ankle: { x: cx - hw + lift * w * 0.05, y: hipY + (1 - lift) * h * 0.38, score: 1 },
      right_ankle: { x: cx + hw, y: h * 0.9, score: 1 },
    };
  }

  // Squats bend both legs together; lunges bend the front leg much more
  // than the back leg, so each side gets its own depth factor instead of
  // sharing one — squats keep leftDepth === rightDepth (symmetric), lunges
  // don't (asymmetric), matching how they actually look.
  const depth = wave;
  const leftDepth = depth;
  const rightDepth = id === "lunge" ? depth * 0.3 : depth;
  const hipY = h * (0.5 + depth * 0.12);
  const shoulderY = hipY - h * (0.24 - depth * 0.05);
  const kneeXBase = w * (id === "lunge" ? 0.08 : 0.05);
  const kneeY = (d: number) => h * 0.72 + d * h * 0.05;
  const ankleY = (d: number) => h * 0.9 - d * h * 0.02;
  const sw = w * 0.11;
  const hw = w * 0.08;
  return {
    nose: { x: cx, y: shoulderY - h * 0.09, score: 1 },
    left_shoulder: { x: cx - sw, y: shoulderY, score: 1 },
    right_shoulder: { x: cx + sw, y: shoulderY, score: 1 },
    left_elbow: { x: cx - sw - w * 0.04, y: shoulderY + h * 0.09, score: 1 },
    right_elbow: { x: cx + sw + w * 0.04, y: shoulderY + h * 0.09, score: 1 },
    left_wrist: { x: cx - sw - w * 0.02, y: shoulderY + h * 0.17, score: 1 },
    right_wrist: { x: cx + sw + w * 0.02, y: shoulderY + h * 0.17, score: 1 },
    left_hip: { x: cx - hw, y: hipY, score: 1 },
    right_hip: { x: cx + hw, y: hipY, score: 1 },
    left_knee: { x: cx - hw - leftDepth * kneeXBase, y: kneeY(leftDepth), score: 1 },
    right_knee: { x: cx + hw + rightDepth * kneeXBase, y: kneeY(rightDepth), score: 1 },
    left_ankle: { x: cx - hw, y: ankleY(leftDepth), score: 1 },
    right_ankle: { x: cx + hw, y: ankleY(rightDepth), score: 1 },
  };
}
