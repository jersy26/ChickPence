/**
 * Export service – turns batch data into Excel (.xlsx), PDF and CSV files.
 *
 * Everything runs in the browser and works offline. The heavy libraries
 * (write-excel-file, jsPDF) are lazy-loaded on first export so they stay
 * out of the main PWA bundle.
 *
 * Pipeline: Repository data → build*Report() (pure) → to*Blob() → download.
 */
import { calcBatchMetrics, centavosToFloat } from './allocationEngine.js';

const NA = 'N/A';

// ---------------------------------------------------------------------------
// 1. COLUMN KINDS
// ---------------------------------------------------------------------------
// Each table column declares a kind so every output format can render the
// same raw value its own way (Excel number formats, PDF strings, CSV plain).

const COL = {
  date: 'date',
  text: 'text',
  int: 'int',
  kg: 'kg',
  peso: 'peso',
  pct: 'pct',
  ratio: 'ratio'
};

const col = (header, kind, width = 14) => ({ header, kind, width });

// ---------------------------------------------------------------------------
// 2. REPORT BUILDERS (pure)
// ---------------------------------------------------------------------------

/**
 * Build a format-neutral report for one batch.
 *
 * @param {object} batchData    – { batch, feed, mortality, sales, allocations }
 * @param {Map}    expensesById – expense_id → expense row (for entry dates)
 */
export function buildBatchReport(batchData, expensesById = new Map()) {
  const { batch, feed, mortality, sales, allocations } = batchData;
  const metrics = calcBatchMetrics(batch, allocations, sales, mortality, feed);

  const summary = {
    columns: [col('Metric', COL.text, 28), col('Value', COL.text, 18)],
    rows: [
      ['Batch', batch.batch_name],
      ['Status', batch.status === 'Open' ? 'Open (provisional)' : 'Closed (final)'],
      ['Start date', { kind: COL.date, value: batch.start_date }],
      ['End date', batch.end_date ? { kind: COL.date, value: batch.end_date } : 'Present'],
      ['Initial chicks', { kind: COL.int, value: batch.initial_chick_count }],
      ['Chick cost', { kind: COL.peso, value: metrics.chickCost }],
      ['Feed cost (allocated)', { kind: COL.peso, value: metrics.allocFeedPeso }],
      ['Other costs (allocated)', { kind: COL.peso, value: metrics.allocOtherPeso }],
      ['Total production cost', { kind: COL.peso, value: metrics.totalCost }],
      ['Sales revenue', { kind: COL.peso, value: metrics.revenue }],
      ['Net profit', { kind: COL.peso, value: metrics.netProfit }],
      ['Profit margin', { kind: COL.pct, value: metrics.margin }],
      ['Return on batch cost', { kind: COL.pct, value: metrics.robc }],
      ['Kg sold', { kind: COL.kg, value: metrics.kgSold }],
      ['Cost per kg', { kind: COL.peso, value: metrics.costPerKg }],
      ['Profit per kg', { kind: COL.peso, value: metrics.profitPerKg }],
      ['Feed consumed (kg)', { kind: COL.kg, value: metrics.totalFeedKg }],
      ['FCR (sales-based)', { kind: COL.ratio, value: metrics.fcr }],
      ['Total deaths', { kind: COL.int, value: metrics.totalDeaths }],
      ['Mortality rate', { kind: COL.pct, value: metrics.mortalityRate }],
      [
        'Mortality threshold',
        batch.mortality_threshold_pct != null
          ? { kind: COL.pct, value: Number(batch.mortality_threshold_pct) }
          : 'None'
      ]
    ]
  };

  const byDate = (key) => (a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0);

  const expenseRows = allocations
    .filter((a) => !a.deleted_at)
    .map((a) => {
      const e = expensesById.get(a.expense_id);
      return {
        entry_date: e?.entry_date ?? '',
        feed: centavosToFloat(a.feed_centavos),
        other: centavosToFloat(a.other_centavos),
        basis: `${num(a.basis_heads, 0)} / ${num(a.total_heads, 0)} heads`
      };
    })
    .sort(byDate('entry_date'));

  const expenses = {
    columns: [
      col('Date', COL.date, 12),
      col('Feed cost', COL.peso),
      col('Other cost', COL.peso),
      col('Total', COL.peso),
      col('Allocation basis', COL.text, 20)
    ],
    rows: expenseRows.map((r) => [r.entry_date, r.feed, r.other, r.feed + r.other, r.basis])
  };

  const feedTable = {
    columns: [col('Date', COL.date, 12), col('Quantity (kg)', COL.kg)],
    rows: feed
      .filter((f) => !f.deleted_at)
      .slice()
      .sort(byDate('entry_date'))
      .map((f) => [
        f.entry_date,
        f.quantity_g !== undefined ? (Number(f.quantity_g) || 0) / 1000 : Number(f.quantity_kg) || 0
      ])
  };

  const mortalityTable = {
    columns: [col('Date', COL.date, 12), col('Deaths', COL.int, 10), col('Cumulative', COL.int, 12)],
    rows: (() => {
      let running = 0;
      return mortality
        .filter((m) => !m.deleted_at)
        .slice()
        .sort(byDate('entry_date'))
        .map((m) => {
          running += Number(m.count) || 0;
          return [m.entry_date, Number(m.count) || 0, running];
        });
    })()
  };

  const salesTable = {
    columns: [
      col('Date', COL.date, 12),
      col('Buyer', COL.text, 22),
      col('Heads', COL.int, 10),
      col('Weight (kg)', COL.kg),
      col('Price per kg', COL.peso),
      col('Total', COL.peso)
    ],
    rows: sales
      .filter((s) => !s.deleted_at)
      .slice()
      .sort(byDate('sale_date'))
      .map((s) => [
        s.sale_date,
        s.buyer_name ?? '',
        Number(s.quantity_sold) || 0,
        Number(s.weight_kg) || 0,
        Number(s.price_per_kg) || 0,
        Number(s.total_amount) || 0
      ])
  };

  return {
    title: `${batch.batch_name} – Batch Summary Report`,
    fileBase: `ChickPence_${safeFileName(batch.batch_name)}`,
    batch,
    metrics,
    sections: [
      { name: 'Summary', table: summary },
      { name: 'Expenses', table: expenses },
      { name: 'Feed', table: feedTable },
      { name: 'Mortality', table: mortalityTable },
      { name: 'Sales', table: salesTable }
    ]
  };
}

