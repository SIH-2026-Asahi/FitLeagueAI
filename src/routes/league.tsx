import { createFileRoute, ClientOnly } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Check, Copy, Flame, Heart, LogOut, Radio, Trophy, UserPlus, Users } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import {
  ensureMemberId,
  setActiveGroup,
  setDisplayName,
  todayKey,
  useFitState,
} from "@/lib/fitStore";
import {
  createGroupFn,
  getGroupFn,
  joinGroupFn,
  leaveGroupFn,
  sendKudosFn,
  weekKey,
  type GroupSnapshot,
} from "@/lib/groups";

export const Route = createFileRoute("/league")({
  head: () => ({
    meta: [
      { title: "League — Friends & Studio Leaderboard | FIT LEAGUE AI" },
      {
        name: "description",
        content: "Add friends, form a group, and turn workouts into a shared studio-class leaderboard.",
      },
    ],
  }),
  component: LeaguePage,
});

const LIVE_WINDOW_MS = 45_000;

function LeaguePage() {
  return (
    <div className="mx-auto min-h-screen max-w-md pb-28">
      <AppHeader subtitle="Friends, groups & studio leaderboard" />
      <div className="px-5">
        <ClientOnly
          fallback={<div className="h-40 animate-pulse rounded-3xl border border-border/70 bg-card/40" />}
        >
          <LeagueBody />
        </ClientOnly>
      </div>
    </div>
  );
}

