/**
 * html.js
 * The views build their markup as strings, so every value that is not the
 * app's own text goes through escapeHtml: batch and buyer names come from
 * other devices (sync), imported files and the local AI, and would otherwise
 * run as HTML in this page.
 */

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
