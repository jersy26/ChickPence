/**
 * speechInput.js
 * Voice typing for the entry form with the browser's Web Speech API.
 *
 * Privacy: Chrome and Edge send the audio to their online speech service
 * (Google / Microsoft) to turn it into text, so this needs internet. Only the
 * text comes back; reading it into an entry happens on this device
 * (logbookParser rules, then the local AI). Nothing is saved until the user
 * taps Save in the form.
 */

const LANG_KEY = 'chickpence_voice_lang';

export const VOICE_LANGS = [
  { code: 'fil-PH', label: 'Filipino' },
  { code: 'en-PH', label: 'English (PH)' }
];

/** The browser's SpeechRecognition constructor, or null (Firefox, some iOS versions). */
export function getSpeechRecognition(win = globalThis) {
  return win?.SpeechRecognition || win?.webkitSpeechRecognition || null;
}

export const isSpeechSupported = (win) => !!getSpeechRecognition(win);

export function getVoiceLang() {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (VOICE_LANGS.some((l) => l.code === saved)) return saved;
  } catch (_) {}
  return VOICE_LANGS[0].code;
}

export function setVoiceLang(code) {
  try {
    localStorage.setItem(LANG_KEY, code);
  } catch (_) {}
}

/** User-facing text for a SpeechRecognition error code, or null when it needs no message. */
export function speechErrorMessage(code, lang = '') {
  switch (code) {
    case 'aborted':
      return null;
    case 'no-speech':
      return 'No speech was heard. Tap the mic and try again.';
    case 'audio-capture':
      return 'No microphone was found.';
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone access was blocked. Allow it in the browser to use voice typing.';
    case 'network':
      return 'Voice typing needs internet (the browser turns speech into text online). Type the entry instead.';
    case 'language-not-supported':
      return `This browser cannot recognise ${VOICE_LANGS.find((l) => l.code === lang)?.label || lang}. Try the other language.`;
    default:
      return `Voice typing stopped (${code}).`;
  }
}

/**
 * Listen for one sentence. Calls onInterim(text) while the user speaks,
 * onFinal(text) once with the full transcript, onError(message) on failure,
 * and onEnd() when listening stops without a transcript.
 * Returns { stop } to end listening early (what was heard so far is kept).
 */
export function startDictation({ lang = getVoiceLang(), onInterim, onFinal, onError, onEnd, win } = {}) {
  const Recognition = getSpeechRecognition(win);
  if (!Recognition) {
    onError?.('Voice typing is not supported in this browser. Use Chrome or Edge.');
    return { stop() {} };
  }

  const rec = new Recognition();
  rec.lang = lang;
  rec.interimResults = true;
  rec.continuous = false; // one entry per recording; stops after a pause
  rec.maxAlternatives = 1;

  let finalText = '';
  let interimText = '';
  let failed = false;

  rec.onresult = (event) => {
    let interim = '';
    finalText = '';
    for (let i = 0; i < event.results.length; i++) {
      const piece = event.results[i][0]?.transcript || '';
      if (event.results[i].isFinal) finalText += piece;
      else interim += piece;
    }
    interimText = interim;
    onInterim?.(`${finalText}${interim}`.trim());
  };
  rec.onerror = (event) => {
    const message = speechErrorMessage(event.error, lang);
    if (message) {
      failed = true;
      onError?.(message);
    }
  };
  rec.onend = () => {
    // Stopping early can leave words only in the interim result; keep them
    const text = (finalText || interimText).trim();
    if (text) onFinal?.(text);
    else if (!failed) onEnd?.();
  };

  try {
    rec.start();
  } catch (err) {
    onError?.(`Could not start voice typing: ${err.message}`);
  }
  return { stop: () => rec.stop() };
}
