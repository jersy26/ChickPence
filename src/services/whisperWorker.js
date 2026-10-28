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

self.onmessage = async ({ data }) => {
  const { id, type } = data;
  try {
    if (type === 'load') {
      await load(data.model);
      self.postMessage({ id, type: 'ready' });
    } else if (type === 'transcribe') {
      const asr = await load(data.model);
      self.postMessage({ id, type: 'status', stage: 'transcribing' });
      const out = await asr(data.audio, { language: data.language, task: 'transcribe' });
      self.postMessage({ id, type: 'result', text: String(out?.text || '').trim() });
    }
  } catch (err) {
    self.postMessage({ id, type: 'error', message: err?.message || String(err) });
  }
};
