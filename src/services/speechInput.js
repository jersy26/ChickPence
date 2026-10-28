/**
 * speechInput.js
 * Voice typing for the entry form with Whisper running in the browser
 * (Transformers.js in a Web Worker, see whisperWorker.js).
 *
 * Privacy: the audio never leaves this device. The first time, the browser
 * downloads the speech model from Hugging Face; it stays in the browser's
 * cache, so later voice typing works offline.
 * Reading the text into an entry also happens here (logbookParser rules, then
 * the local AI). Nothing is saved until the user taps Save in the form.
 *
 * The recording stops by itself after a short pause (see createSilenceDetector)
 * or when the user taps Stop.
 */

const LANG_KEY = 'chickpence_voice_lang';
const MODEL_KEY = 'chickpence_voice_model';
const CACHE_NAME = 'transformers-cache'; // Transformers.js env.cacheKey

export const VOICE_LANGS = [
  { code: 'fil-PH', label: 'Filipino', whisper: 'tagalog' },
  { code: 'en-PH', label: 'English (PH)', whisper: 'english' }
];

/**
 * Measured on the farm PC (CPU only) with Filipino and Taglish recordings:
 * small read 7 of 8 sentences into usable entries (~7–12 s each); base only
 * 3 of 8 (~2–4 s), so small is the default and base the fast option.
 */
export const VOICE_MODELS = [
  { id: 'onnx-community/whisper-small', label: 'Accurate: whisper-small (240 MB download)', sizeMb: 240 },
  { id: 'onnx-community/whisper-base', label: 'Fast, weaker in Filipino: whisper-base (73 MB)', sizeMb: 73 }
];

const FIL_DIGITS = ['isa', 'dalawa', 'tatlo', 'apat', 'lima', 'anim', 'pito', 'walo', 'siyam', 'sampu'];
const EN_DIGITS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

/** "Batch 2026-09" → "batch siyam" / "batch nine": how a batch is usually said. */
function spokenBatch(name, words) {
  const n = Number(String(name).match(/(\d+)\D*$/)?.[1]);
  if (!n) return null;
  return `batch ${n <= 10 ? words[n - 1] : n}`;
}

/**
 * A short sample of farm-log wording given to Whisper before the recording
 * (its "initial prompt"), so it spells the farm's words the way the rules read
 * them. Without it whisper-small wrote "batch siya mga hapon" for "batch siyam
 * kahapon" in testing. It never names buyers or amounts.
 */
export function buildVoicePrompt(lang = getVoiceLang(), batchNames = []) {
  const english = lang === 'en-PH';
  const batches = batchNames.map((b) => spokenBatch(b, english ? EN_DIGITS : FIL_DIGITS)).filter(Boolean);
  const list = batches.length ? `${batches.join(', ')}. ` : '';
  return english
    ? `Poultry farm log. ${list}Dead, feed, sacks, kilos, sold, heads, per kilo, pesos, electricity, vitamins, yesterday, today.`
    : `Talaan ng manukan. ${list}Namatay, patay, patuka, pakain, sako, kilo, nagbenta, ulo, kada kilo, piso, kuryente, bitamina, kahapon, ngayon. Dalawampu, tatlumpu, apatnapu, limampu, animnapu, isang daan.`;
}

/**
 * Whisper repeats the prompt at the start of its output; keep only what was
 * said. On silence or noise it echoes part of the prompt ("Talaan ng manukan"
 * in testing); that counts as nothing said.
 */
export function stripPrompt(text, prompt) {
  const t = String(text || '').trim();
  const p = String(prompt || '').trim();
  if (!p) return t;
  let said = t;
  if (t.startsWith(p)) said = t.slice(p.length).trim();
  else {
    const tail = p.slice(-24);
    const at = t.lastIndexOf(tail);
    if (at >= 0) said = t.slice(at + tail.length).trim();
  }
  const plain = (s) => s.toLowerCase().replace(/[^a-z0-9ñ]+/g, ' ').trim();
  return plain(said) && plain(p).includes(plain(said)) ? '' : said;
}

/** Recording needs a microphone API, a recorder, Web Audio and workers. */
export function isSpeechSupported(win = globalThis) {
  return !!(win?.navigator?.mediaDevices?.getUserMedia && win.MediaRecorder && (win.AudioContext || win.webkitAudioContext) && win.Worker);
}

function readSetting(key, allowed, fallback) {
  try {
    const saved = localStorage.getItem(key);
    if (allowed.includes(saved)) return saved;
  } catch (_) {}
  return fallback;
}

function writeSetting(key, value) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch (_) {}
}

export const getVoiceLang = () => readSetting(LANG_KEY, VOICE_LANGS.map((l) => l.code), VOICE_LANGS[0].code);
export const setVoiceLang = (code) => writeSetting(LANG_KEY, code);
export const getVoiceModel = () => readSetting(MODEL_KEY, VOICE_MODELS.map((m) => m.id), VOICE_MODELS[0].id);
export const setVoiceModel = (id) => writeSetting(MODEL_KEY, id);
export const voiceModelInfo = (id = getVoiceModel()) => VOICE_MODELS.find((m) => m.id === id) || VOICE_MODELS[0];