/**
 * The farm expenses themselves (not a batch's allocated share), oldest first.
 * This is what restores a farm's expenses when the file is imported back.
 * @param {object[]} expenses – expense rows ({ entry_date, feed_centavos, other_centavos })
 */
export function buildFarmExpensesTable(expenses = []) {
  return {
    columns: [col('Date', COL.date, 12), col('Feed cost', COL.peso), col('Other cost', COL.peso), col('Total', COL.peso)],
    rows: expenses
      .filter((e) => !e.deleted_at)
      .slice()
      .sort((a, b) => (a.entry_date < b.entry_date ? -1 : a.entry_date > b.entry_date ? 1 : 0))
      .map((e) => {
        const feed = centavosToFloat(e.feed_centavos);
        const other = centavosToFloat(e.other_centavos);
        return [e.entry_date, feed, other, feed + other];
      })
  };
}

/** Report of every farm expense (Export → Farm expenses). */
export function buildFarmExpensesReport(expenses) {
  return {
    title: 'Farm Expenses Report',
    fileBase: 'ChickPence_Farm_Expenses',
    sections: [{ name: 'Farm expenses', table: buildFarmExpensesTable(expenses) }]
  };
}

/**
 * Build a report comparing many batches (History page export). With
 * expenses, Excel and PDF also get a "Farm expenses" sheet / section.
 * @param {object[]} batchDataList – array of { batch, feed, mortality, sales, allocations }
 * @param {object[]} [expenses]    – the farm expenses
 */
