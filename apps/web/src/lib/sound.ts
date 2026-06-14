import { useSettings } from '../store/settings';

// Synthesised move sounds via Web Audio — no asset files, resumes on the first
// user gesture (which is always a move/click).
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

function blip(freq: number, dur: number, type: OscillatorType = 'sine', gain = 0.05): void {
  const c = audio();
  if (!c) return;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  osc.connect(g);
  g.connect(c.destination);
  const t = c.currentTime;
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.start(t);
  osc.stop(t + dur);
}

/** Play a sound appropriate to a move's SAN (mate/check/capture/quiet). */
export function playMoveSound(san: string): void {
  if (!useSettings.getState().sound) return;
  if (san.includes('#')) {
    blip(330, 0.12, 'sine', 0.06);
    setTimeout(() => blip(494, 0.22, 'sine', 0.06), 100);
  } else if (san.includes('+')) {
    blip(440, 0.08, 'triangle', 0.05);
  } else if (san.includes('x')) {
    blip(150, 0.1, 'square', 0.045);
  } else if (san.startsWith('O-O')) {
    blip(240, 0.07);
    setTimeout(() => blip(300, 0.07), 60);
  } else {
    blip(210, 0.06, 'sine', 0.045);
  }
}