function LeagueBody() {
  const [state, setState] = useFitState();
  const queryClient = useQueryClient();
  const [nameDraft, setNameDraft] = useState(state.displayName);
  const [groupNameDraft, setGroupNameDraft] = useState("");
  const [codeDraft, setCodeDraft] = useState("");
  const [busy, setBusy] = useState<"create" | "join" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    ensureMemberId();
  }, []);

  useEffect(() => {
    setNameDraft(state.displayName);
  }, [state.displayName]);

  const groupId = state.activeGroupId;

  const groupQuery = useQuery({
    queryKey: ["group", groupId],
    queryFn: () => getGroupFn({ data: { groupId: groupId! } }),
    enabled: !!groupId,
    refetchInterval: 6000,
  });

  const commitName = () => {
    const trimmed = nameDraft.trim();
    if (trimmed && trimmed !== state.displayName) setDisplayName(trimmed);
  };

  const requireName = (): string | null => {
    const trimmed = nameDraft.trim();
    if (!trimmed) {
      setError("Add your name first so friends know who's who on the leaderboard.");
      return null;
    }
    commitName();
    return trimmed;
  };

  const handleCreate = async () => {
    const name = requireName();
    if (!name) return;
    if (!groupNameDraft.trim()) {
      setError("Give your group a name.");
      return;
    }
    setError(null);
    setBusy("create");
    try {
      const memberId = ensureMemberId();
      const group = await createGroupFn({
        data: { memberId, memberName: name, groupName: groupNameDraft.trim() },
      });
      setActiveGroup({ id: group.id, code: group.code, name: group.name });
      queryClient.setQueryData(["group", group.id], group);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create the group. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const handleJoin = async () => {
    const name = requireName();
    if (!name) return;
    if (!codeDraft.trim()) {
      setError("Enter the 6-character code a friend shared with you.");
      return;
    }
    setError(null);
    setBusy("join");
    try {
      const memberId = ensureMemberId();
      const group = await joinGroupFn({
        data: { memberId, memberName: name, code: codeDraft.trim() },
      });
      setActiveGroup({ id: group.id, code: group.code, name: group.name });
      queryClient.setQueryData(["group", group.id], group);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't join that group. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const handleLeave = async () => {
    if (!groupId) return;
    const memberId = ensureMemberId();
    setActiveGroup(null);
    queryClient.removeQueries({ queryKey: ["group", groupId] });
    try {
      await leaveGroupFn({ data: { groupId, memberId } });
    } catch {
      /* best-effort — we already left locally */
    }
  };

  const copyCode = async () => {
    if (!state.activeGroupCode) return;
    try {
      await navigator.clipboard.writeText(state.activeGroupCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — the code is already shown on screen */
    }
  };

  if (!groupId) {
    return (
      <div className="space-y-4">
        <NameCard nameDraft={nameDraft} onChange={setNameDraft} onBlur={commitName} />

        <section className="rounded-3xl border border-primary/30 bg-gradient-to-br from-card to-card/40 p-5 glow-cyan">
          <div className="flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-primary" />
            <p className="font-display text-sm font-bold uppercase tracking-widest text-foreground">
              Create a group
            </p>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Start a studio — friends join with a code and everyone's reps show up live.
          </p>
          <input
            value={groupNameDraft}
            onChange={(e) => setGroupNameDraft(e.target.value)}
            placeholder="Group name, e.g. Saturday Squad"
            maxLength={40}
            className="mt-3 w-full rounded-xl border border-border/70 bg-background/60 px-3 py-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/60"
          />
          <button
            onClick={handleCreate}
            disabled={busy !== null}
            className="mt-3 w-full rounded-xl bg-primary py-2.5 text-sm font-semibold uppercase tracking-widest text-primary-foreground disabled:opacity-60"
          >
            {busy === "create" ? "Creating…" : "Create group"}
          </button>
        </section>

        <section className="rounded-3xl border border-border/70 bg-card/60 p-5">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-accent" />
            <p className="font-display text-sm font-bold uppercase tracking-widest text-foreground">
              Join a group
            </p>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Got a code from a friend? Drop it in.</p>
          <input
            value={codeDraft}
            onChange={(e) => setCodeDraft(e.target.value.toUpperCase())}
            placeholder="e.g. F8K3QZ"
            maxLength={6}
            className="mt-3 w-full rounded-xl border border-border/70 bg-background/60 px-3 py-2.5 text-center font-display text-lg tracking-[0.3em] text-foreground outline-none placeholder:tracking-normal placeholder:text-muted-foreground focus:border-accent/60"
          />
          <button
            onClick={handleJoin}
            disabled={busy !== null}
            className="mt-3 w-full rounded-xl border border-accent/50 bg-accent/15 py-2.5 text-sm font-semibold uppercase tracking-widest text-accent disabled:opacity-60"
          >
            {busy === "join" ? "Joining…" : "Join group"}
          </button>
        </section>

        {error && (
          <p className="rounded-xl border border-formbad/40 bg-formbad/10 px-3 py-2 text-xs text-formbad">
            {error}
          </p>
        )}

        <p className="pb-2 text-center text-[0.65rem] leading-relaxed text-muted-foreground">
          Joining a group shares your name, rep counts, streak and workout type with the other
          members — never your camera feed, which always stays on-device.
        </p>
      </div>
    );
  }

  const snapshot: GroupSnapshot | null | undefined = groupQuery.data;
  const myId = ensureMemberId();
  const currentWeek = weekKey();
  const today = todayKey();

  return (
    <div className="space-y-4">
      <NameCard nameDraft={nameDraft} onChange={setNameDraft} onBlur={commitName} />

      <section className="rounded-3xl border border-primary/30 bg-gradient-to-br from-card to-card/40 p-5 glow-cyan">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Your studio
            </p>
            <p className="truncate font-display text-xl font-bold text-primary text-glow">
              {state.activeGroupName}
            </p>
          </div>
          <button
            onClick={handleLeave}
            aria-label="Leave group"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-border/70 bg-background/40 text-muted-foreground"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-background/40 px-3 py-2.5">
          <div className="min-w-0">
            <p className="text-[0.6rem] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
              Invite code
            </p>
            <p className="font-display text-lg font-bold tracking-[0.3em] text-foreground">
              {state.activeGroupCode}
            </p>
          </div>
          <button
            onClick={copyCode}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-[0.65rem] font-semibold uppercase tracking-widest text-primary"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <p className="mt-2 text-[0.65rem] text-muted-foreground">
          Share this code — friends join from the League tab with it.
        </p>
      </section>

      <section className="rounded-3xl border border-border/70 bg-card/60 p-5">
        <div className="flex items-center gap-2">
          <Trophy className="h-4 w-4 text-primary" />
          <p className="font-display text-sm font-bold uppercase tracking-widest text-foreground">
            Leaderboard · this week
          </p>
        </div>
        {groupQuery.isLoading && (
          <p className="mt-3 text-xs text-muted-foreground">Loading group…</p>
        )}
        {groupQuery.isError && (
          <p className="mt-3 text-xs text-formbad">Couldn't reach the leaderboard — retrying…</p>
        )}
        {snapshot === null && (
          <p className="mt-3 text-xs text-muted-foreground">
            This group isn't on the server anymore — it may have reset. You can leave and create a
            new one.
          </p>
        )}
        {snapshot && (
          <div className="mt-3 space-y-2">
            {[...snapshot.members]
              .sort((a, b) => {
                const aw = a.weekKey === currentWeek ? a.weekReps : 0;
                const bw = b.weekKey === currentWeek ? b.weekReps : 0;
                return bw - aw;
              })
              .map((m, i) => (
                <MemberRow
                  key={m.id}
                  rank={i + 1}
                  member={m}
                  isMe={m.id === myId}
                  isLive={Date.now() - new Date(m.lastActiveAt).getTime() < LIVE_WINDOW_MS}
                  weekReps={m.weekKey === currentWeek ? m.weekReps : 0}
                  todayReps={m.dayKey === today ? m.todayReps : 0}
                  kudosGiven={state.kudosGiven.includes(`${groupId}:${m.id}`)}
                  onKudos={async () => {
                    if (m.id === myId) return;
                    setState((s) => ({
                      kudosGiven: s.kudosGiven.includes(`${groupId}:${m.id}`)
                        ? s.kudosGiven
                        : [...s.kudosGiven, `${groupId}:${m.id}`],
                    }));
                    try {
                      const updated = await sendKudosFn({
                        data: { groupId, targetMemberId: m.id },
                      });
                      queryClient.setQueryData(["group", groupId], updated);
                    } catch {
                      /* best-effort cheer */
                    }
                  }}
                />
              ))}
          </div>
        )}
      </section>

      <p className="pb-2 text-center text-[0.65rem] leading-relaxed text-muted-foreground">
        Your camera feed never leaves this device — only your name, rep counts, streak and workout
        type are shared with your group.
      </p>
    </div>
  );
}

function NameCard({
  nameDraft,
  onChange,
  onBlur,
}: {
  nameDraft: string;
  onChange: (v: string) => void;
  onBlur: () => void;
}) {
  return (
    <section className="rounded-2xl border border-border/70 bg-card/60 px-4 py-3">
      <p className="text-[0.6rem] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
        Your name on the leaderboard
      </p>
      <input
        value={nameDraft}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder="e.g. Jordan"
        maxLength={24}
        className="mt-1.5 w-full bg-transparent font-display text-base font-bold text-foreground outline-none placeholder:font-normal placeholder:text-muted-foreground"
      />
    </section>
  );
}

function MemberRow({
  rank,
  member,
  isMe,
  isLive,
  weekReps,
  todayReps,
  kudosGiven,
  onKudos,
}: {
  rank: number;
  member: { id: string; name: string; streak: number; kudos: number; totalReps: number };
  isMe: boolean;
  isLive: boolean;
  weekReps: number;
  todayReps: number;
  kudosGiven: boolean;
  onKudos: () => void;
}) {
  return (
    <div
      className={`grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-3 rounded-2xl border px-3 py-2.5 ${
        isMe ? "border-primary/50 bg-primary/10" : "border-border/60 bg-background/40"
      }`}
    >
      <span className="grid h-7 w-7 shrink-0 place-items-center font-display text-xs font-bold text-muted-foreground">
        {rank}
      </span>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="truncate font-display text-sm font-bold text-foreground">
            {member.name}
            {isMe && <span className="ml-1 text-[0.65rem] font-semibold text-primary">(you)</span>}
          </p>
          {isLive && (
            <span className="flex shrink-0 items-center gap-0.5 rounded-full border border-formgood/50 bg-formgood/10 px-1.5 py-0.5 text-[0.55rem] font-semibold uppercase tracking-wider text-formgood">
              <Radio className="h-2.5 w-2.5" />
              Live
            </span>
          )}
        </div>
        <p className="truncate text-[0.7rem] text-muted-foreground">
          {todayReps} today · {member.totalReps.toLocaleString()} total
          {member.streak > 0 && (
            <>
              {" "}
              · <Flame className="mb-0.5 inline h-3 w-3 text-accent" /> {member.streak}d
            </>
          )}
        </p>
      </div>
      <p className="shrink-0 font-display text-lg font-bold text-primary">{weekReps}</p>
      <button
        onClick={onKudos}
        disabled={isMe}
        aria-label={`Give kudos to ${member.name}`}
        className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl border transition-transform ${
          kudosGiven
            ? "border-formgood/60 bg-formgood/15 text-formgood"
            : "border-border bg-background/40 text-muted-foreground"
        } ${isMe ? "opacity-30" : ""}`}
      >
        <Heart className={`h-4 w-4 ${kudosGiven ? "fill-current" : ""}`} />
        {member.kudos > 0 && <span className="sr-only">{member.kudos} kudos</span>}
      </button>
    </div>
  );
}