export function buildBatchListReport(batchDataList, expenses = null) {
  const rows = batchDataList.map(({ batch, feed, mortality, sales, allocations }) => {
    const m = calcBatchMetrics(batch, allocations, sales, mortality, feed);
    return [
      batch.batch_name,
      batch.status,
      batch.start_date,
      batch.end_date ?? '',
      Number(batch.initial_chick_count) || 0,
      m.totalCost,
      m.revenue,
      m.netProfit,
      m.margin,
      m.mortalityRate,
      m.totalFeedKg,
      m.fcr
    ];
  });

  return {
    title: 'Batch History Report',
    fileBase: 'ChickPence_Batch_History',
    sections: [
      {
        name: 'Batches',
        table: {
          columns: [
            col('Batch', COL.text, 20),
            col('Status', COL.text, 8),
            col('Start date', COL.date, 12),
            col('End date', COL.date, 12),
            col('Initial chicks', COL.int, 12),
            col('Total cost', COL.peso),
            col('Revenue', COL.peso),
            col('Net profit', COL.peso),
            col('Margin', COL.pct, 10),
            col('Mortality', COL.pct, 10),
            col('Feed (kg)', COL.kg, 12),
            col('FCR', COL.ratio, 8)
          ],
          rows
        }
      },
      ...(expenses ? [{ name: 'Farm expenses', table: buildFarmExpensesTable(expenses) }] : [])
    ]
  };
}

// ---------------------------------------------------------------------------
// 3. VALUE HELPERS (pure)
// ---------------------------------------------------------------------------

export function safeFileName(name) {
  return String(name || 'batch').replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '') || 'batch';
}

/** A summary cell may carry its own kind ({ kind, value }); table cells use the column kind. */
function unwrap(cell, columnKind) {
  if (cell && typeof cell === 'object' && 'kind' in cell) return { kind: cell.kind, value: cell.value };
  return { kind: columnKind, value: cell };
}

const isBlank = (v) => v === null || v === undefined || v === '' || v === NA;

/** 'YYYY-MM-DD' → Date at UTC midnight (Excel serials are UTC-based). */
function isoToUtcDate(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return y && m && d ? new Date(Date.UTC(y, m - 1, d)) : null;
}

