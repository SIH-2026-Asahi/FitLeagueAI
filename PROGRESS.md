# FitLeague AI — Feature Progress

Tracks the feature backlog across multiple chat sessions. Each session:
upload the latest zip, say "continue with feature N", get an updated zip back.

## Backlog (as given by user)
2. Not detecting reps/body movement reliably
3. Modify the angle-detection logic
4. Add different types of workouts/exercises (3-4)
5. Auto-detect which exercise the person is doing
6. Adjust rep count based on actual performance (not fixed thresholds)
7. Streak/stats should reflect actual performance, not demo data
8. Friends/groups ("studio workout") + leaderboard
9. On-screen instructions: plain background, good lighting, non-baggy clothes

## Status

### ✅ Done — Round 7 (this drop)
- **External camera selection**, not on the original numbered backlog, added
  directly per request:
  - `PoseCoach.tsx` now calls `navigator.mediaDevices.enumerateDevices()` on
    mount and on `devicechange`, and shows a small "Camera" dropdown (only
    when more than one video input exists) listing each device's label —
    falling back to "Camera 1", "Camera 2", etc. if labels aren't populated
    yet (browsers only expose labels after permission has been granted at
    least once).
  - Picking a camera before starting just remembers the choice for the next
    `start()` call. Picking one **during** an active/calibrating session
    stops only the old `MediaStream`'s tracks and swaps in the new stream on
    the same `<video>` element — the pose detector, rep counter, and canvas
    overlay are untouched, so switching cameras mid-set doesn't reset reps or
    recalibrate.
  - Graceful fallback throughout: if the selected device is gone/denied/busy,
    `start()` retries with the default camera and posts a notice; a failed
    mid-session `switchCamera` keeps the existing stream running and reverts
    the dropdown selection rather than dropping to demo mode.
  - No new dependencies; existing `getUserMedia`/stream-cleanup logic reused.

### ✅ Done — Round 6 (this drop)
- **#9 On-screen setup instructions** (plain background, good lighting,
  non-baggy clothes) — these tips already existed as small bullets buried
  under the idle screen's per-exercise setup tip, easy to miss. Added a
  persistent "For best tracking" banner at the top of the workout page
  (`routes/index.tsx`) so it's visible before the camera even starts,
  regardless of session stage; left the original idle-screen bullets in
  place too as a second reminder right before someone taps start.

