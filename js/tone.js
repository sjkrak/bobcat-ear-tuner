// Reference tone playback via Web Audio oscillators.

let audioCtx = null;

function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

export class ReferenceTone {
  constructor() {
    this.oscillator = null;
    this.filter = null;
    this.gain = null;
  }

  // toneType: 'pure' | 'blend' | 'reed'
  start(freq, toneType, volume) {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') ctx.resume();

    this.stop();

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    switch (toneType) {
      case 'reed':
        osc.type = 'sawtooth';
        filter.type = 'lowpass';
        filter.frequency.value = 4000;
        break;
      case 'blend':
        osc.type = 'triangle';
        filter.type = 'lowpass';
        filter.frequency.value = 20000; // effectively bypassed
        break;
      case 'pure':
      default:
        osc.type = 'sine';
        filter.type = 'lowpass';
        filter.frequency.value = 20000; // effectively bypassed
        break;
    }

    osc.frequency.value = freq;
    gain.gain.value = volume;

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    osc.start();

    this.oscillator = osc;
    this.filter = filter;
    this.gain = gain;
  }

  setVolume(volume) {
    if (this.gain) this.gain.gain.value = volume;
  }

  stop() {
    if (this.oscillator) {
      try {
        this.oscillator.stop();
      } catch (e) {
        // already stopped
      }
      this.oscillator.disconnect();
      this.filter.disconnect();
      this.gain.disconnect();
      this.oscillator = null;
      this.filter = null;
      this.gain = null;
    }
  }
}

export { getAudioContext };
