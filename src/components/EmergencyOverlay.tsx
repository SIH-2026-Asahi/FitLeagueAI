import { useEffect, useState } from "react";
import { AlertOctagon, MapPin, MessageCircle, Phone } from "lucide-react";
import type { EmergencyContact } from "@/lib/fitStore";
import { guessEmergencyNumber, nearbyHospitalsUrl, smsLink, telLink } from "@/lib/alarm";

export type EmergencyStage = "checking" | "alarm";

export function EmergencyOverlay({
  stage,
  contacts,
  secondsLeft,
  onImOk,
  onDismiss,
}: {
  stage: EmergencyStage;
  contacts: EmergencyContact[];
  /** Countdown shown during "checking" before it escalates to "alarm". */
  secondsLeft: number;
  onImOk: () => void;
  onDismiss: () => void;
}) {
  const [hospitalsUrl, setHospitalsUrl] = useState<string | null>(null);
  const emergencyNumber = guessEmergencyNumber();

  useEffect(() => {
    if (stage !== "alarm") return;
    let cancelled = false;
    void nearbyHospitalsUrl().then((url) => {
      if (!cancelled) setHospitalsUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [stage]);

  const message =
    "This is an automated check from FitLeague AI — I may need help during a workout. Location: ";

  if (stage === "checking") {
    return (
      <div className="fixed inset-0 z-[70] grid place-items-center bg-background/90 p-6 text-center backdrop-blur-sm">
        <div className="w-full max-w-sm rounded-3xl border border-accent/60 bg-card p-6">
          <AlertOctagon className="mx-auto h-9 w-9 text-accent" />
          <p className="mt-3 font-display text-lg font-bold uppercase tracking-widest text-foreground">
            Still there?
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            We haven&apos;t seen you move in a bit. Checking in — no response in{" "}
            <span className="font-bold text-accent">{secondsLeft}s</span> will surface your
            emergency contacts.
          </p>
          <button
            onClick={onImOk}
            className="mt-5 w-full rounded-2xl bg-accent px-4 py-3 font-display text-sm font-bold uppercase tracking-widest text-background"
          >
            I&apos;m OK
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[70] overflow-y-auto bg-destructive/95 p-5 text-center">
      <div className="mx-auto max-w-sm">
        <AlertOctagon className="mx-auto h-10 w-10 animate-pulse text-foreground" />
        <p className="mt-3 font-display text-2xl font-bold uppercase tracking-widest text-foreground">
          SOS
        </p>
        <p className="mt-1 text-sm text-foreground/90">
          If this is a real emergency, call your local emergency number now.
        </p>

        <a
          href={telLink(emergencyNumber)}
          className="mt-4 flex items-center justify-center gap-2 rounded-2xl border-2 border-foreground bg-foreground px-4 py-4 font-display text-base font-bold uppercase tracking-widest text-destructive"
        >
          <Phone className="h-5 w-5" /> Call {emergencyNumber}
        </a>
        <p className="mt-1 text-[0.65rem] text-foreground/70">
          Guessed from your device settings — dial your actual local emergency number if this
          isn&apos;t right.
        </p>

        {contacts.length > 0 && (
          <div className="mt-4 space-y-2 text-left">
            <p className="text-xs font-semibold uppercase tracking-widest text-foreground/80">
              Emergency contacts
            </p>
            {contacts.map((c) => (
              <div
                key={c.id}
                className="flex items-center gap-2 rounded-2xl border border-foreground/30 bg-background/10 p-2.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-foreground">{c.name}</p>
                  <p className="truncate text-xs text-foreground/70">{c.phone}</p>
                </div>
                <a
                  href={smsLink(c.phone, message)}
                  aria-label={`Text ${c.name}`}
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-foreground/15 text-foreground"
                >
                  <MessageCircle className="h-5 w-5" />
                </a>
                <a
                  href={telLink(c.phone)}
                  aria-label={`Call ${c.name}`}
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-foreground/15 text-foreground"
                >
                  <Phone className="h-5 w-5" />
                </a>
              </div>
            ))}
          </div>
        )}

        <a
          href={hospitalsUrl ?? "https://www.google.com/maps/search/hospital+near+me"}
          target="_blank"
          rel="noreferrer"
          className="mt-4 flex items-center justify-center gap-2 rounded-2xl border border-foreground/40 px-4 py-3 text-sm font-semibold uppercase tracking-widest text-foreground"
        >
          <MapPin className="h-4 w-4" /> Nearby hospitals
        </a>

        <button
          onClick={onDismiss}
          className="mt-5 w-full rounded-2xl bg-background/20 px-4 py-3 font-display text-sm font-bold uppercase tracking-widest text-foreground"
        >
          I&apos;m OK — cancel alarm
        </button>
      </div>
    </div>
  );
}
