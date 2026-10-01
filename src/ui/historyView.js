import {
  calcBatchMetrics
} from '../services/allocationEngine.js';
import {
  formatPeso,
  formatPercent,
  formatDate
} from '../services/calculations.js';

export function renderHistory(batchesWithFullData, searchQuery = '', statusFilter = 'All') {
  const query = searchQuery.trim().toLowerCase();

  const filteredBatches = batchesWithFullData.filter((item) => {
    const matchesQuery = item.batch.batch_name.toLowerCase().includes(query);
    const matchesStatus =
      statusFilter === 'All' ||
      (statusFilter === 'Open' && item.batch.status === 'Open') ||
      (statusFilter === 'Closed' && item.batch.status === 'Closed');
    return matchesQuery && matchesStatus;
  });

  const chips = ['All', 'Open', 'Closed']
    .map(
      (s) => `
      <button class="chip-filter ${statusFilter === s ? 'active' : ''}" data-filter-status="${s}">
        ${s}
      </button>`
    )
    .join('');

  const rowsHtml = filteredBatches.length
    ? filteredBatches.map((item) => {
        const { batch, allocations, sales, mortality, feed } = item;
        const isClosed = batch.status === 'Closed';

        const metrics = calcBatchMetrics(batch, allocations, sales, mortality, feed);
        const profit = metrics.netProfit;
        const margin = metrics.margin;
        const mortalityRate = metrics.mortalityRate;

        const profitDisplay = isClosed
          ? `<span style="color:${typeof profit === 'number' && profit < 0 ? 'var(--bad)' : 'var(--ink)'}">${formatPeso(profit)}</span>`
          : `<span class="text-mut">—</span>`;

        const marginDisplay = isClosed && margin !== 'N/A'
          ? formatPercent(margin)
          : `<span class="text-mut">${isClosed ? 'N/A' : '—'}</span>`;

        const statusBadge = batch.status === 'Open'
          ? `<span class="badge-pill status-open">Open</span>`
          : `<span class="badge-pill">Closed</span>`;

        return `
          <tr class="clickable-row" data-history-row data-batch-id="${batch.batch_id}" data-status="${batch.status}">
            <td><b>${batch.batch_name}</b></td>
            <td>${formatDate(batch.start_date, true)}</td>
            <td>${batch.end_date ? formatDate(batch.end_date, true) : '—'}</td>
            <td>${batch.initial_chick_count.toLocaleString()}</td>
            <td>${statusBadge}</td>
            <td>${profitDisplay}</td>
            <td>${marginDisplay}</td>
            <td>${formatPercent(mortalityRate)}</td>
          </tr>`;
      }).join('')
    : `<tr><td colspan="8" class="text-mut" style="text-align:center;padding:24px;">No batches found matching filter criteria.</td></tr>`;

  return `
    <div class="top-bar">
      <h1>Batch History</h1>
    </div>

    <div class="flex-row" style="flex-wrap: wrap; gap: 12px;">
      <input
        id="history-search-input"
        type="text"
        placeholder="🔍 Search batch name…"
        value="${searchQuery}"
        style="max-width: 280px;"
      />
      <div class="chips-container">
        ${chips}
      </div>
    </div>

    <div class="card-box table-wrap">
      <table>
        <thead>
          <tr>
            <th>Batch</th>
            <th>Start Date</th>
            <th>End Date</th>
            <th>Initial Chicks</th>
            <th>Status</th>
            <th>Net Profit</th>
            <th>Profit Margin</th>
            <th>Mortality Rate</th>
          </tr>
        </thead>
        <tbody id="history-table-body">
          ${rowsHtml}
        </tbody>
      </table>
    </div>
  `;
}

export function attachHistoryListeners(container, onNavigate, onFilterChange) {
  const searchInput = container.querySelector('#history-search-input');
  searchInput?.addEventListener('input', (e) => {
    onFilterChange(e.target.value, null);
  });

  container.querySelectorAll('[data-filter-status]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const status = btn.getAttribute('data-filter-status');
      onFilterChange(null, status);
    });
  });

  container.querySelectorAll('[data-history-row]').forEach((row) => {
    row.addEventListener('click', () => {
      const batchId = row.getAttribute('data-batch-id');
      const status = row.getAttribute('data-status');
      if (status === 'Open') {
        onNavigate('batches');
      } else {
        onNavigate('summary', batchId);
      }
    });
  });
}
