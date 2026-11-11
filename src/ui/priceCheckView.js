/**
 * priceCheckView.js
 * "The buyer offers ₱___/kg. Am I losing money?" (thesis SOP 3.3, audit section 9).
 */

import { calcBatchMetrics, liveHeadCount, toCentavos, toGrams, saleAmountCentavos } from '../services/allocationEngine.js';
import { formatPeso, formatNumber } from '../services/calculations.js';
import { kgPerHead, addDays } from '../services/guidedQuestions.js';
import { escapeHtml } from './html.js';

/** a × b ÷ c rounded half up, for whole numbers a, b ≥ 0 and c > 0. */
const mulDivHalfUp = (a, b, c) => Math.floor((2 * a * b + c) / (2 * c));

/**
 * Result of selling `heads` birds weighing `kg` at `price` per kg (pure).
 * The birds sold carry their share of the cost not yet recovered:
 *   share     = (cost to date − sales to date) × heads ÷ live birds
 *   breakEven = share ÷ kg
 * Worked in whole centavos and grams (NFR-04); the result is returned in pesos.
 */
export function priceCheck({ totalCost, revenue, live, heads, kg, price }) {
  const unrecoveredC = Math.max(0, toCentavos(totalCost) - toCentavos(revenue));
  const h = Math.min(Math.max(0, Math.floor(Number(heads) || 0)), live);
  const grams = Math.max(0, toGrams(kg));
  const p = Math.max(0, Number(price) || 0);
  const shareC = live > 0 ? mulDivHalfUp(unrecoveredC, h, live) : 0;
  // The same rule as a saved sale's amount
  const saleC = saleAmountCentavos({ weight_kg: grams / 1000, price_per_kg: p });
  const resultC = saleC - shareC;
  // Centavos per kg: share × 1,000 ÷ grams
  const breakEvenC = grams > 0 ? mulDivHalfUp(shareC, 1000, grams) : null;
  return {
    unrecovered: unrecoveredC / 100,
    heads: h,
    share: shareC / 100,
    saleRevenue: saleC / 100,
    result: resultC / 100,
    breakEven: breakEvenC == null ? null : breakEvenC / 100,
    verdict: grams <= 0 || h <= 0 || p <= 0 ? 'incomplete' : resultC >= 0 ? 'profit' : 'loss'
  };
}

/** Numbers the form needs for each open batch (pure). */
export function priceCheckBasis(item, closedBatchesWithData, today) {
  const m = calcBatchMetrics(item.batch, item.allocations || [], item.sales || [], item.mortality || [], item.feed || []);
  const live = liveHeadCount(item.batch, item.mortality || [], item.sales || [], addDays(today, 1));
  const perHead = kgPerHead(item.sales) ?? kgPerHead(closedBatchesWithData.flatMap((c) => c.sales || [])) ?? 2;
  return { totalCost: m.totalCost, revenue: m.revenue, live, perHead };
}

export function renderPriceCheck(openBatchesData, closedBatchesWithData, today, input = {}) {
  if (!openBatchesData.length) {
    return `<section class="page-section"><div class="page-head"><h1>Price check</h1></div><div class="card-box text-mut">No open batch to sell from.</div></section>`;
  }
  const item = openBatchesData.find((d) => d.batch.batch_id === input.batchId) || openBatchesData[0];
  const basis = priceCheckBasis(item, closedBatchesWithData, today);
  const heads = input.heads ?? basis.live;
  const kg = input.kg ?? Math.round(heads * basis.perHead);
  const price = input.price ?? '';
  const r = priceCheck({ ...basis, heads, kg, price });
  const verdict = r.verdict === 'incomplete'
    ? `<div class="pc-verdict"><b>Enter the buyer's price</b><span>The result shows here as you type.</span></div>`
    : `<div class="pc-verdict ${r.verdict}" role="status"><b>${r.verdict === 'profit' ? 'Profit' : 'Loss'}: ${formatPeso(Math.abs(r.result))}</b><span>${r.verdict === 'profit' ? 'This sale covers its share of the batch cost.' : `At ${formatPeso(price)}/kg you lose money. You need at least ${formatPeso(r.breakEven)}/kg.`}</span></div>`;
  return `<section class="page-section" aria-labelledby="pc-title">
    <div class="page-head"><div><h1 id="pc-title">Price check</h1><p class="text-mut">Test a buyer's offer before you agree. Nothing is saved.</p></div></div>
    <div class="pc-grid">
      <form class="card-box pc-form" id="pc-form">
        <label>Batch<select name="batchId">${openBatchesData.map((d) => `<option value="${escapeHtml(d.batch.batch_id)}" ${d === item ? 'selected' : ''}>${escapeHtml(d.batch.batch_name)}</option>`).join('')}</select></label>
        <label>Buyer's price per kg (₱)<input name="price" type="number" inputmode="decimal" min="0" step="0.01" value="${escapeHtml(price)}" placeholder="e.g. 120" autofocus /></label>
        <button type="button" class="btn-action" id="pc-sell-all">Sell all live birds</button><label>Birds to sell<input name="heads" type="number" inputmode="numeric" min="0" max="${basis.live}" step="1" value="${escapeHtml(heads)}" /><small class="text-mut">${basis.live.toLocaleString()} live birds in this batch</small></label>
        <label>Total weight (kg)<input name="kg" type="number" inputmode="decimal" min="0" step="0.01" value="${escapeHtml(kg)}" /><small class="text-mut">Estimated at ${formatNumber(basis.perHead, 2)} kg per bird</small></label>
      </form>
      <div class="card-box pc-result">
        ${verdict}
        <dl class="gq-numbers">
          <div><dt>Break-even price for this sale</dt><dd>${r.breakEven != null && r.heads > 0 ? `${formatPeso(r.breakEven)}/kg` : '—'}</dd></div>
          <div><dt>This sale brings in</dt><dd>${formatPeso(r.saleRevenue)}</dd></div>
          <div><dt>Cost allocated to this sale</dt><dd>${formatPeso(r.share)}</dd></div>
          <div><dt>Remaining cost across all live birds</dt><dd>${formatPeso(r.unrecovered)}</dd></div>
          <div><dt>Batch cost to date</dt><dd>${formatPeso(basis.totalCost)}</dd></div>
          <div><dt>Batch sales to date</dt><dd>${formatPeso(basis.revenue)}</dd></div>
        </dl>
        ${r.verdict!=='incomplete'?'<button type="button" class="btn-action primary" id="pc-record-sale">Record this sale</button>':''}
        <p class="gq-source">Each bird sold carries an equal share of the cost the batch has not yet recovered.</p>
      </div>
    </div>
  </section>`;
}

export function attachPriceCheckListeners(container, onInput) {
  const form = container.querySelector('#pc-form');
  if (!form) return;
  let timer = null;
  const read = (changedBatch) => {
    const d = Object.fromEntries(new FormData(form).entries());
    if (changedBatch) return onInput({ batchId: d.batchId, price: d.price });
    onInput({ batchId: d.batchId, price: d.price, heads: d.heads === '' ? 0 : Number(d.heads), kg: d.kg === '' ? 0 : Number(d.kg) }, document.activeElement?.name);
  };
  form.addEventListener('input', (e) => {
    clearTimeout(timer);
    if (e.target.name === 'batchId') return read(true);
    timer = setTimeout(() => read(false), 250);
  });
}