/** Has the voice model been downloaded already (so voice typing works offline)? */
export async function isVoiceModelCached(model = getVoiceModel(), win = globalThis) {
  try {
    const cache = await win.caches.open(CACHE_NAME);
    const keys = await cache.keys();
    return keys.some((req) => req.url.includes(`/${model}/`) && req.url.includes('decoder'));
  } catch (_) {
    return false;
  }
}

/** User-facing text for a getUserMedia failure. */
export function micErrorMessage(err) {
  switch (err?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Microphone access was blocked. Allow it in the browser to use voice typing.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No microphone was found.';
    case 'NotReadableError':
      return 'The microphone is being used by another app.';
    default:
      return `Could not start the microphone${err?.message ? `: ${err.message}` : '.'}`;
  }
}

/**
 * Whisper writes punctuation and, on noise, tags like "[BLANK_AUDIO]" or
 * "(music)". Drop the tags and the final period, and split "3-Dead" into
 * "3 Dead"; the rules handle the rest.
 */
export function cleanTranscript(text) {
  return String(text || '')
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .replace(/(\d)-(?=[A-Za-z])/g, '$1 ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!]+$/, '')
    .trim();
}

// ---------------------------------------------------------------------------
// SILENCE DETECTION (pure)
// ---------------------------------------------------------------------------

export const SILENCE = {
  startLevel: 0.02,   // RMS that counts as speech
  endLevel: 0.012,    // RMS under this counts as quiet again
  endSilenceMs: 1500, // quiet this long after speaking → stop
  noSpeechMs: 7000,   // nothing said this long → give up
  maxMs: 20000        // one entry is a short sentence
};

/**
 * Feed it the microphone level every ~100 ms. push() returns 'continue',
 * 'stop' (speech then a pause, or too long) or 'no-speech'.
 */
export function createSilenceDetector(opts = SILENCE) {
  let startedAt = null;
  let quietSince = null;
  const detector = {
    heard: false,
    push(level, now) {
      startedAt ??= now;
      if (now - startedAt >= opts.maxMs) return detector.heard ? 'stop' : 'no-speech';
      if (level >= opts.startLevel) {
        detector.heard = true;
        quietSince = null;
        return 'continue';
      }
      if (!detector.heard) return now - startedAt >= opts.noSpeechMs ? 'no-speech' : 'continue';
      if (level < opts.endLevel) {
        quietSince ??= now;
        if (now - quietSince >= opts.endSilenceMs) return 'stop';
      } else {
        quietSince = null;
      }
      return 'continue';
    }
  };
  return detector;
}

// ---------------------------------------------------------------------------
// WHISPER WORKER
// ---------------------------------------------------------------------------

let worker = null;
let nextId = 1;
const pending = new Map(); // id → { resolve, reject, onProgress, onStatus }
let idleTimer = null;

// The loaded model holds several hundred MB; give it back after a quiet spell
const IDLE_UNLOAD_MS = 10 * 60 * 1000;

function scheduleUnload() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (pending.size || !worker) return scheduleUnload();
    worker.terminate();
    worker = null;
  }, IDLE_UNLOAD_MS);
}

function getWorker() {
  scheduleUnload();
  if (worker) return worker;
  worker = new Worker(new URL('./whisperWorker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    if (data.type === 'progress') {
      pending.forEach((job) => job.onProgress?.(data));
      return;
    }
    const job = pending.get(data.id);
    if (!job) return;
    if (data.type === 'status') return job.onStatus?.(data.stage);
    pending.delete(data.id);
    if (data.type === 'error') job.reject(new Error(data.message));
    else job.resolve(data);
  };
  worker.onerror = (event) => {
    pending.forEach((job) => job.reject(new Error(event.message || 'The voice model stopped.')));
    pending.clear();
    worker = null;
  };
  return worker;
}

function ask(message, { onProgress, onStatus, transfer = [] } = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject, onProgress, onStatus });
    getWorker().postMessage({ ...message, id }, transfer);
  });
}

export function loadingMessage(loaded, total, model = getVoiceModel()) {
  const pct = total ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
  return `Loading the voice model… ${pct}% (the first time it downloads about ${voiceModelInfo(model).sizeMb} MB, then it works offline)`;
}

/** Start loading the voice model (from the cache, or downloading it the first time). */
export function preloadVoiceModel() {
  return ask({ type: 'load', model: getVoiceModel() }).catch(() => {});
}

/**
 * Load an already downloaded model as soon as the entry form opens, so it is
 * ready before the user speaks: loading during the recording competed with
 * the recorder for the CPU. Never starts the first download by itself.
 */
export async function warmUpVoiceModel(win = globalThis) {
  if (await isVoiceModelCached(getVoiceModel(), win)) preloadVoiceModel();
}

