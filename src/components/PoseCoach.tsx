import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Loader2,
  Play,
  RotateCcw,
  Sparkles,
  Square,
} from "lucide-react";
import {
  createEngine,
  simulateSkeleton,
  EXERCISES,
  type ExerciseEngine,
  type ExerciseId,
  type FormStatus,
  type Pt,
  type KP,
} from "@/lib/exercises";
import { ExerciseClassifier } from "@/lib/exerciseClassifier";
import { cancelSpeech, speak } from "@/lib/speech";
import { commitSession, todayKey, useFitState } from "@/lib/fitStore";
import { pingActiveFn, submitScoreFn } from "@/lib/groups";
import { SosGestureDetector, InactivityMonitor, INACTIVITY_TIMEOUT_MS, CHECKIN_RESPONSE_MS } from "@/lib/safety";
import { playAlarm, stopAlarm } from "@/lib/alarm";
import { EmergencyOverlay, type EmergencyStage } from "@/components/EmergencyOverlay";

type Stage = "idle" | "starting" | "calibrate" | "countdown" | "active" | "summary";

const SKELETON: [string, string][] = [
  ["left_shoulder", "right_shoulder"],
  ["left_shoulder", "left_elbow"],
  ["left_elbow", "left_wrist"],
  ["right_shoulder", "right_elbow"],
  ["right_elbow", "right_wrist"],
  ["left_shoulder", "left_hip"],
  ["right_shoulder", "right_hip"],
  ["left_hip", "right_hip"],
  ["left_hip", "left_knee"],
  ["left_knee", "left_ankle"],
  ["right_hip", "right_knee"],
  ["right_knee", "right_ankle"],
];

const REQUIRED = [
  "left_shoulder",
  "right_shoulder",
  "left_hip",
  "right_hip",
  "left_knee",
  "right_knee",
  "left_ankle",
  "right_ankle",
  // Wrists too — jumping jacks need the arms in frame, and requiring them
  // for every exercise is a cheap way to guarantee a genuinely full-body view.
  "left_wrist",
  "right_wrist",
];

