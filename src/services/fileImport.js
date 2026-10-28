/**
 * fileImport.js
 * Turn an Excel (.xlsx, .xls), OpenDocument (.ods), CSV or PDF file into draft log entries for the
 * review modal. Photos (and scanned PDFs, page by page) go through the
 * logbook scan instead (aiParseService.js).
 *
 * Nothing is saved here: like the logbook scan, the drafts are confirmed in
 * the review modal and saved through Repository.save*.
 *
 * Two kinds of files are understood:
 *   - tables with a header row (Date / Petsa, Deaths / Patay, Buyer, …), including
 *     ChickPence's own Excel, CSV and PDF exports. The entry type comes from a
 *     Type column, the sheet or section name, or the columns that have values;
 *   - logbook lines typed into cells (one entry per row, no header), read by
 *     the same rules as a scanned logbook.
 */

import { parseRecord, parseDate } from './logbookParser.js';

export const IMPORT_ACCEPT = '.xlsx,.xls,.ods,.csv,.pdf,image/*';
const MAX_ROWS = 1000;

/**
 * 'image' | 'csv' | 'xlsx' | 'pdf' | 'spreadsheet' (.xls, .ods) | 'old-spreadsheet' (.numbers) | 'unknown'
 */
export function fileKind(file) {
  const name = String(file?.name || '').toLowerCase();
  const type = String(file?.type || '');
  if (type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif|gif|bmp)$/.test(name)) return 'image';
  if (name.endsWith('.csv') || type === 'text/csv') return 'csv';
  if (name.endsWith('.xlsx') || type.includes('spreadsheetml')) return 'xlsx';
  if (name.endsWith('.pdf') || type === 'application/pdf') return 'pdf';
  if (/\.(xls|ods)$/.test(name) || type === 'application/vnd.ms-excel' || type.includes('opendocument.spreadsheet')) return 'spreadsheet';
  if (name.endsWith('.numbers')) return 'old-spreadsheet';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// CSV (pure)
// ---------------------------------------------------------------------------

/** RFC 4180 CSV → rows of strings. Detects , ; or tab; drops the BOM and blank rows. */
export function parseCsv(text) {
  const s = String(text || '').replace(/^﻿/, '');
  const firstLine = s.split(/\r?\n/, 1)[0] || '';
  const delimiter = [',', ';', '\t']
    .map((d) => [d, firstLine.split(d).length])
    .sort((a, b) => b[1] - a[1])[0][0];

  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === '') {
      quoted = true;
    } else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => String(cell).trim() !== ''));
}

// ---------------------------------------------------------------------------
// CELLS (pure)
// ---------------------------------------------------------------------------

