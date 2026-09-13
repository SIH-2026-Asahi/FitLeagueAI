import type { KP, Pt } from "@/lib/exercises";

function conf(p: Pt | undefined, min = 0.3): p is Pt {
  return !!p && (p.score ?? 0) > min;
}

function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** How long the "arms crossed overhead" cycle must repeat within to count as
 * one deliberate SOS gesture, not three unrelated stretches. */
const SOS_WINDOW_MS = 8000;
const SOS_REPS_REQUIRED = 3;

/**
 * SOS gesture: raise both arms overhead and cross them like an "X" three
 * times in a row. The pose model tracks body joints only (no fingers), so a
 * literal open/close fist can't be detected — this reuses the same
 * wrist/shoulder/hip keypoints already tracked for every exercise instead.
 * It's deliberately something none of the four workouts do mid-set (needs
 * both wrists above the head AND crossing the body's midline), so it won't
 * false-trigger during a normal rep.
 */
export class SosGestureDetector {
  private crossedCount = 0;
  private wasCrossed = false;
  private windowStartedAt = 0;

  /** Call every frame with the current (already-scaled) keypoints while a
   * session is active. Returns true the instant the 3rd cross completes. */
  update(kp: KP): boolean {
    const lsh = kp["left_shoulder"];
    const rsh = kp["right_shoulder"];
    const lwr = kp["left_wrist"];
    const rwr = kp["right_wrist"];
    const lhip = kp["left_hip"];
    const rhip = kp["right_hip"];

    // A dropped/low-confidence frame shouldn't cost progress on the count —
    // only reset the window on a stale timeout, not a single bad frame.
    if (!conf(lsh) || !conf(rsh) || !conf(lwr) || !conf(rwr) || !conf(lhip) || !conf(rhip)) {
      return false;
    }

    // Body-scale reference (torso length) so the raise threshold works the
    // same whether the person is close to or far from the camera.
    const torsoScale = Math.max(1, dist(lsh, lhip), dist(rsh, rhip));
    const bothRaised =
      lwr.y < lsh.y - torsoScale * 0.15 && rwr.y < rsh.y - torsoScale * 0.15;
    const crossed = bothRaised && lwr.x > rwr.x; // wrists swapped sides = crossed overhead

    const now = performance.now();
    if (crossed && !this.wasCrossed) {
      if (this.crossedCount === 0 || now - this.windowStartedAt < SOS_WINDOW_MS) {
        if (this.crossedCount === 0) this.windowStartedAt = now;
        this.crossedCount += 1;
      } else {
        this.crossedCount = 1;
        this.windowStartedAt = now;
      }
    }
    this.wasCrossed = crossed;

    if (this.crossedCount >= SOS_REPS_REQUIRED) {
      this.reset();
      return true;
    }
    return false;
  }

  reset() {
    this.crossedCount = 0;
    this.wasCrossed = false;
    this.windowStartedAt = 0;
  }
}

/** How long a person can go with essentially no tracked movement before we
 * treat it as a possible medical event rather than just resting between
 * reps. Movement is measured as a fraction of torso length per frame so it
 * doesn't depend on screen resolution or distance from the camera. */
const INACTIVITY_TIMEOUT_MS = 90_000; // ~1.5 min, per spec's "1-2 min" window
const MOVEMENT_FLOOR = 0.012;

/**
 * Tracks how long it's been since any tracked joint moved meaningfully.
 * Only meant to run while a session is "active" — idle/calibration screens
 * naturally have no movement and aren't a safety signal.
 */
export class InactivityMonitor {
  private lastKp: KP | null = null;
  private lastMovedAt = performance.now();
  private smoothedMotion = 0;

  /** Call every frame with the current keypoints (or null if nothing was
   * detected this frame). Returns milliseconds since movement was last seen. */
  update(kp: KP | null): number {
    const now = performance.now();
    if (kp && this.lastKp) {
      const lsh = kp["left_shoulder"];
      const lhip = kp["left_hip"];
      const scale = conf(lsh) && conf(lhip) ? Math.max(1, dist(lsh, lhip)) : 100;

      let total = 0;
      let n = 0;
      for (const name of Object.keys(kp)) {
        const a = kp[name];
        const b = this.lastKp[name];
        if (!conf(a) || !conf(b)) continue;
        total += dist(a, b) / scale;
        n += 1;
      }
      const motion = n ? total / n : 0;
      this.smoothedMotion = this.smoothedMotion * 0.8 + motion * 0.2;
      if (this.smoothedMotion > MOVEMENT_FLOOR) this.lastMovedAt = now;
    }
    this.lastKp = kp;
    return now - this.lastMovedAt;
  }

  /** True once inactivity has crossed the "check in on them" threshold. */
  isOverThreshold(): boolean {
    return performance.now() - this.lastMovedAt > INACTIVITY_TIMEOUT_MS;
  }

  /** Clears the inactivity clock, e.g. after the person confirms they're OK. */
  markActive() {
    this.lastMovedAt = performance.now();
  }

  reset() {
    this.lastKp = null;
    this.lastMovedAt = performance.now();
    this.smoothedMotion = 0;
  }
}

export { INACTIVITY_TIMEOUT_MS };

/** How long the "are you OK?" check-in has to be answered before the alarm
 * escalates to surfacing the emergency-contact actions. */
export const CHECKIN_RESPONSE_MS = 20_000;
