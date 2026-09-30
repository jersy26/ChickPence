let toastTimer = null;

export function showToast(message, duration = 2400) {
  const toastEl = document.getElementById('toast');
  if (!toastEl) return;

  toastEl.textContent = message;
  toastEl.classList.add('show');

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.classList.remove('show');
  }, duration);
}

// Global listener for custom toast events
window.addEventListener('chickpence-toast', (e) => {
  if (e.detail) {
    showToast(e.detail);
  }
});
