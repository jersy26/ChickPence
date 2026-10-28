/**
 * whisperWorker.js
 * Runs Whisper (speech → text) in a Web Worker with Transformers.js, so the
 * audio never leaves the device and the page stays responsive.
 *
 * Messages in:  { id, type: 'load', model }
 *               { id, type: 'transcribe', model, language, audio: Float32Array (16 kHz mono) }
 * Messages out: { type: 'progress', loaded, total }   while the model loads
 *               { id, type: 'status', stage: 'transcribing' }
 *               { id, type: 'ready' } | { id, type: 'result', text } | { id, type: 'error', message }
 *
 * The ONNX runtime is served by the app itself (Vite copies it from
 * node_modules) instead of Transformers.js's default CDN. The model is
 * downloaded from Hugging Face the first time. Both are kept in the browser's
 * cache, so later use works offline.
 */

import { pipeline, env } from '@huggingface/transformers';

env.allowLocalModels = false;
// Threads only work when the page is cross-origin isolated (see vite.config.js).
// Two cores stay free: with all 8 busy, the recorder lost the start of a sentence.
// On the farm PC, 4 threads took ~60 s per sentence and 8 took ~17 s.
env.backends.onnx.wasm.numThreads = self.crossOriginIsolated ? Math.max(1, (navigator.hardwareConcurrency || 1) - 2) : 1;
env.backends.onnx.wasm.wasmPaths = {
  wasm: new URL('../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm', import.meta.url).href,
  mjs: new URL('../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs', import.meta.url).href
};

let current = null; // { model, promise }

function load(model) {
  if (current?.model === model) return current.promise;
  const files = new Map();
  const promise = pipeline('automatic-speech-recognition', model, {
    device: 'wasm',
    dtype: 'q8', // 8-bit: whisper-base is 73 MB instead of 280 MB, and about as accurate
    progress_callback: (p) => {
      if (p.status !== 'progress' || !p.total) return;
      files.set(p.file, { loaded: p.loaded, total: p.total });
      let loaded = 0;
      let total = 0;
      for (const f of files.values()) {
        loaded += f.loaded;
        total += f.total;
      }
      self.postMessage({ type: 'progress', loaded, total });
    }
  });
  current = { model, promise };
  promise.catch(() => {
    if (current?.promise === promise) current = null; // let the next try download again
  });
  return promise;
}

const LANGUAGE_CODES = { tagalog: 'tl', english: 'en' };

/**
 * Whisper's "initial prompt": <|startofprev|> prompt <|startoftranscript|>
 * <|lang|> <|transcribe|> <|notimestamps|>. Transformers.js has no prompt
 * option for Whisper, but generate() accepts these start tokens directly.
 */
function promptTokens(asr, prompt, language) {
  const config = asr.model.generation_config;
  const startOfPrev = config.prev_sot_token_id ?? asr.tokenizer.encode('<|startofprev|>', { add_special_tokens: false })[0];
  return [
    startOfPrev,
    ...asr.tokenizer.encode(` ${prompt.trim()}`, { add_special_tokens: false }),
    config.decoder_start_token_id,
    config.lang_to_id[`<|${LANGUAGE_CODES[language] || 'tl'}|>`],
    config.task_to_id.transcribe,
    config.no_timestamps_token_id
  ];
}

self.onmessage = async ({ data }) => {
  const { id, type } = data;
  try {
    if (type === 'load') {
      await load(data.model);
      self.postMessage({ id, type: 'ready' });
    } else if (type === 'transcribe') {
      const loadStart = performance.now();
      const asr = await load(data.model);
      const runStart = performance.now();
      self.postMessage({ id, type: 'status', stage: 'transcribing' });
      const out = await asr(data.audio, {
        language: data.language,
        task: 'transcribe',
        ...(data.prompt ? { decoder_input_ids: promptTokens(asr, data.prompt, data.language) } : {})
      });
      // The text starts with the prompt; speechInput.stripPrompt removes it
      self.postMessage({
        id,
        type: 'result',
        text: String(out?.text || '').trim(),
        timing: { loadMs: Math.round(runStart - loadStart), runMs: Math.round(performance.now() - runStart), threads: env.backends.onnx.wasm.numThreads }
      });
    }
  } catch (err) {
    self.postMessage({ id, type: 'error', message: err?.message || String(err) });
  }
};
