import { openModal, closeModal } from './modals.js';
import { showToast } from './toast.js';
import { escapeHtml } from './importReviewModal.js';
import { getLlmSettings, setLlmSettings, listModels } from '../services/localLlm.js';
import { VOICE_MODELS, getVoiceModel, setVoiceModel } from '../services/speechInput.js';

/** Modal body (pure, testable without a DOM). */
export function renderLocalAiModal(settings, installed = null, voiceModel = getVoiceModel()) {
  const options = (selected) => {
    if (!installed?.length) return '';
    return installed
      .map((m) => `<option value="${escapeHtml(m)}" ${m === selected || m === `${selected}:latest` ? 'selected' : ''}>${escapeHtml(m)}</option>`)
      .join('');
  };
  const modelField = (id, label, hint, value) => installed?.length
    ? `<label class="form-field">${label}<select id="${id}">${options(value)}</select><span class="text-mut ai-hint">${hint}</span></label>`
    : `<label class="form-field">${label}<input id="${id}" type="text" value="${escapeHtml(value)}" /><span class="text-mut ai-hint">${hint}</span></label>`;

  return `
    <div class="flex-row">
      <h2>Local AI Settings</h2>
      <button class="btn-icon" id="btn-close-modal" aria-label="Close">✕</button>
    </div>
    <div class="text-mut">
      Logbook scanning and suggestions run on this computer with <b>Ollama</b>. Photos and records never leave the farm and no internet is needed.
    </div>

    <label class="form-field">
      Ollama address
      <input id="input-llm-url" type="text" value="${escapeHtml(settings.url)}" placeholder="http://localhost:11434" />
    </label>
    ${modelField('input-llm-ocr', 'Reading model (vision)', 'Reads the photo into text. Example: glm-ocr', settings.ocrModel)}
    ${modelField('input-llm-text', 'Sorting model', 'Turns the text into entries. Example: qwen3.5:4b', settings.textModel)}

    <div class="text-mut ai-hint" id="llm-test-result">
      ${installed === null ? '' : installed.length ? `Connected · ${installed.length} models installed.` : 'Connected, but no models are installed.'}
    </div>

    <label class="form-field">
      Voice typing model
      <select id="input-voice-model">
        ${VOICE_MODELS.map((m) => `<option value="${escapeHtml(m.id)}" ${m.id === voiceModel ? 'selected' : ''}>${escapeHtml(m.label)}</option>`).join('')}
      </select>
      <span class="text-mut ai-hint">Whisper runs in this browser, so the recording never leaves the device. It is downloaded once, the first time you use the mic.</span>
    </label>

    <div class="flex-row" style="margin-top: 4px;">
      <button class="btn-action" id="btn-test-llm">Test connection</button>
      <div style="display:flex;gap:8px;">
        <button class="btn-action" id="btn-reset-llm">Defaults</button>
        <button class="btn-action primary" id="btn-save-llm">Save</button>
      </div>
    </div>
  `;
}

export function openLocalAiModal(onSaved) {
  const show = (settings, installed, voiceModel = getVoiceModel()) => {
    openModal(renderLocalAiModal(settings, installed, voiceModel));
    const root = document.getElementById('modal');
    const read = () => ({
      url: root.querySelector('#input-llm-url').value.trim(),
      ocrModel: root.querySelector('#input-llm-ocr').value.trim(),
      textModel: root.querySelector('#input-llm-text').value.trim()
    });
    const readVoiceModel = () => root.querySelector('#input-voice-model').value;

    root.querySelector('#btn-close-modal').addEventListener('click', closeModal);

    root.querySelector('#btn-test-llm').addEventListener('click', async () => {
      const current = read();
      const result = root.querySelector('#llm-test-result');
      result.textContent = 'Checking…';
      try {
        const models = await listModels(current.url.replace(/\/+$/, ''));
        show(current, models, readVoiceModel()); // re-render with model dropdowns
      } catch (_) {
        result.textContent = `Cannot reach Ollama at ${current.url}. Start the Ollama app, then try again.`;
      }
    });

    root.querySelector('#btn-reset-llm').addEventListener('click', () => {
      setLlmSettings(null);
      setVoiceModel(null);
      show(getLlmSettings(), installed);
      showToast('Local AI settings reset to defaults');
    });

    root.querySelector('#btn-save-llm').addEventListener('click', () => {
      const s = read();
      if (!s.url || !s.ocrModel || !s.textModel) return showToast('Fill in the address and both models.');
      setLlmSettings(s);
      setVoiceModel(readVoiceModel());
      closeModal();
      showToast('Local AI settings saved');
      onSaved?.();
    });
  };

  show(getLlmSettings(), null);
}