export default function PoseCoach({ muted }: { muted: boolean }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const detectorRef = useRef<{ estimatePoses: (v: HTMLVideoElement) => Promise<unknown> } | null>(
    null,
  );
  const counterRef = useRef<ExerciseEngine>(createEngine("squat"));
  const sideRef = useRef<"left" | "right" | null>(null);
  const sideScoresRef = useRef<{ left: number; right: number }>({ left: 0, right: 0 });
  const mutedRef = useRef(muted);
  const exerciseRef = useRef<ExerciseId>("squat");
  const stageRef = useRef<Stage>("idle");
  const framesRef = useRef({ total: 0, good: 0 });
  const inFrameSinceRef = useRef<number | null>(null);
  const startedAtRef = useRef<number>(0);
  const lowConfStreakRef = useRef(0);
  const lastLowConfNoticeRef = useRef(0);
  const sosDetectorRef = useRef(new SosGestureDetector());
  const inactivityRef = useRef(new InactivityMonitor());
  const emergencyStageRef = useRef<EmergencyStage | null>(null);
  const checkinTimerRef = useRef<number | null>(null);
  const [fitState] = useFitState();

  // Auto Mode: classifies the exercise from pose movement instead of the
  // user picking one up front. Manual selection (below) keeps working
  // unchanged when Auto is switched off.
  const classifierRef = useRef(new ExerciseClassifier());
  const detectModeRef = useRef<"auto" | "manual">("auto");
  const detectSinceRef = useRef<number | null>(null);

  const [stage, setStage] = useState<Stage>("idle");
  const [mode, setMode] = useState<"live" | "demo">("live");
  const [detectMode, setDetectMode] = useState<"auto" | "manual">("auto");
  const [detectedExercise, setDetectedExercise] = useState<ExerciseId | null>(null);
  const [detectUnable, setDetectUnable] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [exercise, setExercise] = useState<ExerciseId>("squat");
  const [reps, setReps] = useState(0);
  const [metricLabel, setMetricLabel] = useState("Knee angle");
  const [metricValue, setMetricValue] = useState(180);
  const [status, setStatus] = useState<FormStatus>("idle");
  const [message, setMessage] = useState("Press start to calibrate");
  const [inFrame, setInFrame] = useState(false);
  const [countdown, setCountdown] = useState(3);
  const [summary, setSummary] = useState<{ reps: number; sec: number; form: number } | null>(null);
  const [emergencyStage, setEmergencyStage] = useState<EmergencyStage | null>(null);
  const [checkinSecondsLeft, setCheckinSecondsLeft] = useState(Math.ceil(CHECKIN_RESPONSE_MS / 1000));
  // Camera selection: "" means "let the browser pick the default" (front
  // camera via facingMode). Populated from enumerateDevices() once the
  // browser exposes video inputs; labels only show once permission has been
  // granted at least once (browser behavior, not something we can force).
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>("");

  useEffect(() => {
    mutedRef.current = muted;
    if (muted) cancelSpeech();
  }, [muted]);

  useEffect(() => {
    exerciseRef.current = exercise;
  }, [exercise]);

  useEffect(() => {
    detectModeRef.current = detectMode;
  }, [detectMode]);

  /** Switching modes mid-flow: Manual just stops the classifier from being
   * consulted (handled by the loop checking detectModeRef). Auto resets the
   * classifier so a stale window from before the switch can't immediately
   * "detect" something. */
  const switchDetectMode = useCallback((next: "auto" | "manual") => {
    setDetectMode(next);
    if (next === "auto") {
      classifierRef.current.reset();
      detectSinceRef.current = null;
      setDetectedExercise(null);
      setDetectUnable(false);
    }
  }, []);

  // While a session is actively running and the person is in a group, ping
  // the server periodically so friends see a "live now" dot on the
  // leaderboard — the studio-workout feel. Purely cosmetic presence; never
  // blocks the workout if it fails.
  useEffect(() => {
    if (stage !== "active" || !fitState.activeGroupId || !fitState.memberId) return;
    const groupId = fitState.activeGroupId;
    const memberId = fitState.memberId;
    const memberName = fitState.displayName || "Anonymous";
    const ping = () => {
      pingActiveFn({ data: { groupId, memberId, memberName } }).catch(() => {});
    };
    ping();
    const id = window.setInterval(ping, 20000);
    return () => window.clearInterval(id);
  }, [stage, fitState.activeGroupId, fitState.memberId, fitState.displayName]);

  const setStageBoth = useCallback((s: Stage) => {
    stageRef.current = s;
    setStage(s);
  }, []);

  const clearCheckinTimer = useCallback(() => {
    if (checkinTimerRef.current !== null) {
      window.clearInterval(checkinTimerRef.current);
      checkinTimerRef.current = null;
    }
  }, []);

  const setEmergencyStageBoth = useCallback((s: EmergencyStage | null) => {
    emergencyStageRef.current = s;
    setEmergencyStage(s);
  }, []);

  /** SOS gesture or an unanswered check-in both land here: loud alarm, plus
   * one-tap (never automatic) contact/call/maps actions surfaced in the UI. */
  const triggerAlarm = useCallback(() => {
    clearCheckinTimer();
    setEmergencyStageBoth("alarm");
    playAlarm();
    if (!mutedRef.current) {
      speak("Emergency alert triggered. Please respond, or check on this person.", { force: true });
    }
  }, [clearCheckinTimer, setEmergencyStageBoth]);

  /** No movement seen for a while — ask before escalating, since camera
   * glitches and stepping out of frame are far more common than a real
   * medical event. */
  const beginCheckin = useCallback(() => {
    setEmergencyStageBoth("checking");
    let msLeft = CHECKIN_RESPONSE_MS;
    setCheckinSecondsLeft(Math.ceil(msLeft / 1000));
    if (!mutedRef.current) speak("Are you okay? Please respond.", { force: true });
    clearCheckinTimer();
    checkinTimerRef.current = window.setInterval(() => {
      msLeft -= 1000;
      setCheckinSecondsLeft(Math.max(0, Math.ceil(msLeft / 1000)));
      if (msLeft <= 0) triggerAlarm();
    }, 1000);
  }, [setEmergencyStageBoth, clearCheckinTimer, triggerAlarm]);

  const resolveEmergency = useCallback(() => {
    clearCheckinTimer();
    stopAlarm();
    setEmergencyStageBoth(null);
    inactivityRef.current.markActive();
    sosDetectorRef.current.reset();
  }, [clearCheckinTimer, setEmergencyStageBoth]);

  const stopEverything = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    const v = videoRef.current;
    if (v?.srcObject) {
      (v.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
      v.srcObject = null;
    }
    cancelSpeech();
    clearCheckinTimer();
    stopAlarm();
    emergencyStageRef.current = null;
    setEmergencyStage(null);
  }, [clearCheckinTimer]);

  useEffect(() => () => stopEverything(), [stopEverything]);

  // Lists connected video input devices (webcam, phone/USB/virtual cameras,
  // etc). Safe to call before permission is granted — devices still show up,
  // just without a human-readable label yet.
  const refreshCameras = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setCameras(devices.filter((d) => d.kind === "videoinput"));
    } catch {
      /* enumeration isn't critical — the default camera still works */
    }
  }, []);

  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    void refreshCameras();
    // Picks up cameras plugged in / unplugged mid-session (e.g. a USB webcam).
    navigator.mediaDevices.addEventListener?.("devicechange", refreshCameras);
    return () => navigator.mediaDevices.removeEventListener?.("devicechange", refreshCameras);
  }, [refreshCameras]);

  const buildVideoConstraints = useCallback((deviceId: string): MediaTrackConstraints => {
    const base: MediaTrackConstraints = { width: { ideal: 720 }, height: { ideal: 1280 } };
    // deviceId and facingMode aren't meant to be combined — prefer the exact
    // device when one's picked, otherwise fall back to the front camera.
    return deviceId ? { ...base, deviceId: { exact: deviceId } } : { ...base, facingMode: "user" };
  }, []);

  // Swaps the live camera without touching the pose detector, exercise
  // engine, or session state — only the video track changes. If the person
  // hasn't started a session yet, this just remembers the choice for the
  // next `start()` call.
  const switchCamera = useCallback(
    async (deviceId: string) => {
      const previous = selectedCameraId;
      setSelectedCameraId(deviceId);
      if (mode !== "live" || stage === "idle" || stage === "summary" || stage === "starting") {
        return;
      }
      const v = videoRef.current;
      const oldStream = (v?.srcObject as MediaStream | null) ?? null;
      try {
        const newStream = await navigator.mediaDevices.getUserMedia({
          video: buildVideoConstraints(deviceId),
          audio: false,
        });
        oldStream?.getTracks().forEach((t) => t.stop());
        if (v) {
          v.srcObject = newStream;
          await v.play();
        }
        setNotice(null);
        void refreshCameras();
      } catch {
        // Selected camera became unavailable (unplugged, denied, in use
        // elsewhere) — keep the existing stream running untouched.
        setSelectedCameraId(previous);
        setNotice("Couldn't switch to that camera — keeping the current one.");
      }
    },
    [selectedCameraId, mode, stage, buildVideoConstraints, refreshCameras],
  );

  const resizeCanvas = useCallback(() => {
    const c = canvasRef.current;
    const wrap = wrapRef.current;
    if (!c || !wrap) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = wrap.clientWidth * dpr;
    c.height = wrap.clientHeight * dpr;
    const ctx = c.getContext("2d");
    ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  }, []);

  const draw = useCallback((kp: KP | null, st: FormStatus) => {
    const c = canvasRef.current;
    const wrap = wrapRef.current;
    if (!c || !wrap) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    ctx.clearRect(0, 0, w, h);

    // calibration frame
    if (stageRef.current === "calibrate" || stageRef.current === "countdown") {
      ctx.save();
      ctx.setLineDash([14, 12]);
      ctx.lineWidth = 3;
      ctx.strokeStyle = inFrameSinceRef.current ? "rgba(74,222,128,0.9)" : "rgba(34,211,238,0.8)";
      ctx.strokeRect(w * 0.16, h * 0.06, w * 0.68, h * 0.88);
      ctx.restore();
    }

    if (!kp) return;
    const color =
      st === "warn"
        ? "rgba(248,113,113,0.95)"
        : st === "good"
          ? "rgba(74,222,128,0.95)"
          : "rgba(34,211,238,0.95)";
    ctx.lineWidth = 4;
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    SKELETON.forEach(([a, b]) => {
      const pa = kp[a];
      const pb = kp[b];
      if (!pa || !pb) return;
      if ((pa.score ?? 1) < 0.3 || (pb.score ?? 1) < 0.3) return;
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
    });
    ctx.fillStyle = "rgba(34,211,238,1)";
    Object.values(kp).forEach((p) => {
      if ((p.score ?? 1) < 0.3) return;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.shadowBlur = 0;
  }, []);

  const handleFrameResult = useCallback((kp: KP, side: "left" | "right") => {
    const frame = counterRef.current.update(kp, side);
    framesRef.current.total += 1;
    if (frame.status === "good") framesRef.current.good += 1;
    setMetricLabel(frame.metricLabel);
    setMetricValue(frame.metricValue);
    setStatus(frame.status);
    setMessage(frame.message);
    if (frame.repCompleted) {
      setReps(counterRef.current.reps);
      if (!mutedRef.current) speak(String(counterRef.current.reps), { force: true });
    } else if (frame.status === "warn" && !mutedRef.current) {
      speak(frame.message, { gapMs: 4000 });
    }
    return frame.status;
  }, []);

  const startLoop = useCallback(
    (liveMode: boolean) => {
      const loop = async () => {
        const wrap = wrapRef.current;
        if (!wrap) return;
        const w = wrap.clientWidth;
        const h = wrap.clientHeight;
        let kp: KP | null = null;
        let side: "left" | "right" = sideRef.current ?? "left";

        if (liveMode && detectorRef.current && videoRef.current) {
          try {
            const poses = (await detectorRef.current.estimatePoses(videoRef.current)) as Array<{
              keypoints: Array<{ x: number; y: number; score?: number; name?: string }>;
            }>;
            const pose = poses?.[0];
            if (pose) {
              const vw = videoRef.current.videoWidth || w;
              const vh = videoRef.current.videoHeight || h;
              const scale = Math.max(w / vw, h / vh);
              const offX = (w - vw * scale) / 2;
              const offY = (h - vh * scale) / 2;
              kp = {};
              pose.keypoints.forEach((k) => {
                if (!k.name) return;
                kp![k.name] = {
                  // mirrored preview
                  x: w - (k.x * scale + offX),
                  y: k.y * scale + offY,
                  score: k.score ?? 0,
                };
              });
              // Accumulate left/right confidence while calibrating so we can lock
              // in the tracked side once, instead of recomputing (and risking a
              // flip) on every single frame.
              if (stageRef.current === "calibrate") {
                sideScoresRef.current.left += kp["left_knee"]?.score ?? 0;
                sideScoresRef.current.right += kp["right_knee"]?.score ?? 0;
              }
              // Re-check side confidence during active tracking too (not just
              // once at calibration) — if the locked side goes quiet (e.g. the
              // user turns slightly, or one leg gets occluded) but the other
              // side is clearly better tracked, switch rather than freezing.
              if (stageRef.current === "active" && sideRef.current) {
                const lockedScore = kp[`${sideRef.current}_knee`]?.score ?? 0;
                const otherSide = sideRef.current === "left" ? "right" : "left";
                const otherScore = kp[`${otherSide}_knee`]?.score ?? 0;
                if (lockedScore < 0.25 && otherScore > lockedScore + 0.25) {
                  sideRef.current = otherSide;
                }
              }
              side =
                sideRef.current ??
                ((kp["left_knee"]?.score ?? 0) >= (kp["right_knee"]?.score ?? 0)
                  ? "left"
                  : "right");
              // Lowered from 0.4 — the stricter cutoff was dropping too many
              // frames in normal room lighting or looser clothing, which reads
              // to the user as "it's not detecting my movement".
              const CONF = 0.3;
              const confident = (p?: Pt) => (p?.score ?? 0) > CONF;
              const hip = kp[`${side}_hip`];
              const knee = kp[`${side}_knee`];
              const ankle = kp[`${side}_ankle`];
              const trackingOk =
                !!hip && !!knee && !!ankle && confident(hip) && confident(knee) && confident(ankle);

              if (stageRef.current === "active") {
                if (trackingOk && lowConfStreakRef.current > 45) {
                  setNotice(null);
                }
                lowConfStreakRef.current = trackingOk ? 0 : lowConfStreakRef.current + 1;
                const now = performance.now();
                // ~1.5s of nothing usable, and we haven't already nagged in
                // the last 6s — surface the likely fix instead of just
                // silently failing to count reps.
                if (lowConfStreakRef.current > 45 && now - lastLowConfNoticeRef.current > 6000) {
                  lastLowConfNoticeRef.current = now;
                  setNotice(
                    "Having trouble tracking you — try a plainer background, brighter lighting, and fitted (non-baggy) clothing.",
                  );
                }
              }
            }
          } catch {
            /* skip frame */
          }
        } else {
          kp = simulateSkeleton(exerciseRef.current, performance.now(), w, h);
        }

        if (stageRef.current === "calibrate") {
          const ok = liveMode ? !!kp && REQUIRED.every((n) => (kp![n]?.score ?? 0) > 0.35) : true;
          setInFrame(ok);
          if (ok) {
            if (inFrameSinceRef.current === null) inFrameSinceRef.current = performance.now();
            const bodySteady = performance.now() - inFrameSinceRef.current > 1200;

            if (detectModeRef.current === "auto") {
              if (detectSinceRef.current === null) detectSinceRef.current = performance.now();
              let stableId: ExerciseId | null = null;
              if (kp) {
                stableId = classifierRef.current.push(kp).stable;
              }
              if (stableId) {
                setDetectedExercise(stableId);
                setDetectUnable(false);
                setMessage(`${EXERCISES[stableId].short} detected`);
              } else {
                const waitedMs = performance.now() - (detectSinceRef.current ?? performance.now());
                setDetectUnable(waitedMs > 6000);
                setMessage(
                  waitedMs > 6000
                    ? "Unable to identify exercise — try Manual mode"
                    : "Detecting exercise…",
                );
              }
              // Only lock in once the body has been steady in frame AND the
              // classifier has a confident, stable read — never force a guess.
              if (bodySteady && stableId) {
                exerciseRef.current = stableId;
                setExercise(stableId);
                counterRef.current = createEngine(stableId);
                beginCountdown();
              }
            } else {
              setMessage(
                bodySteady
                  ? "Locked in — hold still"
                  : "Step back so your full body fits the frame",
              );
              if (bodySteady) beginCountdown();
            }
          } else {
            inFrameSinceRef.current = null;
            if (detectModeRef.current === "auto") {
              classifierRef.current.reset();
              detectSinceRef.current = null;
              setDetectedExercise(null);
              setDetectUnable(false);
              setMessage("Step back so your full body fits the frame");
            } else {
              setMessage("Step back so your full body fits the frame");
            }
          }
          draw(kp, "idle");
        } else if (stageRef.current === "active") {
          if (kp) {
            const st = handleFrameResult(kp, side);
            draw(kp, st);
          } else {
            draw(null, "idle");
          }

          // Safety monitoring runs every active frame regardless of
          // exercise/form status, and independently of whether this frame
          // had a usable pose.
          if (emergencyStageRef.current === null && kp && sosDetectorRef.current.update(kp)) {
            triggerAlarm();
          }
          const idleMs = inactivityRef.current.update(kp);
          if (emergencyStageRef.current === null && idleMs > INACTIVITY_TIMEOUT_MS) {
            beginCheckin();
          } else if (emergencyStageRef.current === "checking" && idleMs < 3000) {
            // Movement resumed on its own — no need to wait for a tap.
            resolveEmergency();
          }
        } else {
          draw(kp, "idle");
        }

        if (stageRef.current !== "summary" && stageRef.current !== "idle") {
          rafRef.current = requestAnimationFrame(() => void loop());
        }
      };

      const beginCountdown = () => {
        if (stageRef.current !== "calibrate") return;
        setStageBoth("countdown");
        let n = 3;
        setCountdown(n);
        if (!mutedRef.current) speak("Get ready", { force: true });
        const tick = window.setInterval(() => {
          n -= 1;
          setCountdown(n);
          if (n <= 0) {
            window.clearInterval(tick);
            counterRef.current.reset();
            const scores = sideScoresRef.current;
            sideRef.current = scores.left >= scores.right ? "left" : "right";
            sideScoresRef.current = { left: 0, right: 0 };
            framesRef.current = { total: 0, good: 0 };
            setReps(0);
            startedAtRef.current = Date.now();
            setStageBoth("active");
            if (!mutedRef.current) speak("Go", { force: true });
          } else if (!mutedRef.current) {
            speak(String(n), { force: true });
          }
        }, 900);
      };

      rafRef.current = requestAnimationFrame(() => void loop());
    },
    [draw, handleFrameResult, setStageBoth, triggerAlarm, beginCheckin, resolveEmergency],
  );

  const start = useCallback(async () => {
    setNotice(null);
    setSummary(null);
    setStageBoth("starting");
    resizeCanvas();
    sideRef.current = null;
    sideScoresRef.current = { left: 0, right: 0 };
    lowConfStreakRef.current = 0;
    lastLowConfNoticeRef.current = 0;
    sosDetectorRef.current.reset();
    inactivityRef.current.reset();
    resolveEmergency();
    classifierRef.current.reset();
    detectSinceRef.current = null;
    setDetectedExercise(null);
    setDetectUnable(false);
    // In Auto Mode this is just a placeholder until the classifier locks in
    // a stable exercise and replaces it (see the calibrate branch above).
    counterRef.current = createEngine(exercise);
    let live = true;

    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: buildVideoConstraints(selectedCameraId),
          audio: false,
        });
      } catch (err) {
        if (selectedCameraId) {
          // The chosen camera is gone/denied/in use elsewhere — fall back to
          // the default camera rather than dropping straight to demo mode.
          setSelectedCameraId("");
          stream = await navigator.mediaDevices.getUserMedia({
            video: buildVideoConstraints(""),
            audio: false,
          });
          setNotice("Selected camera wasn't available — switched to the default camera.");
        } else {
          throw err;
        }
      }
      const v = videoRef.current;
      if (!v) throw new Error("no video element");
      v.srcObject = stream;
      await v.play();
      void refreshCameras();
    } catch {
      live = false;
      setNotice(
        "Camera unavailable — running simulated demo tracking so you can still explore the coach.",
      );
    }

    if (live) {
      try {
        const [tf, poseDetection] = await Promise.all([
          import("@tensorflow/tfjs-core"),
          import("@tensorflow-models/pose-detection"),
        ]);
        await import("@tensorflow/tfjs-backend-webgl");
        await tf.setBackend("webgl");
        await tf.ready();
        detectorRef.current = (await poseDetection.createDetector(
          poseDetection.SupportedModels.MoveNet,
          { modelType: "SinglePose.Thunder" },
        )) as unknown as { estimatePoses: (v: HTMLVideoElement) => Promise<unknown> };
      } catch {
        live = false;
        detectorRef.current = null;
        setNotice(
          "Pose model could not load in this browser — switched to simulated demo tracking.",
        );
      }
    }

    setMode(live ? "live" : "demo");
    inFrameSinceRef.current = null;
    setInFrame(false);
    setStageBoth("calibrate");
    startLoop(live);
  }, [
    resizeCanvas,
    setStageBoth,
    startLoop,
    exercise,
    resolveEmergency,
    selectedCameraId,
    buildVideoConstraints,
    refreshCameras,
  ]);

  const finish = useCallback(() => {
    const sec = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000));
    const f = framesRef.current;
    const form = f.total ? Math.round((f.good / f.total) * 100) : 100;
    const done = counterRef.current.reps;
    setSummary({ reps: done, sec, form });
    setStageBoth("summary");
    stopEverything();
    if (done > 0) {
      const exerciseLabel = EXERCISES[exerciseRef.current].label;
      const next = commitSession({
        reps: done,
        durationSec: sec,
        goodFormPct: form,
        exercise: exerciseLabel,
      });
      // Mirror this session onto the group leaderboard, if in one. Fire and
      // forget — the local session is already committed either way, so a
      // flaky connection here never blocks or corrupts the person's own
      // stats.
      if (next.activeGroupId && next.memberId) {
        submitScoreFn({
          data: {
            groupId: next.activeGroupId,
            memberId: next.memberId,
            memberName: next.displayName || "Anonymous",
            totalReps: next.totalReps,
            todayReps: next.todayReps,
            todayKey: next.todayDay ?? todayKey(),
            streak: next.streak,
            sessionReps: done,
            exercise: exerciseLabel,
          },
        }).catch(() => {
          /* best-effort — local stats already saved */
        });
      }
    }
    if (!mutedRef.current) speak(`Session complete. ${done} reps.`, { force: true });
  }, [setStageBoth, stopEverything]);

  useEffect(() => {
    resizeCanvas();
    const onResize = () => resizeCanvas();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [resizeCanvas]);

  const statusColor =
    status === "warn"
      ? "border-formbad/60 bg-formbad/15 text-formbad"
      : status === "good"
        ? "border-formgood/60 bg-formgood/15 text-formgood"
        : "border-primary/50 bg-primary/10 text-primary";

  return (
    <div className="space-y-4">
      {(stage === "idle" || stage === "calibrate") && (
        <div className="flex gap-2">
          {(["auto", "manual"] as const).map((m) => (
            <button
              key={m}
              onClick={() => switchDetectMode(m)}
              className={`flex-1 rounded-full border px-4 py-2 text-xs font-bold uppercase tracking-widest transition-colors ${
                detectMode === m
                  ? "border-primary bg-primary/15 text-primary"
                  : "border-border bg-card/60 text-muted-foreground"
              }`}
            >
              {m === "auto" ? "Auto" : "Manual"}
            </button>
          ))}
        </div>
      )}
      {stage === "idle" && detectMode === "manual" && (
        <div className="flex flex-wrap gap-2">
          {(Object.keys(EXERCISES) as ExerciseId[]).map((id) => (
            <button
              key={id}
              onClick={() => setExercise(id)}
              className={`rounded-full border px-4 py-2 text-xs font-bold uppercase tracking-widest transition-colors ${
                exercise === id
                  ? "border-primary bg-primary/15 text-primary"
                  : "border-border bg-card/60 text-muted-foreground"
              }`}
            >
              {EXERCISES[id].short}
            </button>
          ))}
        </div>
      )}
      {cameras.length > 1 && (
        <div className="flex items-center gap-2 rounded-2xl border border-border/70 bg-card/50 px-3 py-2 text-xs">
          <Camera className="h-3.5 w-3.5 shrink-0 text-primary" />
          <label
            htmlFor="camera-select"
            className="shrink-0 font-semibold uppercase tracking-widest text-muted-foreground"
          >
            Camera
          </label>
          <select
            id="camera-select"
            value={selectedCameraId}
            onChange={(e) => void switchCamera(e.target.value)}
            className="min-w-0 flex-1 truncate bg-transparent text-foreground outline-none"
          >
            <option value="">Default camera</option>
            {cameras.map((cam, i) => (
              <option key={cam.deviceId} value={cam.deviceId}>
                {cam.label || `Camera ${i + 1}`}
              </option>
            ))}
          </select>
        </div>
      )}
      <div
        ref={wrapRef}
        className="relative aspect-[3/4] w-full overflow-hidden rounded-3xl border border-primary/25 bg-black glow-cyan"
      >
        <video
          ref={videoRef}
          playsInline
          muted
          className="absolute inset-0 h-full w-full scale-x-[-1] object-cover"
        />
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

        {/* HUD */}
        {(stage === "active" || stage === "countdown") && (
          <div className="pointer-events-none absolute inset-x-0 top-0 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 p-3">
            <div className="min-w-0 rounded-2xl border border-primary/30 bg-background/70 px-3 py-2 backdrop-blur">
              <p className="text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Reps
              </p>
              <p className="font-display text-5xl font-bold leading-none text-primary text-glow">
                {reps}
              </p>
            </div>
            <div className="shrink-0 rounded-2xl border border-accent/30 bg-background/70 px-3 py-2 text-right backdrop-blur">
              <p className="text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                {metricLabel}
              </p>
              <p className="font-display text-2xl font-bold leading-none text-accent">
                {metricValue}°
              </p>
            </div>
          </div>
        )}

        {stage === "active" && (
          <div className="pointer-events-none absolute inset-x-3 bottom-3">
            <div
              className={`flex items-center gap-2 rounded-2xl border px-3 py-2 text-sm font-semibold backdrop-blur ${statusColor}`}
            >
              {status === "warn" ? (
                <AlertTriangle className="h-4 w-4 shrink-0" />
              ) : (
                <CheckCircle2 className="h-4 w-4 shrink-0" />
              )}
              <span className="truncate">{message}</span>
            </div>
          </div>
        )}

        {stage === "countdown" && (
          <div className="absolute inset-0 grid place-items-center bg-background/45 backdrop-blur-sm">
            <p className="font-display text-8xl font-bold text-primary text-glow">
              {countdown > 0 ? countdown : "GO"}
            </p>
          </div>
        )}

        {stage === "calibrate" && (
          <div className="absolute inset-x-3 bottom-3">
            <div
              className={`rounded-2xl border px-3 py-2 text-center text-sm font-semibold backdrop-blur ${
                detectedExercise
                  ? "border-formgood/60 bg-formgood/15 text-formgood"
                  : detectUnable
                    ? "border-formbad/60 bg-formbad/15 text-formbad"
                    : inFrame
                      ? "border-formgood/60 bg-formgood/15 text-formgood"
                      : "border-primary/50 bg-background/70 text-primary"
              }`}
            >
              {!inFrame
                ? "Step back into the frame"
                : detectMode === "manual"
                  ? "Full body detected — hold still"
                  : detectedExercise
                    ? `${EXERCISES[detectedExercise].short} detected — hold still`
                    : detectUnable
                      ? "Unable to identify exercise — try Manual mode"
                      : "Detecting exercise…"}
            </div>
          </div>
        )}

        {stage === "starting" && (
          <div className="absolute inset-0 grid place-items-center gap-2 bg-background/70 p-6 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">
              Requesting camera and loading the on-device pose model…
            </p>
          </div>
        )}

        {stage === "idle" && (
          <div className="absolute inset-0 grid place-content-center gap-3 p-6 text-center">
            <Camera className="mx-auto h-10 w-10 text-primary" />
            <p className="font-display text-lg font-bold uppercase tracking-widest text-foreground">
              {detectMode === "auto"
                ? "Auto exercise coach"
                : `${EXERCISES[exercise].label} form coach`}
            </p>
            <p className="text-sm text-muted-foreground">
              {detectMode === "auto"
                ? "Fit your full body in frame and start moving — the coach detects which exercise you're doing."
                : "Prop your phone up and fit your full body in the frame."}
            </p>
            <ul className="mx-auto mt-1 space-y-1 text-left text-xs text-muted-foreground">
              {detectMode === "manual" &&
                EXERCISES[exercise].setupTips.map((tip) => <li key={tip}>· {tip}</li>)}
              <li>· Plain, uncluttered background</li>
              <li>· Bright, even lighting on your body</li>
              <li>· Fitted clothing — baggy fabric hides your joints</li>
            </ul>
            <p className="mt-2 text-[0.65rem] text-accent">
              In trouble mid-session? Raise both arms overhead and cross them like an &quot;X&quot;
              three times for an SOS alert.
            </p>
          </div>
        )}

        {stage === "summary" && summary && (
          <div className="absolute inset-0 grid place-content-center gap-2 bg-background/85 p-6 text-center">
            <Sparkles className="mx-auto h-8 w-8 text-accent" />
            <p className="font-display text-4xl font-bold text-primary text-glow">
              {summary.reps} reps
            </p>
            <p className="text-sm text-muted-foreground">
              {Math.floor(summary.sec / 60)}m {summary.sec % 60}s · {summary.form}% good form
            </p>
            <p className="text-xs text-formgood">Saved to your streak and league progress.</p>
          </div>
        )}

        {mode === "demo" && stage !== "idle" && (
          <span className="absolute left-1/2 top-3 -translate-x-1/2 rounded-full border border-accent/50 bg-background/80 px-2 py-1 text-[0.6rem] font-bold uppercase tracking-widest text-accent">
            Demo tracking
          </span>
        )}
      </div>

      {emergencyStage && (
        <EmergencyOverlay
          stage={emergencyStage}
          contacts={fitState.emergencyContacts}
          secondsLeft={checkinSecondsLeft}
          onImOk={resolveEmergency}
          onDismiss={resolveEmergency}
        />
      )}

      {notice && (
        <p className="flex items-start gap-2 rounded-2xl border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {notice}
        </p>
      )}

      {stage === "idle" && detectMode === "manual" && (
        <div className="rounded-2xl border border-border/70 bg-card/50 p-4">
          <p className="font-display text-sm font-bold uppercase tracking-widest text-accent">
            {EXERCISES[exercise].label} rep rules
          </p>
          <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
            {EXERCISES[exercise].ruleLines.map((line) => (
              <li key={line}>· {line}</li>
            ))}
          </ul>
        </div>
      )}
      {stage === "idle" && detectMode === "auto" && (
        <div className="rounded-2xl border border-border/70 bg-card/50 p-4">
          <p className="font-display text-sm font-bold uppercase tracking-widest text-accent">
            Supported exercises
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            {(Object.keys(EXERCISES) as ExerciseId[]).map((id) => EXERCISES[id].label).join(" · ")}
          </p>
        </div>
      )}

      <div className="flex gap-3">
        {stage === "idle" || stage === "summary" ? (
          <button
            onClick={() => void start()}
            className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-4 font-display text-sm font-bold uppercase tracking-widest text-primary-foreground glow-cyan active:scale-[0.98]"
          >
            {stage === "summary" ? <RotateCcw className="h-5 w-5" /> : <Play className="h-5 w-5" />}
            {stage === "summary" ? "New session" : "Start calibration"}
          </button>
        ) : (
          <button
            onClick={finish}
            disabled={stage === "starting"}
            className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-destructive px-4 py-4 font-display text-sm font-bold uppercase tracking-widest text-foreground disabled:opacity-50 active:scale-[0.98]"
          >
            <Square className="h-5 w-5" />
            End session
          </button>
        )}
      </div>
    </div>
  );
}
