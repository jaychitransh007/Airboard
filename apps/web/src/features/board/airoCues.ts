/**
 * Short, quiet sounds that tell a presenter what Airo did without looking at
 * the panel: it heard a command, applied it, couldn't, or is asking. They are
 * synthesized (no audio files) and kept soft, since Meet may pick up tab audio.
 */

export type AiroCue = "heard" | "applied" | "failed" | "question";

const SOUNDS_KEY = "airboard.sounds.v1";

/** Notes per cue: [frequency Hz, start offset s, duration s]. */
const CUE_NOTES: Readonly<Record<AiroCue, readonly (readonly [number, number, number])[]>> = {
  heard: [[880, 0, 0.06]],
  applied: [[660, 0, 0.08], [990, 0.09, 0.12]],
  failed: [[392, 0, 0.12], [294, 0.13, 0.16]],
  question: [[660, 0, 0.08], [880, 0.1, 0.08], [1100, 0.2, 0.1]],
};

const CUE_VOLUME = 0.05;

let context: AudioContext | null = null;

export function airoSoundsEnabled(): boolean {
  try {
    return window.localStorage.getItem(SOUNDS_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setAiroSoundsEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(SOUNDS_KEY, enabled ? "on" : "off");
  } catch {
    // Best-effort preference.
  }
}

export function playAiroCue(cue: AiroCue): void {
  if (typeof window === "undefined" || !airoSoundsEnabled()) return;
  const AudioContextClass =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return;
  try {
    context ??= new AudioContextClass();
    if (context.state === "suspended") {
      // Browsers start audio suspended until the page has been used; a
      // refused resume just means this cue stays silent.
      void context.resume().catch(() => undefined);
    }
    const start = context.currentTime + 0.01;
    for (const [frequency, offset, duration] of CUE_NOTES[cue]) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      const noteStart = start + offset;
      gain.gain.setValueAtTime(0, noteStart);
      gain.gain.linearRampToValueAtTime(CUE_VOLUME, noteStart + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, noteStart + duration);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(noteStart);
      oscillator.stop(noteStart + duration + 0.02);
    }
  } catch {
    // Sound is a nicety; never let it break a command.
  }
}
