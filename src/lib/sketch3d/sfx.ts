/**
 * Shibu-Sketch — tiny generated UI sounds (no audio assets).
 * A soft page-flip swoosh and a gentle tap, synthesized with WebAudio.
 */

let ctx: AudioContext | null = null;
let muted = false;

function ac(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

export function setSfxMuted(m: boolean): void {
  muted = m;
}

export function isSfxMuted(): boolean {
  return muted;
}

/** Soft paper swoosh for page turns. */
export function playFlip(): void {
  if (muted) return;
  const a = ac();
  if (!a) return;
  const dur = 0.16;
  const buf = a.createBuffer(1, Math.floor(a.sampleRate * dur), a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    const t = i / data.length;
    // band-shaped noise with fast attack + decay
    const env = Math.sin(Math.PI * Math.min(1, t * 1.15)) ** 2;
    data[i] = (Math.random() * 2 - 1) * env * 0.5;
  }
  const src = a.createBufferSource();
  src.buffer = buf;
  const bp = a.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 2600;
  bp.Q.value = 0.8;
  const g = a.createGain();
  g.gain.value = 0.1;
  g.gain.setValueAtTime(0.1, a.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + dur);
  src.connect(bp).connect(g).connect(a.destination);
  src.start();
}

/** Gentle tap for selections / buttons. */
export function playTap(): void {
  if (muted) return;
  const a = ac();
  if (!a) return;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(660, a.currentTime);
  o.frequency.exponentialRampToValueAtTime(330, a.currentTime + 0.07);
  g.gain.setValueAtTime(0.06, a.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0008, a.currentTime + 0.09);
  o.connect(g).connect(a.destination);
  o.start();
  o.stop(a.currentTime + 0.1);
}