const num = (v, decimals) =>
  Number(v).toLocaleString('en-PH', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

/**
 * Human-readable text for PDF. The PDF embeds Noto Sans (assets/fonts), which
 * has the ₱ sign that jsPDF's built-in fonts lack.
 */
export function formatForText(value, kind) {
  if (isBlank(value)) return value === NA ? NA : '—';
  switch (kind) {
    case COL.peso: return `${value < 0 ? '-' : ''}₱${num(Math.abs(value), 2)}`;
    case COL.pct: return `${num(value, 2)}%`;
    case COL.kg: return num(value, 2);
    case COL.int: return num(value, 0);
    case COL.ratio: return num(value, 2);
    default: return String(value);
  }
}

// ---------------------------------------------------------------------------
// 4. CSV (pure)
// ---------------------------------------------------------------------------

/**
 * Escape one CSV field. Text starting with = + - @ is prefixed with a quote
 * so spreadsheet apps don't run it as a formula (CSV injection).
 */
export function csvField(value) {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvValue(value, kind) {
  if (isBlank(value)) return value === NA ? NA : '';
  if (typeof value === 'number') {
    if (kind === COL.int) return String(Math.round(value));
    return String(+value.toFixed(kind === COL.ratio ? 4 : 2));
  }
  return value;
}

/** One table → CSV text with a UTF-8 BOM so Excel reads ₱ and ñ correctly. */
export function tableToCsv(table) {
  const lines = [table.columns.map((c) => csvField(c.header)).join(',')];
  for (const row of table.rows) {
    lines.push(
      row
        .map((cell, i) => {
          const { kind, value } = unwrap(cell, table.columns[i].kind);
          return csvField(csvValue(value, kind));
        })
        .join(',')
    );
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}

/**
 * CSV is a single table, so a batch export becomes one flat ledger:
 * one row per expense share, feed log, mortality log and sale.
 */
export function buildBatchLedger(report) {
  const get = (name) => report.sections.find((s) => s.name === name).table.rows;
  const { batch, metrics } = report;

  const rows = [
    [batch.start_date, 'Chicks', '', Number(batch.initial_chick_count) || 0, '', '', '', '', metrics.chickCost],
    ...get('Expenses').map(([date, feed, other, total]) => [date, 'Expense', '', '', '', '', '', '', total, feed, other]),
    ...get('Feed').map(([date, kg]) => [date, 'Feed', '', '', '', '', kg, '', '']),
    ...get('Mortality').map(([date, deaths]) => [date, 'Mortality', '', '', '', '', '', deaths, '']),
    ...get('Sales').map(([date, buyer, heads, kg, ppk, total]) => [date, 'Sale', buyer, heads, kg, ppk, '', '', total])
  ].map((r) => {
    while (r.length < 11) r.push('');
    return r;
  });

  rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

  return {
    columns: [
      col('Date', COL.date),
      col('Type', COL.text),
      col('Buyer', COL.text),
      col('Heads', COL.int),
      col('Weight (kg)', COL.kg),
      col('Price per kg', COL.peso),
      col('Feed (kg)', COL.kg),
      col('Deaths', COL.int),
      col('Amount', COL.peso),
      col('Feed cost', COL.peso),
      col('Other cost', COL.peso)
    ],
    rows
  };
}

// ---------------------------------------------------------------------------
// 5. EXCEL
// ---------------------------------------------------------------------------

const XLSX_FORMATS = {
  [COL.peso]: '#,##0.00',
  [COL.kg]: '#,##0.00',
  [COL.int]: '#,##0',
  [COL.ratio]: '0.00',
  [COL.pct]: '0.00"%"'
};

function xlsxCell(cell, columnKind) {
  const { kind, value } = unwrap(cell, columnKind);
  if (isBlank(value)) return value === NA ? { value: NA, type: String, align: 'right' } : null;
  if (kind === COL.date) {
    const d = isoToUtcDate(value);
    return d ? { value: d, type: Date, format: 'yyyy-mm-dd' } : { value: String(value), type: String };
  }
  if (typeof value === 'number') return { value, type: Number, format: XLSX_FORMATS[kind] };
  return { value: String(value), type: String };
}

export function buildXlsxSheets(report) {
  return report.sections.map(({ name, table }) => ({
    sheet: name,
    columns: table.columns.map((c) => ({ width: c.width })),
    stickyRowsCount: 1,
    data: [
      table.columns.map((c) => ({
        value: c.header,
        type: String,
        fontWeight: 'bold',
        backgroundColor: '#F6E7B8'
      })),
      ...table.rows.map((row) => row.map((cell, i) => xlsxCell(cell, table.columns[i].kind)))
    ]
  }));
}

async function toXlsxBlob(report) {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  return writeXlsxFile(buildXlsxSheets(report), { fontFamily: 'Calibri', fontSize: 11 }).toBlob();
}

// ---------------------------------------------------------------------------
// 6. PDF
// ---------------------------------------------------------------------------

const BRAND_RGB = [201, 138, 0]; // --acc
const INK_RGB = [42, 40, 32];    // --ink

const PDF_FONT = 'NotoSans';

async function toPdfBlob(report) {
  const [{ jsPDF }, { autoTable }, fonts] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    import('../assets/fonts/notoSansPdf.js')
  ]);
  const wide = report.sections.some((s) => s.table.columns.length > 8);
  const doc = new jsPDF({ orientation: wide ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' });
  const margin = 40;

  // Noto Sans has the ₱ sign (jsPDF's built-in Helvetica does not)
  doc.addFileToVFS('NotoSans-Regular.ttf', fonts.NOTO_SANS_REGULAR);
  doc.addFont('NotoSans-Regular.ttf', PDF_FONT, 'normal');
  doc.addFileToVFS('NotoSans-Bold.ttf', fonts.NOTO_SANS_BOLD);
  doc.addFont('NotoSans-Bold.ttf', PDF_FONT, 'bold');

  doc.setTextColor(...INK_RGB);
  doc.setFont(PDF_FONT, 'bold');
  doc.setFontSize(16);
  doc.text(report.title, margin, 48);
  doc.setFont(PDF_FONT, 'normal');
  doc.setFontSize(9);
  doc.setTextColor(120, 118, 112);
  doc.text(`Generated by ChickPence on ${new Date().toLocaleString('en-PH')}`, margin, 64);

  let y = 80;
  for (const { name, table } of report.sections) {
    doc.setFont(PDF_FONT, 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...INK_RGB);
    // Keep a section heading with its header row and first few data rows
    if (y > doc.internal.pageSize.getHeight() - 140) {
      doc.addPage();
      y = 48;
    }
    doc.text(name, margin, y + 12);

    const body = table.rows.length
      ? table.rows.map((row) =>
          row.map((cell, i) => {
            const { kind, value } = unwrap(cell, table.columns[i].kind);
            return formatForText(value, kind);
          })
        )
      : [[{ content: 'No records.', colSpan: table.columns.length, styles: { textColor: [120, 118, 112] } }]];

    autoTable(doc, {
      startY: y + 18,
      margin: { left: margin, right: margin },
      head: [table.columns.map((c) => c.header)],
      body,
      theme: 'grid',
      styles: { font: PDF_FONT, fontSize: 8.5, cellPadding: 4, textColor: INK_RGB, lineColor: [229, 226, 216] },
      headStyles: { fillColor: BRAND_RGB, textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [250, 250, 248] },
      columnStyles: Object.fromEntries(
        table.columns.map((c, i) => [i, { halign: [COL.text, COL.date].includes(c.kind) ? 'left' : 'right' }])
      )
    });
    y = doc.lastAutoTable.finalY + 24;
  }

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont(PDF_FONT, 'normal');
    doc.setFontSize(8);
    doc.setTextColor(120, 118, 112);
    const { width, height } = doc.internal.pageSize;
    doc.text(`Page ${p} of ${pages}`, width - margin, height - 20, { align: 'right' });
  }

  return doc.output('blob');
}

// ---------------------------------------------------------------------------
// 7. DOWNLOAD + PUBLIC API
// ---------------------------------------------------------------------------

export const EXPORT_FORMATS = ['xlsx', 'pdf', 'csv'];

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Local date (not UTC – in the Philippines UTC is still "yesterday" before 8 AM). */
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * Render a report as a Blob in the given format.
 * @param {object} report   – from buildBatchReport / buildBatchListReport
 * @param {'xlsx'|'pdf'|'csv'} format
 * @param {object} [csvTable] – table to use for CSV (defaults to the first section)
 */
export async function renderReportBlob(report, format, csvTable = report.sections[0].table) {
  if (format === 'xlsx') return toXlsxBlob(report);
  if (format === 'pdf') return toPdfBlob(report);
  if (format === 'csv') return new Blob([tableToCsv(csvTable)], { type: 'text/csv;charset=utf-8' });
  throw new Error(`Unknown export format: ${format}`);
}

/** Render a report and trigger the download. Resolves with the file name. */
export async function exportReport(report, format, csvTable) {
  const fileName = `${report.fileBase}_${today()}.${format}`;
  downloadBlob(await renderReportBlob(report, format, csvTable), fileName);
  return fileName;
}

export async function exportBatch(batchData, expensesById, format) {
  const report = buildBatchReport(batchData, expensesById);
  return exportReport(report, format, buildBatchLedger(report));
}

/** CSV holds one table, so the whole-history CSV is the batches only. */
export async function exportBatchList(batchDataList, format, expenses = null) {
  return exportReport(buildBatchListReport(batchDataList, expenses), format);
}

export async function exportFarmExpenses(expenses, format) {
  return exportReport(buildFarmExpensesReport(expenses), format);
}