const pad = (n) => String(n).padStart(2, '0');
const isoUtc = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/** Text of a cell; undoes the "'" ChickPence's CSV export puts before =, +, - and @. */
function cellText(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return isoUtc(v);
  return String(v).trim().replace(/^'(?=[=+\-@])/, '');
}

const isBlank = (v) => cellText(v) === '';

/** "₱12,500.00", "1,234.5 kg", 850 → number; null when there is no number. */
export function cellNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const t = cellText(v).replace(/,/g, '');
  const m = t.match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/**
 * A date cell → YYYY-MM-DD. Accepts Excel dates, ISO, M/D/YYYY (D/M/YYYY when
 * the first part is over 12), Excel serial numbers and month names
 * ("Oct 26, 2026", "Oktubre 26"). Without a year, the logbook rule applies
 * (this year, unless that is in the future).
 */
export function cellDate(v, today) {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : isoUtc(v);
  if (typeof v === 'number' && v > 30000 && v < 80000) {
    return isoUtc(new Date(Date.UTC(1899, 11, 30) + v * 86400000)); // Excel serial
  }
  const t = cellText(v);
  if (!t) return null;
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/);
  if (m) {
    let [, a, b, y] = m.map(Number);
    if (y < 100) y += 2000;
    const [month, day] = a > 12 ? [b, a] : [a, b];
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${y}-${pad(month)}-${pad(day)}`;
  }
  m = t.match(/^([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})\b/);
  if (m) {
    const withoutYear = parseDate(`${m[1]} ${m[2]}`, `${m[3]}-12-31`);
    if (withoutYear) return `${m[3]}${withoutYear.slice(4)}`;
  }
  return parseDate(t, today);
}

// ---------------------------------------------------------------------------
// HEADERS AND TYPES (pure)
// ---------------------------------------------------------------------------

/** Column header → field. Order matters: the first pattern that matches wins. */
const HEADER_FIELDS = [
  ['basis', /allocation basis/],
  ['ignore', /cumulative|running|balance|natitira/],
  ['feedCost', /feed (cost|amount|expense)|cost of feed|feeds? (php|peso|piso)|gastos sa (patuka|feeds?)|halaga ng patuka/],
  ['otherCost', /other (cost|costs|expense|expenses)|^others?$|iba pang gastos|^iba pa$/],
  ['price', /price|presyo|per kg|per kilo|kada kilo|bawat kilo|\/ ?kg/],
  ['weight', /weight|timbang|total kg|kg sold|kilos? sold/],
  ['buyer', /buyer|customer|mamimili|bumili|client|suki/],
  ['heads', /heads|^qty$|quantity sold|^ulo$|bilang ng ulo|birds sold|no of birds|number of birds/],
  ['deaths', /death|dead|patay|namatay|mortality|^count$/],
  ['feedKg', /feed.*kg|kg.*feed|feed consumed|^quantity( kg)?$|^dami|patuka|pakain|^feeds?$|^kg$|^kilos?$/],
  ['amount', /amount|^total|cost|halaga|gastos|bayad|presyo kabuuan/],
  ['description', /description|details|^item|particulars|remarks|notes|paglalarawan|detalye|^entry$/],
  ['date', /^date|petsa|^araw|^day$/],
  ['type', /^type$|^uri$|^kind$|^category$|^entry type$|^klase$/],
  ['batch', /^batch|^grupo/]
];

const normHeader = (h) => cellText(h).toLowerCase().replace(/[₱()[\]:#.]/g, ' ').replace(/\bphp\b/g, 'php').replace(/\s+/g, ' ').trim();

export function headerField(header) {
  const h = normHeader(header);
  if (!h) return null;
  return HEADER_FIELDS.find(([, re]) => re.test(h))?.[0] || null;
}

/** A row is a header when at least two cells are known columns and one of them is a date. */
function headerMap(row) {
  const map = row.map(headerField);
  const known = map.filter((f) => f && f !== 'ignore' && f !== 'basis');
  return known.length >= 2 && known.includes('date') ? map : null;
}

const TYPE_WORDS = [
  // Chick purchases are part of a batch, and summaries / the batch history hold totals, not entries
  ['skip', /\bchicks?\b|sisiw|summary|buod|metric|history|kasaysayan|^batches$/],
  ['expense', /expense|gastos|gasto|bayad|cost/],
  ['feed', /feed|patuka|pakain/],
  ['mortality', /mortal|patay|namatay|death|dead/],
  ['sale', /sale|sales|benta|nabenta|sold/]
];

/** "Sales", "Mortality", "Benta" … → entry type; 'skip' for chick and summary sections. */
export function typeFromName(name) {
  const t = cellText(name).toLowerCase();
  if (!t) return null;
  return TYPE_WORDS.find(([, re]) => re.test(t))?.[0] || null;
}

/** A row with only one filled cell that names a section ("Expenses", "Sales") */
function sectionTitle(row) {
  const filled = row.filter((c) => !isBlank(c));
  if (filled.length !== 1) return null;
  const text = cellText(filled[0]);
  return text.length <= 40 ? typeFromName(text) : null;
}

const FEED_WORDS = /feed|patuka|pakain|sako|integra|starter|grower|finisher|booster/i;

/** One table row with a header → raw entry (the shape normalizeDrafts reads), 'skip', or null. */
function rowToEntry(row, map, { contextType, today, fileBatch, reportShares }) {
  const get = (field) => {
    const i = map.indexOf(field);
    return i < 0 ? undefined : row[i];
  };
  const num = (field) => (get(field) === undefined || isBlank(get(field)) ? null : cellNumber(get(field)));

  const typeCell = get('type');
  let type = typeCell !== undefined && !isBlank(typeCell) ? typeFromName(typeCell) : null;
  type ??= contextType;
  if (!type) {
    if (!isBlank(get('buyer') ?? '') || [num('heads'), num('weight'), num('price')].some((v) => v !== null)) type = 'sale';
    else if (num('deaths') !== null) type = 'mortality';
    else if (num('feedKg') !== null && num('feedCost') === null && num('amount') === null) type = 'feed';
    else if ([num('feedCost'), num('otherCost'), num('amount')].some((v) => v !== null)) type = 'expense';
  }
  if (type === 'skip') return 'skip';
  if (!type) return null;
  // A ChickPence batch report lists each batch's share of an expense, not the expense itself
  if (type === 'expense' && (map.includes('basis') || reportShares)) return 'share';

  const date = cellDate(get('date'), today);
  const batchCell = cellText(get('batch'));
  const description = cellText(get('description'));
  const entry = {
    type,
    date,
    batch_hint: type === 'expense' ? null : batchCell || fileBatch || null,
    feed_amount: null,
    other_amount: null,
    quantity_kg: null,
    count: null,
    buyer_name: null,
    quantity_sold: null,
    weight_kg: null,
    price_per_kg: null,
    confidence: 1,
    uncertain_fields: date ? [] : ['date']
  };

  if (type === 'expense') {
    entry.feed_amount = num('feedCost');
    entry.other_amount = num('otherCost');
    if (entry.feed_amount === null && entry.other_amount === null && num('amount') !== null) {
      const feedLike = FEED_WORDS.test(`${description} ${cellText(typeCell)}`);
      entry[feedLike ? 'feed_amount' : 'other_amount'] = num('amount');
    }
    if (!entry.feed_amount && !entry.other_amount) return null;
  } else if (type === 'feed') {
    entry.quantity_kg = num('feedKg') ?? num('weight');
    if (entry.quantity_kg === null) return null;
  } else if (type === 'mortality') {
    entry.count = num('deaths');
    if (entry.count === null) return null;
  } else {
    entry.buyer_name = cellText(get('buyer')) || null;
    entry.quantity_sold = num('heads');
    entry.weight_kg = num('weight') ?? num('feedKg'); // "kg" on a Sales sheet is the weight sold
    entry.price_per_kg = num('price');
    const total = num('amount');
    if (entry.price_per_kg === null && total && entry.weight_kg) entry.price_per_kg = Math.round((total / entry.weight_kg) * 100) / 100;
    if (entry.quantity_sold === null && entry.weight_kg === null) return null;
  }
  return entry;
}

/** The open batch a file name mentions ("ChickPence_Batch_2026-09_2026-10-28.xlsx"), if any. */
export function batchFromFileName(fileName, batches = []) {
  const flat = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
  const name = flat(String(fileName || '').replace(/\.[a-z0-9]+$/i, ''));
  return batches.find((b) => flat(b) && name.includes(flat(b))) || null;
}

/**
 * Tables (one per sheet, or one for a CSV/PDF) → { entries, unread, skipped, shares }.
 * entries: raw entries for normalizeDrafts, each with source_text and line;
 * unread: rows that are neither table rows nor logbook lines;
 * shares: expense rows left out because they are a batch report's allocated shares.
 * @param {{ name: string, rows: any[][] }[]} tables
 */
export function tablesToEntries(tables, { today, batches = [], fileName = '' }) {
  const fileBatch = batchFromFileName(fileName, batches);
  // ChickPence's batch reports are named ChickPence_<batch>_<date>; the whole-history report has no entries
  const reportShares = /^chickpence_/i.test(String(fileName));
  const entries = [];
  const unread = [];
  let skipped = 0;
  let shares = 0;
  let line = 0;

  for (const table of tables) {
    const sheetType = typeFromName(table.name);
    if (sheetType === 'skip') continue; // a Summary sheet holds totals, not entries
    let contextType = sheetType;
    let map = null;
    let previousDate = null;

    for (const row of (table.rows || []).slice(0, MAX_ROWS)) {
      line++;
      if (!row?.some((c) => !isBlank(c))) continue;
      const source = row.map(cellText).filter(Boolean).join(' · ');

      const header = headerMap(row);
      if (header) { map = header; continue; }
      const title = sectionTitle(row);
      if (title) { contextType = title; map = null; continue; }
      if (contextType === 'skip') continue;

      if (map) {
        const entry = rowToEntry(row, map, { contextType, today, fileBatch, reportShares });
        if (entry === 'skip') { skipped++; continue; }
        if (entry === 'share') { shares++; continue; }
        if (entry) {
          entries.push({ ...entry, line, source_text: source });
          continue;
        }
      }

      // Not a table row: read it like a logbook line ("Okt 26 Batch 9 patay 4")
      const text = row.map(cellText).filter(Boolean).join(' ');
      const parsed = parseRecord(text, { today, batches, previousDate });
      if (parsed) {
        if (parsed.date) previousDate = parsed.date;
        if (!parsed.batch_hint && fileBatch && parsed.type !== 'expense') parsed.batch_hint = fileBatch;
        entries.push({ ...parsed, line, source_text: text });
      } else if (!map) {
        unread.push(text);
      } else {
        skipped++; // e.g. a "No records." line under a table
      }
    }
  }
  return { entries, unread, skipped, shares };
}

/** A short note for the review modal about what was left out. */
export function importNotes({ unread = [], skipped = 0, shares = 0 }) {
  const notes = [];
  if (shares) {
    notes.push(`${shares} expense ${shares === 1 ? 'row was' : 'rows were'} left out: a ChickPence batch report lists each batch's share of an expense, not the whole expense. Add farm expenses with + Add New Log.`);
  }
  if (unread.length) {
    const shown = unread.slice(0, 5).map((t) => `"${t.length > 60 ? `${t.slice(0, 57)}…` : t}"`).join(', ');
    notes.push(`${unread.length} ${unread.length === 1 ? 'line was' : 'lines were'} not recognised: ${shown}${unread.length > 5 ? ', …' : ''}`);
  }
  if (skipped) notes.push(`${skipped} other ${skipped === 1 ? 'row' : 'rows'} (chick purchases, totals or empty lines) skipped.`);
  return notes.join(' ');
}

