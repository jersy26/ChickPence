/**
 * insightsCard.js
 * "Suggestions" card on the Dashboard and the Summary page. Shows what
 * insightsService.loadInsights returned; the AI's text is HTML-escaped.
 */

import { escapeHtml } from './importReviewModal.js';

function formatWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function renderList(suggestions) {
  return `
    <ol class="insights-list">
      ${suggestions.map((s) => `
        <li class="insight-item${s.attention ? ' is-attention' : ''}">
          <b class="insight-title">${escapeHtml(s.title)}</b>
          <p class="insight-detail">${escapeHtml(s.detail)}</p>
          <span class="insight-basis">Based on: ${escapeHtml(s.basis.label)}: <b>${escapeHtml(s.basis.text)}</b>${s.basis.note ? ` (${escapeHtml(s.basis.note)})` : ''}</span>
        </li>`).join('')}
    </ol>`;
}

function statusLine(insights) {
  const older = insights.suggestions.length && insights.stale ? ' The suggestions below are from older numbers.' : '';
  switch (insights.status) {
    case 'working':
      return `
        <div class="insights-status">
          <span class="scan-spinner insights-spinner" aria-hidden="true"></span>
          <span>Writing suggestions from the latest numbers… This takes a few minutes on a computer without a graphics card. You can keep using the app.${older}</span>
        </div>`;
    case 'off':
      return `<div class="insights-status is-warn">${escapeHtml(insights.reason)} Suggestions are written when the local AI is running.${older}</div>`;
    case 'failed':
      return `<div class="insights-status is-warn">Could not write suggestions: ${escapeHtml(insights.error)}${insights.suggestions.length ? ' The suggestions below are from an earlier try.' : ''}</div>`;
    case 'empty':
      return `<div class="insights-status text-mut">Add records to a batch to get suggestions.</div>`;
    default:
      return '';
  }
}

/** @param {object|null} insights – result of loadInsights; null hides the card */
export function renderInsightsCard(insights) {
  if (!insights) return '';
  const canRefresh = insights.status === 'ready' || insights.status === 'failed';
  const updated = insights.createdAt && insights.suggestions.length
    ? ` · Updated ${escapeHtml(formatWhen(insights.createdAt))}`
    : '';

  return `
    <div class="card-box insights-card" id="insights-card">
      <div class="insights-head">
        <h2>Suggestions</h2>
        <span class="badge-pill ai-badge">AI-generated</span>
        ${canRefresh ? `<button type="button" class="btn-link insights-refresh" id="btn-insights-refresh">${insights.status === 'failed' ? 'Try again' : '↻ Refresh'}</button>` : ''}
      </div>
      ${statusLine(insights)}
      ${insights.suggestions.length ? `<div class="${insights.stale ? 'is-stale' : ''}">${renderList(insights.suggestions)}</div>` : ''}
      <div class="text-mut ai-hint">
        Written by the local AI on this computer from the farm's computed numbers only (no buyer names). Advice only: check before acting.${updated}
      </div>
    </div>`;
}

export function attachInsightsCard(container, onRefresh) {
  container.querySelector('#btn-insights-refresh')?.addEventListener('click', onRefresh);
}

/** Swap the card in place (no full re-render, so charts are not redrawn). */
export function replaceInsightsCard(container, insights, onRefresh) {
  const card = container.querySelector('#insights-card');
  if (!card) return false;
  card.outerHTML = renderInsightsCard(insights);
  attachInsightsCard(container, onRefresh);
  return true;
}
