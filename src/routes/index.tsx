import { createFileRoute, ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { Info, Lightbulb, Loader2, Volume2, VolumeX } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { SafetyGate } from "@/components/SafetyGate";
import { useFitState } from "@/lib/fitStore";

const PoseCoach = lazy(() => import("@/components/PoseCoach"));

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Workout Coach — FIT LEAGUE AI Form Tracker" },
      {
        name: "description",
        content:
          "Train squats, lunges, jumping jacks and high knees with an in-browser AI form coach: live skeleton tracking, rep counting, joint-angle metrics and spoken corrections.",
      },
      { property: "og:title", content: "Workout Coach — FIT LEAGUE AI" },
      {
        property: "og:description",
        content:
          "Live pose-estimation multi-exercise coaching with rep counting, form alerts and voice cues — all on-device.",
      },
    ],
  }),
  component: WorkoutPage,
});

function WorkoutPage() {
  const [state, setState] = useFitState();

  return (
    <div className="mx-auto min-h-screen max-w-md pb-28">
      <AppHeader subtitle="Workout session · on-device form coach" />

      {!state.safetyConsentAt && (
        <ClientOnly>
          <SafetyGate mode="gate" existingContacts={state.emergencyContacts} onDone={() => {}} />
        </ClientOnly>
      )}

      <div className="px-5">
        <div className="mb-4 flex items-start gap-2.5 rounded-2xl border border-accent/40 bg-accent/10 px-4 py-3">
          <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
          <div className="min-w-0 text-xs leading-relaxed text-foreground">
            <p className="font-display text-[0.65rem] font-bold uppercase tracking-widest text-accent">
              For best tracking
            </p>
            <p className="mt-0.5 text-muted-foreground">
              Plain background · good, even lighting · fitted clothes — baggy fabric hides your
              joints from the camera.
            </p>
          </div>
        </div>

        <div className="mb-4 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-border/70 bg-card/60 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate font-display text-sm font-bold uppercase tracking-widest text-foreground">
              Voice coaching
            </p>
            <p className="truncate text-xs text-muted-foreground">
              Spoken rep counts and corrections
            </p>
          </div>
          <button
            onClick={() => setState({ muted: !state.muted })}
            aria-label={state.muted ? "Unmute voice coaching" : "Mute voice coaching"}
            className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl border transition-colors ${
              state.muted
                ? "border-border bg-muted text-muted-foreground"
                : "border-primary/50 bg-primary/15 text-primary"
            }`}
          >
            {state.muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
          </button>
        </div>

        <ClientOnly
          fallback={
            <div className="grid aspect-[3/4] w-full place-items-center rounded-3xl border border-primary/25 bg-card/50">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          }
        >
          <Suspense
            fallback={
              <div className="grid aspect-[3/4] w-full place-items-center rounded-3xl border border-primary/25 bg-card/50">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            }
          >
            <PoseCoach muted={state.muted} />
          </Suspense>
        </ClientOnly>

        <div className="mt-4 grid grid-cols-3 gap-3">
          <Stat label="Today" value={state.todayReps} />
          <Stat label="Streak" value={`${state.streak}d`} />
          <Stat label="Total" value={state.totalReps} />
        </div>

        <p className="mt-4 flex items-start gap-2 rounded-2xl border border-border/70 bg-card/50 px-3 py-3 text-xs leading-relaxed text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          Your camera feed and all pose estimation run locally in your browser — no video frames
          are ever uploaded or stored.{" "}
          {state.activeGroupId
            ? `Since you're in "${state.activeGroupName}", finishing a session also shares your name, rep count, streak and exercise with that group's leaderboard.`
            : "Rep totals are saved on this device, and shared with a group's leaderboard only if you join one."}
        </p>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-card/60 px-3 py-3 text-center">
      <p className="font-display text-xl font-bold text-foreground">{value}</p>
      <p className="mt-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
        {label}
      </p>
    </div>
  );
}