// ---------------------------------------------------------------------------
// DUPLICATES (pure)
// ---------------------------------------------------------------------------

const near = (a, b, tolerance = 0.005) => Math.abs((Number(a) || 0) - (Number(b) || 0)) <= tolerance;

/**
 * Untick drafts that match a record already in ChickPence (e.g. importing an
 * export back), so they are not saved twice. existing: { expenses, feed, mortality, sales }.
 */
export function markDuplicates(drafts, existing) {
  const live = (rows = []) => rows.filter((r) => !r.deleted_at);
  const expenses = live(existing.expenses);
  const feed = live(existing.feed);
  const mortality = live(existing.mortality);
  const sales = live(existing.sales);

  for (const d of drafts) {
    let match = false;
    if (d.type === 'expense') {
      match = expenses.some((e) => e.entry_date === d.date
        && near(e.feed_centavos / 100, d.feed_amount ?? 0) && near(e.other_centavos / 100, d.other_amount ?? 0));
    } else if (d.type === 'feed') {
      match = feed.some((f) => f.batch_id === d.batch_id && f.entry_date === d.date
        && near(f.quantity_g !== undefined ? f.quantity_g / 1000 : f.quantity_kg, d.quantity_kg, 0.0005));
    } else if (d.type === 'mortality') {
      match = mortality.some((m) => m.batch_id === d.batch_id && m.entry_date === d.date && Number(m.count) === Number(d.count));
    } else if (d.type === 'sale') {
      match = sales.some((s) => s.batch_id === d.batch_id && s.sale_date === d.date
        && Number(s.quantity_sold) === Number(d.quantity_sold) && near(s.weight_kg, d.weight_kg) && near(s.price_per_kg, d.price_per_kg));
    }
    if (match) {
      d.duplicate = true;
      d.include = false;
    }
  }
  return drafts;
}

