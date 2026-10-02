import { ROSTER, TUNING_NOTES } from './notes.js';
import { ReferenceTone } from './tone.js';
import { PitchListener } from './pitchDetect.js';
import { logAttempt, getHistory } from './sheetApi.js';
import { renderProgressChart } from './chart.js';
import { initAuthGate } from './auth.js';

const LISTEN_SECONDS = 10;
const SETTLE_SECONDS = 3; // only the final N seconds count toward the measured pitch
const SAMPLE_INTERVAL_MS = 50;
const OUTLIER_CENTS_THRESHOLD = 150; // discard samples this far from the pack (likely octave errors)
const REVEAL_DELAY_MS = 2500;
const REVEAL_DURATION_MS = 3000;

const studentSelect = document.getElementById('studentSelect');
const noteSelect = document.getElementById('noteSelect');
const toneSelect = document.getElementById('toneSelect');
const volumeSlider = document.getElementById('volumeSlider');
const volumeLabel = document.getElementById('volumeLabel');
const startBtn = document.getElementById('startBtn');
const statusText = document.getElementById('statusText');
const debugText = document.getElementById('debugText');
const progressChart = document.getElementById('progressChart');
const progressSection = document.getElementById('progressSection');
const modeRadios = document.querySelectorAll('input[name="mode"]');

const tone = new ReferenceTone();
const pitchListener = new PitchListener();
let micReady = false;

const debugMode = new URLSearchParams(location.search).has('debug');
if (debugMode) debugText.hidden = false;

function getMode() {
  return document.querySelector('input[name="mode"]:checked').value;
}

function populateSelects() {
  for (const name of ROSTER) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    studentSelect.appendChild(opt);
  }
  for (const note of TUNING_NOTES) {
    const opt = document.createElement('option');
    opt.value = note.freq;
    opt.textContent = `${note.name} (${note.freq.toFixed(2)} Hz)`;
    noteSelect.appendChild(opt);
  }
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Students (especially singers) won't always land in the exact octave as the
// reference tone, and the fundamental-tracking detector can itself occasionally
// lock onto an octave-related multiple of the true pitch. Rather than trying to
// blindly guess the "right" octave from the signal, fold the measured frequency
// to whichever octave multiple/division of itself lands closest to the target
// note — we already know the target, so this is the reliable way to resolve it.
function foldToNearestOctave(freq, targetFreq) {
  const octaveShift = Math.round(Math.log2(freq / targetFreq));
  return freq / Math.pow(2, octaveShift);
}

// Two-pass median: an initial median anchors the pack, then samples that are
// wildly off from it (e.g. an autocorrelation octave error) are dropped before
// taking the final median. Guards against a run of bad samples skewing things.
function robustMedian(freqs) {
  if (freqs.length <= 2) return median(freqs);
  const roughCenter = median(freqs);
  const filtered = freqs.filter(
    (f) => Math.abs(1200 * Math.log2(f / roughCenter)) <= OUTLIER_CENTS_THRESHOLD
  );
  return median(filtered.length > 0 ? filtered : freqs);
}

async function refreshChart() {
  const student = studentSelect.value;
  if (!student) return;
  progressSection.hidden = false;
  try {
    const history = await getHistory(student);
    renderProgressChart(progressChart, history);
  } catch (err) {
    console.error('Failed to load history', err);
  }
}

function setStatus(text) {
  statusText.textContent = text;
}

function setDebug(text) {
  debugText.textContent = text;
}

async function ensureMicReady() {
  if (micReady) return true;
  try {
    await pitchListener.start();
    micReady = true;
    return true;
  } catch (err) {
    console.error('Microphone access failed', err);
    setStatus('Microphone access is required. Please allow mic access and try again.');
    return false;
  }
}

// The currently running attempt's cancellation token, or null when idle.
// Changing note/tone mid-attempt cancels this one and immediately starts a
// fresh one at the new selection — a cancelled attempt never scores or logs.
let activeToken = null;

function setControlsBusy(busy) {
  startBtn.disabled = busy;
  modeRadios.forEach((r) => (r.disabled = busy));
}

function startAttempt() {
  const token = { cancelled: false };
  activeToken = token;
  runAttempt(token).catch((err) => {
    console.error(err);
    setStatus('Something went wrong — try again.');
    activeToken = null;
    setControlsBusy(false);
  });
}

// Stopping the old tone/timer happens here, synchronously, before the new
// attempt starts — the old attempt's own cleanup must NOT touch shared audio
// state once cancelled, since by the time it notices (up to 100ms later) the
// new attempt may already be playing a different oscillator on the same
// shared ReferenceTone instance, and an unconditional tone.stop() there would
// kill the new pitch instead of the old one.
function switchAttempt() {
  if (activeToken) {
    activeToken.cancelled = true;
    if (activeToken.sampleTimer) clearInterval(activeToken.sampleTimer);
  }
  tone.stop();
  startAttempt();
}

