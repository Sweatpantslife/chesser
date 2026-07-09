import { useSettings } from '../store/settings';

/**
 * Chesser sound design — a cohesive, playful set synthesised with Web Audio.
 * No audio files: every cue is built from a small palette of C-pentatonic
 * notes (C/D/E/G/A) with soft envelopes, so the whole app shares one musical
 * identity while shipping zero bytes of audio.
 *
 * Every public function is gated on the user's "Sounds" setting, and gains
 * are kept low (≤0.09) so cues stay friendly, never startling.
 */
let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx ??= new Ctor();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function enabled(): boolean {
  return useSettings.getState().sound;
}

interface NoteOpts {
  /** Start offset in seconds from now. */
  at?: number;
  dur?: number;
  type?: OscillatorType;
  gain?: number;
  /** Glide to this frequency over the note's duration. */
  glideTo?: number;
}

/** One soft-envelope oscillator note. */
function note(freq: number, { at = 0, dur = 0.12, type = 'sine', gain = 0.05, glideTo }: NoteOpts = {}): void {
  const c = audio();
  if (!c) return;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  const t = c.currentTime + at;
  osc.frequency.setValueAtTime(freq, t);
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
  osc.connect(g);
  g.connect(c.destination);
  // Quick attack, exponential release — soft and clicky-free.
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

/** Short filtered-noise burst (thumps, whooshes, crackles). */
function noise(dur: number, { at = 0, gain = 0.04, freq = 800, q = 1, rampTo }: { at?: number; gain?: number; freq?: number; q?: number; rampTo?: number } = {}): void {
  const c = audio();
  if (!c) return;
  const t = c.currentTime + at;
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const filter = c.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(freq, t);
  if (rampTo) filter.frequency.exponentialRampToValueAtTime(rampTo, t + dur);
  filter.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(filter);
  filter.connect(g);
  g.connect(c.destination);
  src.start(t);
  src.stop(t + dur);
}

// Pentatonic palette (C5 base) — every cue draws from these.
const C5 = 523.25, D5 = 587.33, E5 = 659.25, G5 = 783.99, A5 = 880, C6 = 1046.5, E6 = 1318.5, G6 = 1568;

// — Board sounds —

/** Quiet piece placement: soft wooden "thock". */
function move(): void {
  note(196, { dur: 0.055, type: 'sine', gain: 0.055, glideTo: 165 });
  noise(0.03, { gain: 0.018, freq: 2200, q: 0.8 });
}

function capture(): void {
  note(140, { dur: 0.09, type: 'triangle', gain: 0.075, glideTo: 100 });
  noise(0.06, { gain: 0.03, freq: 900, q: 0.7 });
}

function castle(): void {
  note(196, { dur: 0.05, gain: 0.05 });
  note(247, { at: 0.07, dur: 0.05, gain: 0.05 });
}

function check(): void {
  note(E5, { dur: 0.07, type: 'triangle', gain: 0.05 });
  note(G5, { at: 0.08, dur: 0.1, type: 'triangle', gain: 0.05 });
}

function promotion(): void {
  note(C5, { dur: 0.08, gain: 0.045 });
  note(E5, { at: 0.07, dur: 0.08, gain: 0.045 });
  note(G5, { at: 0.14, dur: 0.14, gain: 0.05 });
}

function checkmate(): void {
  note(C5, { dur: 0.1, type: 'triangle', gain: 0.055 });
  note(E5, { at: 0.09, dur: 0.1, type: 'triangle', gain: 0.055 });
  note(G5, { at: 0.18, dur: 0.1, type: 'triangle', gain: 0.055 });
  note(C6, { at: 0.27, dur: 0.28, type: 'triangle', gain: 0.06 });
}

// — Reward & app sounds —

const CUES = {
  /** Barely-there tick for tab/nav/toggle interactions. */
  uiClick(): void {
    note(1250, { dur: 0.03, gain: 0.02 });
  },
  gameStart(): void {
    note(C5, { dur: 0.08, gain: 0.045 });
    note(G5, { at: 0.09, dur: 0.14, gain: 0.05 });
  },
  gameWin(): void {
    checkmate();
    note(E6, { at: 0.4, dur: 0.2, gain: 0.035 });
  },
  gameLoss(): void {
    note(E5, { dur: 0.14, type: 'triangle', gain: 0.045 });
    note(C5, { at: 0.13, dur: 0.22, type: 'triangle', gain: 0.045 });
  },
  gameDraw(): void {
    note(D5, { dur: 0.1, gain: 0.04 });
    note(D5, { at: 0.12, dur: 0.14, gain: 0.035 });
  },
  puzzleSolved(): void {
    note(E5, { dur: 0.07, gain: 0.05 });
    note(A5, { at: 0.07, dur: 0.07, gain: 0.05 });
    note(E6, { at: 0.14, dur: 0.16, gain: 0.045 });
  },
  wrongMove(): void {
    // Gentle "nope" — low, soft, quick; encouraging rather than punishing.
    note(180, { dur: 0.09, type: 'triangle', gain: 0.045, glideTo: 150 });
  },
  xpGain(): void {
    note(A5, { dur: 0.05, gain: 0.035 });
    note(E6, { at: 0.05, dur: 0.08, gain: 0.035 });
  },
  levelUp(): void {
    note(C5, { dur: 0.09, gain: 0.05 });
    note(E5, { at: 0.08, dur: 0.09, gain: 0.05 });
    note(G5, { at: 0.16, dur: 0.09, gain: 0.05 });
    note(C6, { at: 0.24, dur: 0.12, gain: 0.055 });
    note(E6, { at: 0.34, dur: 0.24, type: 'triangle', gain: 0.05 });
    noise(0.3, { at: 0.34, gain: 0.012, freq: 5000, q: 0.5 });
  },
  streak(): void {
    // Whoosh up + a little crackle — the flame catches.
    noise(0.22, { gain: 0.03, freq: 500, q: 1.2, rampTo: 2600 });
    note(G5, { at: 0.16, dur: 0.12, gain: 0.045, glideTo: C6 });
  },
  achievement(): void {
    // Bell-ish stagger — bright but soft.
    note(C6, { dur: 0.3, type: 'triangle', gain: 0.04 });
    note(E6, { at: 0.09, dur: 0.3, type: 'triangle', gain: 0.038 });
    note(G6, { at: 0.18, dur: 0.4, type: 'triangle', gain: 0.035 });
  },
  lessonComplete(): void {
    note(G5, { dur: 0.09, gain: 0.05 });
    note(C6, { at: 0.09, dur: 0.2, gain: 0.05 });
  },
} as const;

export type SoundCue = keyof typeof CUES;

/** Play a named UI/reward cue (no-op when sounds are muted). */
export function playSound(cue: SoundCue): void {
  if (!enabled()) return;
  try {
    CUES[cue]();
  } catch {
    /* never let audio failures break gameplay */
  }
}

/** Play a sound appropriate to a move's SAN (mate/check/capture/castle/promotion/quiet). */
export function playMoveSound(san: string): void {
  if (!enabled()) return;
  try {
    if (san.includes('#')) checkmate();
    else if (san.includes('+')) check();
    else if (san.includes('=')) promotion();
    else if (san.startsWith('O-O')) castle();
    else if (san.includes('x')) capture();
    else move();
  } catch {
    /* never let audio failures break gameplay */
  }
}