// ---------------------------------------------------------------------------
// PDF (text layer → rows)
// ---------------------------------------------------------------------------

/**
 * pdf.js text items → rows of cells. Items on the same line (close y) are
 * joined; a wide horizontal gap starts a new cell, so PDF tables keep their
 * columns. items: [{ str, x, y, width, height }]
 */
export function textItemsToRows(items) {
  const parts = items.filter((it) => it.str && it.str.trim());
  const lines = [];
  for (const it of [...parts].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const tolerance = Math.max(2, (it.height || 10) * 0.5);
    const line = lines.find((l) => Math.abs(l.y - it.y) <= tolerance);
    if (line) line.items.push(it);
    else lines.push({ y: it.y, items: [it] });
  }
  return lines.map(({ items: lineItems }) => {
    const sorted = lineItems.sort((a, b) => a.x - b.x);
    const cells = [];
    let end = null;
    for (const it of sorted) {
      const gap = end === null ? 0 : it.x - end;
      const size = it.height || 10;
      if (end === null || gap > size * 0.9) cells.push(it.str.trim());
      else cells[cells.length - 1] += `${gap > size * 0.15 ? ' ' : ''}${it.str.trim()}`;
      end = it.x + (it.width || 0);
    }
    return cells;
  });
}

/** Rows of every page of a loaded pdf.js document. */
export async function pdfRows(doc) {
  const rows = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    rows.push(...textItemsToRows(content.items.map((it) => ({
      str: it.str, x: it.transform[4], y: it.transform[5], width: it.width, height: it.height || Math.abs(it.transform[3])
    }))));
  }
  return rows;
}