### ✅ Done — Round 5 (this drop)
- **#8 Friends/groups/leaderboard ("studio workout")**, the item flagged last
  round as needing its own session:
  - **No accounts, on purpose** — the rest of the app has no login system
    (see `fitStore.ts`), so joining a group doesn't ask for one either. Each
    device gets a random anonymous `memberId` on first use (`fitStore.ts` →
    `ensureMemberId`) plus a display name you pick; that pair is your
    identity within a group.
  - **Groups live on the server, not localStorage** (`src/lib/groups.ts`,
    new `createServerFn`s: create/join/leave/get/submitScore/pingActive/
    sendKudos) — an in-memory Map keyed by group id and a 6-character join
    code. This is what makes it a *real* shared leaderboard instead of
    everyone seeing their own local copy. **Caveat, stated plainly for
    judges:** it's in-memory, not a database — a redeploy or a cold start
    resets it, and on multi-instance hosting a request can land on a
    different isolate than the group was created on. It's genuinely enough
    for everyone opening the app together on one running deployment (a
    studio session); swap the Map for Cloudflare KV/D1/Postgres before
    depending on groups outliving that.
  - **Studio feel**: `PoseCoach.tsx` pings the server every 20s while a
    session is `"active"` so other members see a live "Live" dot on the
    leaderboard, and posts the session's reps to the group the moment
    `commitSession` runs locally (fire-and-forget — a failed post never
    blocks or corrupts the person's own local stats).
  - **New `/league` route**: set your name, create a group (get a share
    code) or join one by code, see a weekly leaderboard (resets itself
    Monday, no cron needed — see `weekKey` in `groups.ts`) plus all-time
    totals and streaks, and send friends a kudos heart.
  - **Replaced the fake "Campus wall"** on the progress page — it was four
    hardcoded names with invented stats, honestly labeled "Simulated
    community activity" but still fabricated. It's now a real card that
    reflects your actual group (or a prompt to join one), matching round
    3's "stats should reflect real performance" principle.
  - Privacy note updated in both the workout screen and `/league`: joining a
    group shares your name, rep counts, streak and workout type with other
    members — the camera feed itself never leaves the device, unchanged
    from before.

### ✅ Done — Round 4
- **Injury-safety flow**, judge-facing ask (not on the original numbered
  backlog, added directly):
  1. **Consent gate** (`SafetyGate.tsx`, mode `"gate"`): blocks the workout
     screen until the person checks an at-your-own-risk acknowledgment and
     saves at least one emergency contact (name + phone, up to 3). Recorded
     as `safetyConsentAt` + `emergencyContacts` in `fitStore.ts`. Editable
     any time from a new "Safety" card on the progress page (`mode="edit"`).
  2. **SOS gesture** (`lib/safety.ts` → `SosGestureDetector`): the pose
     model (MoveNet) tracks body joints only, not fingers, so a literal
     open/close fist isn't detectable — this uses the same wrist/shoulder/
     hip keypoints already tracked for every exercise instead. Raising both
     arms overhead and crossing them like an "X" three times within 8s
     triggers the alarm immediately. It's deliberately unlike any of the
     four workouts' normal motion so it won't false-trigger mid-set.
  3. **Inactivity check** (`lib/safety.ts` → `InactivityMonitor`): tracks
     average per-joint movement (normalized by torso length, so it's
     resolution/distance independent) during an active session. ~90s of
     essentially no movement surfaces an "Are you OK?" prompt with a 20s
     response window (`EmergencyOverlay.tsx`, stage `"checking"`); no
     response escalates to the same full alarm as the gesture. Movement
     resuming on its own during the check-in cancels it automatically.
  - **Alarm** (`lib/alarm.ts`): synthesized siren via Web Audio (no audio
    asset to fetch/fail) plus a vibration pattern. Loudness is still capped
    by the device's own volume/silent switch — nothing can override that.
  - **Emergency actions are one-tap, never automatic** (per your call this
    round): the alarm screen surfaces `tel:`/`sms:` links pre-filled per
    contact, a best-effort local-emergency-number button (guessed from
    browser locale, clearly labeled as a guess to confirm), and a "nearby
    hospitals" Google Maps link using geolocation when granted. There's no
    real API for live ambulance availability anywhere, and actually
    auto-sending requires a backend telephony service (e.g. Twilio) this
    app doesn't have — flagged so it isn't quietly overclaimed to judges.
  - Every escalation has a prominent "I'm OK" / "cancel alarm" action, and
    ending a session clears any in-progress alarm.

### ✅ Done — Round 3
- **#6:** Daily rep goal is now adaptive instead of a manual 60/100 toggle.
  `computeAdaptiveGoal` in `fitStore.ts` looks at the last 7 distinct
  calendar days of logged sessions, aims ~10% above that average, and
  blends it with the previous goal (50/50) so one unusually big or quiet
  day can't swing it wildly. It's clamped to 20–300 reps and recalculates
  every time a session is committed. Brand-new users with no log history
  keep the 60-rep default until they've logged something. The progress
  page's goal ring now shows this as a read-only status ("Adapts to your
  last 7 days of sessions") instead of a manual switch.

### ✅ Done — Round 2
- **#4:** Added three more exercises alongside squats — **Lunges**, **Jumping
  Jacks**, and **High Knees**. Replaced the squat-only `squatEngine.ts` with
  a general `exercises.ts` that any exercise plugs into:
  - Lunges reuse the squat's knee-angle rep logic (deeper threshold) plus a
    new "knee past your toes" horizontal-offset check squats don't need.
  - Jumping Jacks use a genuinely different signal pair — arm-raise angle
    (shoulder-hip-wrist) and leg-spread ratio (ankle distance ÷ shoulder
    width, so it's scale-invariant) — instead of a single leg angle.
  - High Knees track hip flexion (shoulder-hip-knee) rather than knee bend,
    since a high knee can hit almost any knee angle depending on how tucked
    the lower leg is.
  - Added an exercise picker (pill buttons) to the idle screen; the HUD's
    secondary metric label/value and the "rep rules" tips are now dynamic
    per exercise instead of hardcoded to "Knee angle" / squat rules.
  - Session logs now record the actual exercise name (`fitStore.ts` no
    longer hardcodes "Squats").
  - Adaptive-threshold calibration (round 1's fix) carries over to all four
    exercises, not just squats.

### ⏳ Pending
- **#5** Auto-detecting which exercise is being performed — now unblocked
  since 4 exercise engines exist; needs a classifier step before
  calibration locks in a specific engine
- Groups persistence: the in-memory store from round 5 needs a real
  datastore wired in (Cloudflare KV/D1 are the natural fit given the
  Cloudflare build target) before groups can be relied on to survive a
  redeploy

## Notes / decisions
- Detection fixes are calibration-based (adapts per session), not a full
  model replacement — no way to guarantee 100% accuracy without live device
  testing, so please test on your actual phone and report back what's still
  off (e.g. "still misses reps at the top" vs "still misses at the bottom"),
  and which of the 4 exercises it's on, so the next round can tune the
  right threshold.
- Jumping Jacks and High Knees are new enough that they'd benefit most from
  real-device feedback — the thresholds are reasoned from body proportions,
  not tuned against footage.
