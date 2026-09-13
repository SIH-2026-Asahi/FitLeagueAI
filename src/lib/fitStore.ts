import { useCallback, useEffect, useState } from "react";

export type WorkoutLog = {
  id: string;
  date: string; // ISO
  exercise: string;
  reps: number;
  durationSec: number;
  goodFormPct: number;
};

export type EmergencyContact = {
  id: string;
  name: string;
  phone: string;
};

export type FitState = {
  totalReps: number;
  rank: number;
  rankProgress: number; // 0..100 toward next rank
  streak: number;
  lastWorkoutDay: string | null; // YYYY-MM-DD
  dailyGoal: number;
  todayReps: number;
  todayDay: string | null;
  muted: boolean;
  logs: WorkoutLog[];
  kudosGiven: string[];
  /** ISO timestamp of when the person agreed to the injury-risk waiver, or
   * null if they haven't yet — sessions are gated on this being set. */
  safetyConsentAt: string | null;
  emergencyContacts: EmergencyContact[];
  /** Anonymous, device-local identity used for groups — there's no login
   * system in this app, so this is what tells the server "this is the same
   * person" between requests. Generated once on first use, never shown. */
  memberId: string;
  /** Name shown to group members on the leaderboard. */
  displayName: string;
  activeGroupId: string | null;
  activeGroupCode: string | null;
  activeGroupName: string | null;
};

const KEY = "fitleague.state.v1";

// Previously seeded with fake demo numbers (1284 reps, 12-day streak, 3
// sample logs) that showed even for a brand-new user. Stats should only
// ever reflect sessions the user has actually completed.
export const defaultState: FitState = {
  totalReps: 0,
  rank: 1,
  rankProgress: 0,
  streak: 0,
  lastWorkoutDay: null,
  dailyGoal: 60,
  todayReps: 0,
  todayDay: null,
  muted: false,
  logs: [],
  kudosGiven: [],
  safetyConsentAt: null,
  emergencyContacts: [],
  memberId: "",
  displayName: "",
  activeGroupId: null,
  activeGroupCode: null,
  activeGroupName: null,
};

export function todayKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

/** Records that the person agreed to the injury-risk waiver and saves their
 * emergency contacts. Called from the safety gate, both on first setup and
 * whenever contacts are edited later. */
export function recordSafetyConsent(contacts: EmergencyContact[]) {
  return updateFitState({
    safetyConsentAt: new Date().toISOString(),
    emergencyContacts: contacts,
  });
}

function makeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Returns the device's group-identity id, creating and persisting one on
 * first call. Client-only (no-op id if called during SSR). */
export function ensureMemberId(): string {
  const existing = current().memberId;
  if (existing) return existing;
  const id = makeId();
  updateFitState({ memberId: id });
  return id;
}

export function setDisplayName(name: string) {
  return updateFitState({ displayName: name.trim().slice(0, 24) });
}

/** Records which group this device is currently training with, or clears it
 * when `group` is null (leaving). The server is the source of truth for
 * membership/scores — this just remembers which group to reconnect to. */
export function setActiveGroup(group: { id: string; code: string; name: string } | null) {
  return updateFitState({
    activeGroupId: group?.id ?? null,
    activeGroupCode: group?.code ?? null,
    activeGroupName: group?.name ?? null,
  });
}

function read(): FitState {
  if (typeof window === "undefined") return defaultState;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return defaultState;
    const parsed = JSON.parse(raw) as Partial<FitState>;
    return { ...defaultState, ...parsed };
  } catch {
    return defaultState;
  }
}

function write(state: FitState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable */
  }
}

const listeners = new Set<(s: FitState) => void>();
let memory: FitState | null = null;

function current(): FitState {
  if (memory === null) memory = read();
  return memory;
}

export function updateFitState(patch: Partial<FitState> | ((s: FitState) => Partial<FitState>)) {
  const base = current();
  const next: FitState = { ...base, ...(typeof patch === "function" ? patch(base) : patch) };
  memory = next;
  write(next);
  listeners.forEach((l) => l(next));
  return next;
}