async function runAttempt(token) {
  const student = studentSelect.value;
  const noteFreq = parseFloat(noteSelect.value);
  const noteName = noteSelect.options[noteSelect.selectedIndex].textContent;
  const toneType = toneSelect.value;
  const volume = parseFloat(volumeSlider.value);
  const mode = getMode();

  if (!student) {
    setStatus('Select your name first.');
    activeToken = null;
    return;
  }

  setControlsBusy(true);
  const ready = await ensureMicReady();
  if (token.cancelled) return;
  if (!ready) {
    activeToken = null;
    setControlsBusy(false);
    return;
  }

  tone.start(noteFreq, toneType, volume);

  const samples = [];
  const startTime = performance.now();
  token.sampleTimer = setInterval(() => {
    const { freq, rms } = pitchListener.sample();
    samples.push({ t: performance.now() - startTime, freq, rms });
    if (debugMode) {
      setDebug(`rms: ${rms.toFixed(4)}   detected: ${freq > 0 ? freq.toFixed(1) + ' Hz' : '—'}`);
    }
  }, SAMPLE_INTERVAL_MS);

  const totalMs = LISTEN_SECONDS * 1000;
  let elapsed = 0;
  while (elapsed < totalMs && !token.cancelled) {
    setStatus(`Listen and match the pitch... ${Math.ceil((totalMs - elapsed) / 1000)}s`);
    await sleep(100);
    elapsed += 100;
  }

  // If cancelled, switchAttempt() already cleared this token's timer and
  // stopped the (now superseded) tone — touching either here again would
  // risk stomping on whatever the newer attempt has since started.
  if (token.cancelled) return;

  clearInterval(token.sampleTimer);
  tone.stop();

  const settleWindowMs = (LISTEN_SECONDS - SETTLE_SECONDS) * 1000;
  const validFreqs = samples
    .filter((s) => s.t >= settleWindowMs && s.freq > 0)
    .map((s) => foldToNearestOctave(s.freq, noteFreq));

  if (validFreqs.length === 0) {
    setStatus("Couldn't detect a clear pitch — try again.");
    activeToken = null;
    setControlsBusy(false);
    return;
  }

  const measuredFreq = robustMedian(validFreqs);
  const centsDiff = Math.round(1200 * Math.log2(measuredFreq / noteFreq) * 10) / 10;

  setStatus('Analyzing...');
  await sleep(REVEAL_DELAY_MS);
  if (token.cancelled) return;

  const direction = centsDiff > 0 ? 'sharp' : centsDiff < 0 ? 'flat' : 'in tune';
  setStatus(`${centsDiff > 0 ? '+' : ''}${centsDiff} cents (${direction})`);

  if (mode === 'test') {
    logAttempt({
      student,
      note: noteName,
      targetFreq: noteFreq,
      measuredFreq: Math.round(measuredFreq * 100) / 100,
      centsDiff,
      toneType,
      volume,
    }).catch((err) => console.error('Failed to log attempt', err));
  }

  await sleep(REVEAL_DURATION_MS);
  if (token.cancelled) return;

  setStatus(mode === 'test' ? 'Logged. Ready for another try.' : 'Practice round (not recorded). Ready for another try.');
  activeToken = null;
  setControlsBusy(false);
  if (mode === 'test') refreshChart();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

studentSelect.addEventListener('change', refreshChart);
volumeSlider.addEventListener('input', () => {
  volumeLabel.textContent = `${Math.round(volumeSlider.value * 100)}%`;
  tone.setVolume(parseFloat(volumeSlider.value));
});
noteSelect.addEventListener('change', () => {
  if (activeToken) switchAttempt();
});
toneSelect.addEventListener('change', () => {
  if (activeToken) switchAttempt();
});
startBtn.addEventListener('click', () => {
  if (activeToken) return;
  startAttempt();
});

const helpBtn = document.getElementById('helpBtn');
const helpWrap = helpBtn.closest('.help-wrap');
helpBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const isOpen = helpWrap.classList.toggle('open');
  helpBtn.setAttribute('aria-expanded', String(isOpen));
});
document.addEventListener('click', (e) => {
  if (!helpWrap.contains(e.target)) {
    helpWrap.classList.remove('open');
    helpBtn.setAttribute('aria-expanded', 'false');
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    helpWrap.classList.remove('open');
    helpBtn.setAttribute('aria-expanded', 'false');
  }
});

initAuthGate(populateSelects);
