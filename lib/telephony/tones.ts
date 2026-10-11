/**
 * Call-progress tones the browser plays itself (client-only; every function is a no-op without Web
 * Audio). Ringback while the far end rings, unless the provider's early media already carries it, and
 * a short busy tone when the number is busy. Frequencies are the North American call-progress pair
 * (ringback 440+480 Hz, busy 480+620 Hz); they are quiet on purpose.
 */

type Tone = { frequencies: number[]; onMs: number; offMs: number; cycles: number };

export const RINGBACK: Tone = { frequencies: [440, 480], onMs: 2000, offMs: 4000, cycles: 30 };
export const BUSY: Tone = { frequencies: [480, 620], onMs: 500, offMs: 500, cycles: 3 };
const VOLUME = 0.06;

type AudioContextCtor = typeof AudioContext;

function contextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null;
  return window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext ?? null;
}

/** Starts the tone; the returned function stops it. Safe to call stop more than once. */
export function playTone(tone: Tone): () => void {
  const Ctor = contextCtor();
  if (!Ctor) return () => {};
  let context: AudioContext;
  try {
    context = new Ctor();
  } catch {
    return () => {};
  }
  const gain = context.createGain();
  gain.gain.value = 0;
  gain.connect(context.destination);
  const oscillators = tone.frequencies.map((frequency) => {
    const oscillator = context.createOscillator();
    oscillator.frequency.value = frequency;
    oscillator.connect(gain);
    oscillator.start();
    return oscillator;
  });
  const start = context.currentTime;
  for (let i = 0; i < tone.cycles; i++) {
    const on = start + (i * (tone.onMs + tone.offMs)) / 1000;
    gain.gain.setValueAtTime(VOLUME, on);
    gain.gain.setValueAtTime(0, on + tone.onMs / 1000);
  }
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    try {
      oscillators.forEach((oscillator) => oscillator.stop());
      void context.close();
    } catch {
      // Already closed.
    }
  };
}