/** Hook that reads persisted state after hydration (SSR-safe). */
export function useFitState() {
  const [state, setState] = useState<FitState>(defaultState);

  useEffect(() => {
    memory = read();
    setState(memory);
    const l = (s: FitState) => setState(s);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);

  const set = useCallback(
    (patch: Partial<FitState> | ((s: FitState) => Partial<FitState>)) => updateFitState(patch),
    [],
  );

  return [state, set] as const;
}

// The daily goal used to be a flat number the user manually flipped between
// two hardcoded values (60 or 100) — it didn't reflect what the person was
// actually capable of. It now tracks a rolling window of their own recent
// days, so someone who's been clearing 40 reps/day isn't stuck chasing a
// goal built for someone else, and someone consistently blowing past 60
// gets nudged upward instead of coasting.
const GOAL_LOOKBACK_DAYS = 7;
const GOAL_STRETCH = 1.1; // aim a bit above the recent average, not a flat repeat
const GOAL_BLEND = 0.5; // blend with the prior goal so one big/quiet day can't swing it wildly
const MIN_DAILY_GOAL = 20;
const MAX_DAILY_GOAL = 300;

/** Total reps per distinct calendar day from the log history, most recent
 * first, excluding `excludeDay` (today — still in progress, so it isn't a
 * finished data point yet). */
function recentDailyTotals(logs: WorkoutLog[], excludeDay: string, days = GOAL_LOOKBACK_DAYS): number[] {
  const byDay = new Map<string, number>();
  for (const log of logs) {
    const day = log.date.slice(0, 10);
    if (day === excludeDay) continue;
    byDay.set(day, (byDay.get(day) ?? 0) + log.reps);
  }
  return Array.from(byDay.entries())
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .slice(0, days)
    .map(([, total]) => total);
}

/** Recompute the daily goal from actual completed days rather than a fixed
 * number. No history yet (brand-new user) keeps the current goal as-is. */
export function computeAdaptiveGoal(logs: WorkoutLog[], currentGoal: number, today: string): number {
  const totals = recentDailyTotals(logs, today);
  if (totals.length === 0) return currentGoal;
  const avg = totals.reduce((a, b) => a + b, 0) / totals.length;
  const target = avg * GOAL_STRETCH;
  const blended = currentGoal * (1 - GOAL_BLEND) + target * GOAL_BLEND;
  const rounded = Math.round(blended / 5) * 5;
  return Math.min(MAX_DAILY_GOAL, Math.max(MIN_DAILY_GOAL, rounded));
}

/** Commit a finished session: reps, streak, rank progress, adaptive daily
 * goal and a log entry. */
export function commitSession(input: {
  reps: number;
  durationSec: number;
  goodFormPct: number;
  exercise: string;
}) {
  return updateFitState((s) => {
    const day = todayKey();
    const yesterday = todayKey(new Date(Date.now() - 86400000));
    let streak = s.streak;
    if (s.lastWorkoutDay !== day) {
      streak = s.lastWorkoutDay === yesterday || s.lastWorkoutDay === null ? s.streak + 1 : 1;
    }
    const gained = input.reps * 1.5;
    let rank = s.rank;
    let rankProgress = s.rankProgress + gained;
    while (rankProgress >= 100) {
      rankProgress -= 100;
      rank += 1;
    }
    const todayReps = (s.todayDay === day ? s.todayReps : 0) + input.reps;
    const dailyGoal = computeAdaptiveGoal(s.logs, s.dailyGoal, day);

    const log: WorkoutLog = {
      id: `${Date.now()}`,
      date: new Date().toISOString(),
      exercise: input.exercise,
      reps: input.reps,
      durationSec: input.durationSec,
      goodFormPct: input.goodFormPct,
    };

    return {
      totalReps: s.totalReps + input.reps,
      streak,
      lastWorkoutDay: day,
      rank,
      rankProgress: Math.round(rankProgress),
      todayReps,
      todayDay: day,
      dailyGoal,
      logs: [log, ...s.logs].slice(0, 25),
    };
  });
}
