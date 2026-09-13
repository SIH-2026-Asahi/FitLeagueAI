import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// ---------------------------------------------------------------------------
// "Studio" groups — friends, a shared leaderboard, live-presence pings.
//
// There is no accounts system or database anywhere in this project (see
// fitStore.ts: everything else lives in the browser's localStorage), so this
// keeps group membership and scores in a plain in-memory Map on the running
// server instead of standing up real infrastructure for it.
//
// That's genuinely enough for the intended use case — open the deployed app
// on a few phones in the same room (or share the join code with friends) and
// everyone shows up on a live-updating leaderboard, like a studio class.
// What it is NOT is durable: a redeploy, a cold start, or a request landing
// on a different server instance/isolate can reset or fragment this data.
// Before relying on groups surviving longer than a single hangout, swap this
// Map for a real store (Cloudflare KV/D1, Postgres, etc.).
// ---------------------------------------------------------------------------

export type GroupMember = {
  id: string;
  name: string;
  joinedAt: string;
  totalReps: number;
  todayReps: number;
  dayKey: string | null;
  weekReps: number;
  weekKey: string;
  streak: number;
  kudos: number;
  lastExercise: string | null;
  lastActiveAt: string;
};

type Group = {
  id: string;
  code: string;
  name: string;
  createdAt: string;
  members: Record<string, GroupMember>;
};

export type GroupSnapshot = Omit<Group, "members"> & { members: GroupMember[] };

const groups = new Map<string, Group>();
const codeToId = new Map<string, string>();

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I ambiguity

function genCode(): string {
  let code: string;
  do {
    code = Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join(
      "",
    );
  } while (codeToId.has(code));
  return code;
}

function genId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Monday of the ISO week containing `d`, as YYYY-MM-DD — used to reset each
 * member's weekly rep count without needing a cron job. Exported so the UI
 * can independently tell whether a member's stored weekReps is stale (they
 * haven't logged a session yet this week). */
export function weekKey(d = new Date()): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay(); // 0 Sun .. 6 Sat
  const diff = (day + 6) % 7; // days since Monday
  date.setUTCDate(date.getUTCDate() - diff);
  return date.toISOString().slice(0, 10);
}

function newMember(id: string, name: string): GroupMember {
  const now = new Date().toISOString();
  return {
    id,
    name,
    joinedAt: now,
    totalReps: 0,
    todayReps: 0,
    dayKey: null,
    weekReps: 0,
    weekKey: weekKey(),
    streak: 0,
    kudos: 0,
    lastExercise: null,
    lastActiveAt: now,
  };
}

function toSnapshot(g: Group): GroupSnapshot {
  return { ...g, members: Object.values(g.members).sort((a, b) => b.totalReps - a.totalReps) };
}

function requireGroup(groupId: string): Group {
  const group = groups.get(groupId);
  if (!group) {
    throw new Error("This group isn't on the server anymore — it may have reset. Try creating a new one.");
  }
  return group;
}

const identity = z.object({
  memberId: z.string().min(1),
  memberName: z.string().trim().min(1).max(24),
});

export const createGroupFn = createServerFn({ method: "POST" })
  .validator(identity.extend({ groupName: z.string().trim().min(1).max(40) }))
  .handler(async ({ data }) => {
    const id = genId();
    const code = genCode();
    const group: Group = {
      id,
      code,
      name: data.groupName,
      createdAt: new Date().toISOString(),
      members: { [data.memberId]: newMember(data.memberId, data.memberName) },
    };
    groups.set(id, group);
    codeToId.set(code, id);
    return toSnapshot(group);
  });

export const joinGroupFn = createServerFn({ method: "POST" })
  .validator(identity.extend({ code: z.string().trim().min(1).max(12) }))
  .handler(async ({ data }) => {
    const normalizedCode = data.code.toUpperCase();
    const groupId = codeToId.get(normalizedCode);
    const group = groupId ? groups.get(groupId) : undefined;
    if (!group) throw new Error("No group found for that code — double check it with whoever shared it.");
    const existing = group.members[data.memberId];
    group.members[data.memberId] = existing
      ? { ...existing, name: data.memberName }
      : newMember(data.memberId, data.memberName);
    return toSnapshot(group);
  });

export const leaveGroupFn = createServerFn({ method: "POST" })
  .validator(z.object({ groupId: z.string().min(1), memberId: z.string().min(1) }))
  .handler(async ({ data }) => {
    const group = groups.get(data.groupId);
    if (!group) return { ok: true };
    delete group.members[data.memberId];
    if (Object.keys(group.members).length === 0) {
      groups.delete(group.id);
      codeToId.delete(group.code);
    }
    return { ok: true };
  });

export const getGroupFn = createServerFn({ method: "GET" })
  .validator(z.object({ groupId: z.string().min(1) }))
  .handler(async ({ data }) => {
    const group = groups.get(data.groupId);
    return group ? toSnapshot(group) : null;
  });

/** Called after a workout session is committed locally — mirrors the
 * device's authoritative totals onto the group and adds this session's reps
 * to the group's weekly tally (which resets itself on the first submission
 * of a new week). */
export const submitScoreFn = createServerFn({ method: "POST" })
  .validator(
    identity.extend({
      groupId: z.string().min(1),
      totalReps: z.number().min(0),
      todayReps: z.number().min(0),
      todayKey: z.string(),
      streak: z.number().min(0),
      sessionReps: z.number().min(0),
      exercise: z.string(),
    }),
  )
  .handler(async ({ data }) => {
    const group = requireGroup(data.groupId);
    const existing = group.members[data.memberId] ?? newMember(data.memberId, data.memberName);
    const wk = weekKey();
    const weekReps = existing.weekKey === wk ? existing.weekReps + data.sessionReps : data.sessionReps;
    group.members[data.memberId] = {
      ...existing,
      name: data.memberName,
      totalReps: data.totalReps,
      todayReps: data.todayReps,
      dayKey: data.todayKey,
      weekReps,
      weekKey: wk,
      streak: data.streak,
      lastExercise: data.exercise,
      lastActiveAt: new Date().toISOString(),
    };
    return toSnapshot(group);
  });

/** Lightweight heartbeat sent while a session is actively running, purely so
 * other members can see a "live now" dot — the studio-workout feel. */
export const pingActiveFn = createServerFn({ method: "POST" })
  .validator(identity.extend({ groupId: z.string().min(1) }))
  .handler(async ({ data }) => {
    const group = groups.get(data.groupId);
    if (!group) return { ok: false };
    const existing = group.members[data.memberId] ?? newMember(data.memberId, data.memberName);
    group.members[data.memberId] = {
      ...existing,
      name: data.memberName,
      lastActiveAt: new Date().toISOString(),
    };
    return { ok: true };
  });

export const sendKudosFn = createServerFn({ method: "POST" })
  .validator(z.object({ groupId: z.string().min(1), targetMemberId: z.string().min(1) }))
  .handler(async ({ data }) => {
    const group = requireGroup(data.groupId);
    const target = group.members[data.targetMemberId];
    if (!target) throw new Error("That member isn't in this group anymore.");
    target.kudos += 1;
    return toSnapshot(group);
  });
