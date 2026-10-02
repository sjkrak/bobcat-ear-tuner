import { getAudioContext } from './tone.js';

const RMS_THRESHOLD = 0.003;

// Autocorrelation-based fundamental frequency detector (ACF2+).
// Returns { freq, rms }. freq is -1 if no clear pitch found (rms is still
// reported so callers can tell "too quiet" apart from "no clear pitch").
function autocorrelate(buffer, sampleRate) {
  const SIZE = buffer.length;

  let rms = 0;
  for (let i = 0; i < SIZE; i++) {
    rms += buffer[i] * buffer[i];
  }
  rms = Math.sqrt(rms / SIZE);
  if (rms < RMS_THRESHOLD) return { freq: -1, rms }; // too quiet, likely silence/noise

  let r1 = 0;
  let r2 = SIZE - 1;
  const threshold = 0.2;
  for (let i = 0; i < SIZE / 2; i++) {
    if (Math.abs(buffer[i]) < threshold) { r1 = i; break; }
  }
  for (let i = 1; i < SIZE / 2; i++) {
    if (Math.abs(buffer[SIZE - i]) < threshold) { r2 = SIZE - i; break; }
  }

  const trimmed = buffer.slice(r1, r2);
  const newSize = trimmed.length;

  const c = new Array(newSize).fill(0);
  for (let lag = 0; lag < newSize; lag++) {
    for (let i = 0; i < newSize - lag; i++) {
      c[lag] += trimmed[i] * trimmed[i + lag];
    }
  }

  let d = 0;
  while (d < newSize - 1 && c[d] > c[d + 1]) d++;

  let maxVal = -1;
  for (let i = d; i < newSize; i++) {
    if (c[i] > maxVal) maxVal = c[i];
  }

  // Octave-error guard: a real voice's correlation can have a taller peak at
  // 2x (or 3x) the true period, from harmonics/formants reinforcing there.
  // The fundamental's peak is always the *first* one after the dip, so take
  // the first local max that's close to the overall tallest peak, rather than
  // the tallest peak wherever it happens to be — that's what was causing
  // measured pitch to land an octave low.
  const PEAK_THRESHOLD_RATIO = 0.85;
  let maxPos = -1;
  for (let i = d + 1; i < newSize - 1; i++) {
    if (c[i] >= c[i - 1] && c[i] >= c[i + 1] && c[i] >= PEAK_THRESHOLD_RATIO * maxVal) {
      maxPos = i;
      break;
    }
  }
  if (maxPos === -1) {
    // Fallback: no clean local peak found, use the global max as before.
    for (let i = d; i < newSize; i++) {
      if (c[i] === maxVal) { maxPos = i; break; }
    }
  }

  let period = maxPos;
  // Parabolic interpolation for sub-sample precision
  const x1 = c[period - 1] || 0;
  const x2 = c[period];
  const x3 = c[period + 1] || 0;
  const a = (x1 + x3 - 2 * x2) / 2;
  const b = (x3 - x1) / 2;
  if (a) period -= b / (2 * a);

  if (period <= 0) return { freq: -1, rms };
  return { freq: sampleRate / period, rms };
}

export class PitchListener {
  constructor() {
    this.stream = null;
    this.source = null;
    this.analyser = null;
    this.buffer = null;
    this.intervalId = null;
  }

  async start() {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') await ctx.resume();

    // Disable voice-call-oriented processing: AEC/NS/AGC are tuned for speech
    // and will gate, distort, or (since a reference tone is playing through
    // the speakers at the same time) actively cancel a sustained sung/played
    // note that resembles the tone's pitch.
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    this.source = ctx.createMediaStreamSource(this.stream);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.buffer = new Float32Array(this.analyser.fftSize);
    this.source.connect(this.analyser);
  }

  // Samples the current detected pitch. Returns { freq, rms } — freq is -1
  // if no clear pitch was found in this sample.
  sample() {
    if (!this.analyser) return { freq: -1, rms: 0 };
    this.analyser.getFloatTimeDomainData(this.buffer);
    return autocorrelate(this.buffer, getAudioContext().sampleRate);
  }

  stop() {
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
    }
    if (this.source) this.source.disconnect();
    this.stream = null;
    this.source = null;
    this.analyser = null;
    this.buffer = null;
  }
}
