import { createFileRoute, Link } from "@tanstack/react-router";
import { Flame, ShieldCheck, Shield, Trophy, Users } from "lucide-react";
import { useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { SafetyGate } from "@/components/SafetyGate";
import { useFitState, type WorkoutLog } from "@/lib/fitStore";

export const Route = createFileRoute("/progress")({
  head: () => ({
    meta: [
      { title: "Progress & League — FIT LEAGUE AI Gamified Tracker" },
      {
        name: "description",
        content:
          "Track your Campus Legend rank, daily goal rings, squat streak and campus community kudos in FIT LEAGUE AI.",
      },
      { property: "og:title", content: "Progress & League — FIT LEAGUE AI" },
      {
        property: "og:description",
        content: "Campus Legend rank, streak badges, daily goal rings and community kudos.",
      },
    ],
  }),
  component: ProgressPage,
});

function ProgressPage() {
  const [state, setState] = useFitState();
  const [editingSafety, setEditingSafety] = useState(false);
  const goalPct = Math.min(100, Math.round((state.todayReps / state.dailyGoal) * 100));

  return (
    <div className="mx-auto min-h-screen max-w-md pb-28">
      <AppHeader subtitle="Your league standing & streaks" />

      <div className="space-y-4 px-5">
        {/* Profile card */}
        <section className="rounded-3xl border border-primary/30 bg-gradient-to-br from-card to-card/40 p-5 glow-cyan">
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-4">
            <div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl border border-accent/50 bg-accent/15 text-accent">
              <Shield className="h-8 w-8" />
            </div>
            <div className="min-w-0">
              <p className="text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Campus Legend Rank
              </p>
              <p className="font-display text-4xl font-bold leading-none text-primary text-glow">
                {state.rank}
              </p>
              <p className="mt-1 truncate text-xs text-muted-foreground">
                {100 - state.rankProgress} pts to Rank {state.rank + 1}
              </p>
            </div>
          </div>
          <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-gradient-to-r from-primary to-accent transition-all"
              style={{ width: `${state.rankProgress}%` }}
            />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Metric
              icon={<Flame className="h-4 w-4 text-accent" />}
              label="Current streak"
              value={`${state.streak} Days`}
            />
            <Metric
              icon={<Trophy className="h-4 w-4 text-primary" />}
              label="Total reps"
              value={state.totalReps.toLocaleString()}
            />
          </div>
        </section>

        {/* Rings */}
        <section className="rounded-3xl border border-border/70 bg-card/60 p-5">
          <p className="font-display text-sm font-bold uppercase tracking-widest text-foreground">
            Daily goals
          </p>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <Ring label="Reps" pct={goalPct} value={`${state.todayReps}/${state.dailyGoal}`} color="var(--neon)" />
            <Ring
              label="Streak"
              pct={Math.min(100, (state.streak / 30) * 100)}
              value={`${state.streak}/30`}
              color="var(--energy)"
            />
            <Ring
              label="Form"
              pct={state.logs[0]?.goodFormPct ?? 0}
              value={`${state.logs[0]?.goodFormPct ?? 0}%`}
              color="var(--formgood)"
            />
          </div>
          <div className="mt-4 w-full rounded-xl border border-primary/40 bg-primary/10 py-2 text-center">
            <p className="text-xs font-semibold uppercase tracking-widest text-primary">
              Daily goal: {state.dailyGoal} reps
            </p>
            <p className="mt-0.5 text-[0.65rem] text-muted-foreground">
              Adapts to your last 7 days of sessions — keep logging to fine-tune it
            </p>
          </div>
        </section>

        {/* Safety */}
        <section className="rounded-3xl border border-border/70 bg-card/60 p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-accent" />
              <p className="font-display text-sm font-bold uppercase tracking-widest text-foreground">
                Safety
              </p>
            </div>
            <button
              onClick={() => setEditingSafety(true)}
              className="rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-widest text-primary"
            >
              Edit
            </button>
          </div>
          {state.emergencyContacts.length > 0 ? (
            <div className="mt-3 space-y-1.5">
              {state.emergencyContacts.map((c) => (
                <p key={c.id} className="text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">{c.name}</span> · {c.phone}
                </p>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">No emergency contacts saved yet.</p>
          )}
          <p className="mt-2 text-[0.65rem] text-muted-foreground">
            An SOS gesture or a stretch of no detected movement during a session surfaces one-tap
            text/call actions to these contacts. Nothing is ever sent automatically.
          </p>
        </section>

        {editingSafety && (
          <SafetyGate
            mode="edit"
            existingContacts={state.emergencyContacts}
            onDone={() => setEditingSafety(false)}
          />
        )}

        {/* Workout log */}
        <section className="rounded-3xl border border-border/70 bg-card/60 p-5">
          <p className="font-display text-sm font-bold uppercase tracking-widest text-foreground">
            Workout log
          </p>
          <div className="mt-3 space-y-2">
            {state.logs.length === 0 && (
              <p className="text-xs text-muted-foreground">No sessions yet — start a workout.</p>
            )}
            {state.logs.map((log) => (
              <LogRow key={log.id} log={log} />
            ))}
          </div>
        </section>

        {/* Group */}
        <section className="rounded-3xl border border-border/70 bg-card/60 p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-accent" />
              <p className="font-display text-sm font-bold uppercase tracking-widest text-foreground">
                Your group
              </p>
            </div>
            <Link
              to="/league"
              className="rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-widest text-primary"
            >
              {state.activeGroupId ? "View" : "Join / create"}
            </Link>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {state.activeGroupId
              ? `Training with "${state.activeGroupName}" — head to the League tab for the live leaderboard.`
              : "Add friends, form a group, and turn sessions into a studio workout with a shared leaderboard."}
          </p>
        </section>

        <p className="pb-2 text-center text-[0.65rem] leading-relaxed text-muted-foreground">
          Camera access and pose estimation run entirely on this device. Progress is stored in your
          browser’s local storage.
        </p>
      </div>
    </div>
  );
}

function Metric({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-border/70 bg-background/40 px-3 py-3">
      <div className="flex items-center gap-1.5">
        {icon}
        <p className="truncate text-[0.6rem] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
          {label}
        </p>
      </div>
      <p className="mt-1 font-display text-lg font-bold text-foreground">{value}</p>
    </div>
  );
}

function Ring({
  label,
  pct,
  value,
  color,
}: {
  label: string;
  pct: number;
  value: string;
  color: string;
}) {
  const r = 30;
  const circ = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative h-[76px] w-[76px]">
        <svg viewBox="0 0 76 76" className="h-full w-full -rotate-90">
          <circle cx="38" cy="38" r={r} fill="none" stroke="var(--muted)" strokeWidth="7" />
          <circle
            cx="38"
            cy="38"
            r={r}
            fill="none"
            stroke={color}
            strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={circ}
            strokeDashoffset={circ - (circ * clamped) / 100}
            style={{ transition: "stroke-dashoffset 500ms ease" }}
          />
        </svg>
        <span className="absolute inset-0 grid place-items-center font-display text-xs font-bold text-foreground">
          {Math.round(clamped)}%
        </span>
      </div>
      <p className="text-[0.6rem] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
        {label}
      </p>
      <p className="text-[0.65rem] text-muted-foreground">{value}</p>
    </div>
  );
}

function LogRow({ log }: { log: WorkoutLog }) {
  const d = new Date(log.date);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-border/60 bg-background/40 px-3 py-2.5">
      <div className="min-w-0">
        <p className="truncate font-display text-sm font-bold text-foreground">{log.exercise}</p>
        <p className="truncate text-[0.7rem] text-muted-foreground">
          {d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ·{" "}
          {Math.floor(log.durationSec / 60)}m {log.durationSec % 60}s · {log.goodFormPct}% form
        </p>
      </div>
      <p className="shrink-0 font-display text-xl font-bold text-primary">{log.reps}</p>
    </div>
  );
}


