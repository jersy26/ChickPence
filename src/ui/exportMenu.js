import { showToast } from './toast.js';

const LABELS = { xlsx: 'Excel', pdf: 'PDF', csv: 'CSV' };

/** Row of export buttons. `scope` namespaces the buttons per view. */
export function renderExportButtons(scope) {
  return `
    <div class="export-group" data-export-scope="${scope}" role="group" aria-label="Export report">
      <span class="text-mut">Export</span>
      ${Object.entries(LABELS)
        .map(([fmt, label]) => `<button class="btn-action export-btn" data-export="${fmt}" title="Download as ${label}">${label}</button>`)
        .join('')}
    </div>`;
}

/**
 * Wire the buttons rendered by renderExportButtons.
 * @param {(format: string) => Promise<string>} onExport – resolves with the file name
 */
export function attachExportListeners(container, scope, onExport) {
  const group = container.querySelector(`[data-export-scope="${scope}"]`);
  if (!group) return;

  group.querySelectorAll('[data-export]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const buttons = group.querySelectorAll('[data-export]');
      buttons.forEach((b) => (b.disabled = true));
      const original = btn.textContent;
      btn.textContent = 'Preparing…';
      try {
        const fileName = await onExport(btn.getAttribute('data-export'));
        showToast(`Downloaded ${fileName}`);
      } catch (err) {
        console.error('Export failed', err);
        showToast(`Export failed: ${err.message}`);
      } finally {
        btn.textContent = original;
        buttons.forEach((b) => (b.disabled = false));
      }
    });
  });
}
