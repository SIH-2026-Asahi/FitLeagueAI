// Synthesized with Web Audio instead of an audio file, so there's no asset
// to fetch and nothing that can fail to load. Loudness is still capped by
// the device's own volume — this can't force full volume or override a
// silent switch.
let audioCtx: AudioContext | null = null;
let oscillators: OscillatorNode[] = [];
let vibrateTimer: number | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!audioCtx || audioCtx.state === "closed") audioCtx = new Ctor();
  return audioCtx;
}

/** Starts a looping two-tone siren and a repeating vibration pattern. Safe
 * to call repeatedly — it no-ops if already playing. */
export function playAlarm() {
  if (oscillators.length > 0) return;
  const ctx = getCtx();
  if (ctx) {
    if (ctx.state === "suspended") void ctx.resume();
    const gain = ctx.createGain();
    gain.gain.value = 0.35;
    gain.connect(ctx.destination);

    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.setValueAtTime(700, ctx.currentTime);
    // Sweep between two tones for a siren effect rather than a flat beep,
    // which reads as an alarm rather than a notification chime.
    const now = ctx.currentTime;
    for (let t = 0; t < 60; t += 0.6) {
      osc.frequency.setValueAtTime(t % 1.2 < 0.6 ? 880 : 660, now + t);
    }
    osc.connect(gain);
    osc.start();
    oscillators = [osc];
  }

  if (typeof navigator !== "undefined" && navigator.vibrate) {
    const pattern = [400, 200, 400, 200, 400, 600];
    navigator.vibrate(pattern);
    const cycle = pattern.reduce((a, b) => a + b, 0);
    vibrateTimer = window.setInterval(() => navigator.vibrate(pattern), cycle);
  }
}

export function stopAlarm() {
  oscillators.forEach((o) => {
    try {
      o.stop();
    } catch {
      /* already stopped */
    }
  });
  oscillators = [];
  if (vibrateTimer !== null) {
    window.clearInterval(vibrateTimer);
    vibrateTimer = null;
  }
  if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(0);
}

/** Best-effort local emergency number from the browser's locale. There is
 * no reliable way to know a device's actual country (locale ≠ location), so
 * this is a fallback guess only — the UI must let the person confirm or
 * change it, never dial silently. */
export function guessEmergencyNumber(): string {
  if (typeof navigator === "undefined") return "112";
  const region = (navigator.language || "en-US").split("-")[1]?.toUpperCase();
  const byRegion: Record<string, string> = {
    US: "911",
    CA: "911",
    MX: "911",
    IN: "112",
    GB: "999",
    AU: "000",
    NZ: "111",
    JP: "119",
  };
  return byRegion[region ?? ""] ?? "112"; // 112 works as a fallback in most GSM networks
}

/** Opens a Google Maps search for nearby hospitals, using the device's
 * location when available. Never blocks on it — falls back to a plain
 * search if location isn't granted in time. */
export function nearbyHospitalsUrl(): Promise<string> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve("https://www.google.com/maps/search/hospital+near+me");
      return;
    }
    const fallback = window.setTimeout(
      () => resolve("https://www.google.com/maps/search/hospital+near+me"),
      4000,
    );
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        window.clearTimeout(fallback);
        const { latitude, longitude } = pos.coords;
        resolve(`https://www.google.com/maps/search/hospital/@${latitude},${longitude},15z`);
      },
      () => {
        window.clearTimeout(fallback);
        resolve("https://www.google.com/maps/search/hospital+near+me");
      },
      { timeout: 3500, maximumAge: 60_000 },
    );
  });
}

/** sms: URI. iOS wants `&body=`, Android/most others want `?body=` — this
 * covers the common case; the person still has to review and hit send. */
export function smsLink(phone: string, body: string): string {
  return `sms:${phone}?body=${encodeURIComponent(body)}`;
}

export function telLink(phone: string): string {
  return `tel:${phone}`;
}