/** 16 kHz mono audio → text, on this device. */
export async function transcribe(audio, { lang = getVoiceLang(), batchNames = [], onStatus } = {}) {
  const model = getVoiceModel();
  const language = VOICE_LANGS.find((l) => l.code === lang)?.whisper || 'tagalog';
  const prompt = buildVoicePrompt(lang, batchNames);
  const seconds = (audio.length / 16000).toFixed(1); // read before the buffer moves to the worker
  const { text, timing } = await ask({ type: 'transcribe', model, language, prompt, audio }, {
    transfer: [audio.buffer],
    onProgress: ({ loaded, total }) => onStatus?.(loadingMessage(loaded, total, model), 'loading'),
    onStatus: () => onStatus?.('Turning your voice into text on this device…', 'transcribing')
  });
  console.info(`Whisper ${model}: ${seconds} s of audio, model ready in ${timing?.loadMs} ms, read in ${timing?.runMs} ms, ${timing?.threads} threads, isolated: ${globalThis.crossOriginIsolated}`);
  return cleanTranscript(stripPrompt(text, prompt));
}

// ---------------------------------------------------------------------------
// RECORDING
// ---------------------------------------------------------------------------

/** Mix down to mono (Whisper wants one channel). */
export function toMono(buffer) {
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0).slice();
  const out = new Float32Array(buffer.length);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < out.length; i++) out[i] += data[i] / buffer.numberOfChannels;
  }
  return out;
}

/** The browser pieces startDictation uses; tests pass fakes. */
export function browserMedia(win = globalThis) {
  const AudioCtx = win.AudioContext || win.webkitAudioContext;
  return {
    getUserMedia: () => win.navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }
    }),
    MediaRecorder: win.MediaRecorder,
    levelMeter(stream) {
      const ctx = new AudioCtx();
      ctx.resume?.();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      return {
        level() {
          analyser.getFloatTimeDomainData(samples);
          let sum = 0;
          for (const v of samples) sum += v * v;
          return Math.sqrt(sum / samples.length);
        },
        close: () => ctx.close().catch(() => {})
      };
    },
    // Decoding into a 16 kHz context resamples the recording for Whisper
    async decode(blob) {
      const ctx = new AudioCtx({ sampleRate: 16000 });
      try {
        return toMono(await ctx.decodeAudioData(await blob.arrayBuffer()));
      } finally {
        ctx.close().catch(() => {});
      }
    },
    transcribe,
    preload: preloadVoiceModel,
    now: () => Date.now()
  };
}

/**
 * Record one sentence and turn it into text. Calls onStatus(text, stage) with
 * stage 'listening' | 'loading' | 'transcribing', then onFinal(text), or
 * onError(message), or onEnd() when nothing was said.
 * Returns { stop, abort }: stop() ends the recording and still reads it;
 * abort() throws it away.
 */
export function startDictation({ lang = getVoiceLang(), batchNames = [], onStatus, onFinal, onError, onEnd, media = browserMedia() } = {}) {
  const detector = createSilenceDetector();
  const chunks = [];
  let stream = null;
  let recorder = null;
  let meter = null;
  let timer = null;
  let stopped = false;
  let aborted = false;
  let manual = false;

  const release = () => {
    clearInterval(timer);
    stream?.getTracks?.().forEach((t) => t.stop());
    meter?.close?.();
  };

  const finish = async () => {
    release();
    if (aborted) return;
    // Stopped by hand: read it even if it sounded quiet; stopped by itself: only when speech was heard
    if (!detector.heard && !manual) return onEnd?.();
    try {
      onStatus?.('Turning your voice into text on this device…', 'transcribing');
      const audio = await media.decode(new Blob(chunks, { type: recorder?.mimeType || 'audio/webm' }));
      const text = await media.transcribe(audio, { lang, batchNames, onStatus });
      if (aborted) return;
      if (text) onFinal?.(text);
      else onEnd?.();
    } catch (err) {
      if (!aborted) onError?.(`Could not turn the recording into text: ${err.message}`);
    }
  };

  const end = () => {
    if (stopped) return;
    stopped = true;
    if (recorder?.state === 'recording') recorder.stop(); // → onstop → finish
    else release();
  };

  (async () => {
    try {
      stream = await media.getUserMedia();
    } catch (err) {
      stopped = true;
      return onError?.(micErrorMessage(err));
    }
    if (stopped) {
      // Stopped while the browser was still asking for the microphone
      release();
      return aborted ? undefined : onEnd?.();
    }

    media.preload?.();
    recorder = new media.MediaRecorder(stream);
    recorder.ondataavailable = (e) => {
      if (e.data?.size) chunks.push(e.data);
    };
    recorder.onstop = finish;
    meter = media.levelMeter(stream);
    recorder.start();
    onStatus?.('Listening… say one entry, then pause.', 'listening');
    timer = setInterval(() => {
      if (detector.push(meter.level(), media.now()) !== 'continue') end();
    }, 100);
  })();

  return {
    stop() {
      manual = true;
      end();
    },
    abort() {
      aborted = true;
      end();
    }
  };
}
