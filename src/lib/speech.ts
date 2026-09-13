let lastSpoken = "";
let lastAt = 0;

export function speak(text: string, opts?: { force?: boolean; gapMs?: number }) {
  if (typeof window === "undefined") return;
  const synth = window.speechSynthesis;
  if (!synth) return;
  const now = Date.now();
  const gap = opts?.gapMs ?? 2500;
  if (!opts?.force && text === lastSpoken && now - lastAt < gap) return;
  lastSpoken = text;
  lastAt = now;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05;
    u.pitch = 1;
    u.volume = 1;
    synth.speak(u);
  } catch {
    /* speech unavailable */
  }
}

export function cancelSpeech() {
  if (typeof window === "undefined") return;
  try {
    window.speechSynthesis?.cancel();
  } catch {
    /* noop */
  }
}