// ---------------------------------------------------------------------------
// LOADING FILES (browser)
// ---------------------------------------------------------------------------

const MAX_SCANNED_PAGES = 10;

async function loadPdfjs() {
  const pdfjs = await import('pdfjs-dist');
  const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  return pdfjs;
}

/** A scanned PDF has no text layer: render its pages as JPEG images for the logbook scan. */
async function pdfPagesAsImages(doc) {
  const images = [];
  for (let p = 1; p <= Math.min(doc.numPages, MAX_SCANNED_PAGES); p++) {
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport }).promise;
    images.push(await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9)));
  }
  return images;
}

/**
 * A SheetJS workbook (.xls, .ods) → tables like read-excel-file gives: one per
 * sheet, date cells as UTC-midnight Dates, everything else as its raw value.
 */
export function sheetJsTables(XLSX, workbook) {
  return workbook.SheetNames.map((name) => {
    const ws = workbook.Sheets[name];
    const rows = [];
    if (ws?.['!ref']) {
      const range = XLSX.utils.decode_range(ws['!ref']);
      for (let r = range.s.r; r <= Math.min(range.e.r, range.s.r + MAX_ROWS); r++) {
        const row = [];
        for (let c = range.s.c; c <= range.e.c; c++) row.push(sheetJsValue(XLSX, ws[XLSX.utils.encode_cell({ r, c })]));
        rows.push(row);
      }
    }
    return { name, rows };
  });
}

function sheetJsValue(XLSX, cell) {
  if (!cell || cell.t === 'z' || cell.t === 'e') return null;
  if (cell.t === 'n' && cell.z && XLSX.SSF.is_date(cell.z)) {
    return new Date(Date.UTC(1899, 11, 30) + Math.round(cell.v * 86400000)); // date serial, time of day dropped by isoUtc
  }
  return cell.v ?? null;
}

/**
 * Read an .xlsx, .xls, .ods, .csv or .pdf file.
 * Returns { entries, unread, skipped } or, for a scanned PDF, { pageImages: Blob[], pageCount }.
 */
export async function readLogFile(file, { today, batches = [] }) {
  const kind = fileKind(file);
  let tables;
  if (kind === 'csv') {
    tables = [{ name: '', rows: parseCsv(await file.text()) }]; // the file name is only used to find the batch
  } else if (kind === 'xlsx') {
    const { default: readExcelFile } = await import('read-excel-file/universal');
    const sheets = await readExcelFile(file);
    tables = sheets.map((s) => ({ name: s.sheet, rows: s.data }));
  } else if (kind === 'spreadsheet') {
    // SheetJS is only loaded for the older formats read-excel-file cannot read
    const XLSX = await import('xlsx');
    // cellNF keeps each cell's number format, which is how a date cell is told apart from a number
    tables = sheetJsTables(XLSX, XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array', cellNF: true }));
  } else if (kind === 'pdf') {
    const pdfjs = await loadPdfjs();
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const rows = await pdfRows(doc);
    if (rows.flat().join('').replace(/\s/g, '').length < 20) {
      return { pageImages: await pdfPagesAsImages(doc), pageCount: doc.numPages };
    }
    tables = [{ name: '', rows }];
  } else {
    throw new Error('Choose an Excel (.xlsx, .xls), OpenDocument (.ods), CSV or PDF file, or a photo.');
  }
  return tablesToEntries(tables, { today, batches, fileName: file.name });
}
