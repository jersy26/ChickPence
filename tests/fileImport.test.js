import { describe, it, expect } from 'vitest';
import writeXlsxFile from 'write-excel-file/node';
import readExcelFile from 'read-excel-file/universal';
import {
  fileKind,
  parseCsv,
  cellDate,
  cellNumber,
  headerField,
  typeFromName,
  batchFromFileName,
  tablesToEntries,
  importNotes,
  markDuplicates,
  textItemsToRows,
  pdfRows,
  sheetJsTables
} from '../src/services/fileImport.js';
import * as XLSX from 'xlsx';
import { normalizeDrafts } from '../src/services/aiParseService.js';
import { buildBatchReport, buildBatchLedger, buildXlsxSheets, tableToCsv, renderReportBlob } from '../src/services/exportService.js';
import { renderImportReviewModal } from '../src/ui/importReviewModal.js';

const today = '2026-10-29';
const batches = ['Batch 2026-07', 'Batch 2026-09'];
const openBatches = [
  { batch_id: 'b7', batch_name: 'Batch 2026-07' },
  { batch_id: 'b9', batch_name: 'Batch 2026-09' }
];

const pick = (e) => Object.fromEntries(Object.entries({
  type: e.type, date: e.date, batch: e.batch_hint, feed: e.feed_amount, other: e.other_amount, kg: e.quantity_kg,
  count: e.count, buyer: e.buyer_name, heads: e.quantity_sold, weight: e.weight_kg, price: e.price_per_kg
}).filter(([, v]) => v !== null && v !== undefined));

// A batch as ChickPence exports it (same shape as the export tests)
const batchData = {
  batch: { batch_id: 'b9', batch_name: 'Batch 2026-09', start_date: '2026-09-01', end_date: null, initial_chick_count: 1000, chick_cost: 30000, mortality_threshold_pct: 5, status: 'Open' },
  feed: [{ feed_log_id: 'f1', batch_id: 'b9', entry_date: '2026-09-02', quantity_g: 25000 }, { feed_log_id: 'f2', batch_id: 'b9', entry_date: '2026-09-10', quantity_g: 50500 }],
  mortality: [{ mortality_id: 'm1', batch_id: 'b9', entry_date: '2026-09-05', count: 10 }],
  sales: [{ sale_id: 's1', batch_id: 'b9', sale_date: '2026-10-15', buyer_name: 'Aling Nena, Inc.', quantity_sold: 900, weight_kg: 1800, price_per_kg: 120, total_amount: 216000 }],
  allocations: [{ expense_id: 'e1', batch_id: 'b9', feed_centavos: 5000000, other_centavos: 250000, basis_heads: 1000, total_heads: 1000 }]
};
const expensesById = new Map([['e1', { expense_id: 'e1', entry_date: '2026-09-02' }]]);
const report = buildBatchReport(batchData, expensesById);
const exportName = 'ChickPence_Batch_2026-09_2026-10-29';
const expectedFromExport = [
  { type: 'feed', date: '2026-09-02', batch: 'Batch 2026-09', kg: 25 },
  { type: 'mortality', date: '2026-09-05', batch: 'Batch 2026-09', count: 10 },
  { type: 'feed', date: '2026-09-10', batch: 'Batch 2026-09', kg: 50.5 },
  { type: 'sale', date: '2026-10-15', batch: 'Batch 2026-09', buyer: 'Aling Nena, Inc.', heads: 900, weight: 1800, price: 120 }
];
const byDateType = (a, b) => (a.date + a.type).localeCompare(b.date + b.type);

describe('file kinds and cells', () => {
  it('tells the file kinds apart', () => {
    expect(fileKind({ name: 'logs.XLSX' })).toBe('xlsx');
    expect(fileKind({ name: 'logs.csv' })).toBe('csv');
    expect(fileKind({ name: 'report.pdf' })).toBe('pdf');
    expect(fileKind({ name: 'IMG_1.jpg', type: 'image/jpeg' })).toBe('image');
    expect(fileKind({ name: 'old.xls' })).toBe('spreadsheet');
    expect(fileKind({ name: 'libre.ods' })).toBe('spreadsheet');
    expect(fileKind({ name: 'mac.numbers' })).toBe('old-spreadsheet');
    expect(fileKind({ name: 'notes.docx' })).toBe('unknown');
  });

  it('parses CSV with quotes, semicolons and a BOM', () => {
    expect(parseCsv('﻿Date,Buyer,Total\r\n2026-10-15,"Aling Nena, Inc.","216,000"\r\n\r\n')).toEqual([
      ['Date', 'Buyer', 'Total'], ['2026-10-15', 'Aling Nena, Inc.', '216,000']
    ]);
    expect(parseCsv('Petsa;Patay\n10/26/2026;4\n')).toEqual([['Petsa', 'Patay'], ['10/26/2026', '4']]);
    expect(parseCsv('a,"say ""hi""",c')).toEqual([['a', 'say "hi"', 'c']]);
  });

  it('reads dates and numbers the way people type them', () => {
    expect(cellDate(new Date(Date.UTC(2026, 9, 26)), today)).toBe('2026-10-26');
    expect(cellDate('2026-10-26', today)).toBe('2026-10-26');
    expect(cellDate('10/26/2026', today)).toBe('2026-10-26');
    expect(cellDate('26/10/2026', today)).toBe('2026-10-26'); // day first when the first part is over 12
    expect(cellDate('Oct 26, 2026', today)).toBe('2026-10-26');
    expect(cellDate('Oktubre 26', today)).toBe('2026-10-26');
    expect(cellDate(46321, today)).toBe('2026-10-26'); // Excel serial
    expect(cellDate('not a date', today)).toBeNull();
    expect(cellNumber('₱12,500.00')).toBe(12500);
    expect(cellNumber('245.5 kg')).toBe(245.5);
    expect(cellNumber('')).toBeNull();
  });

  it('knows column headers in English and Filipino, and ChickPence export headers', () => {
    const fields = (hs) => hs.map(headerField);
    expect(fields(['Date', 'Buyer', 'Heads', 'Weight (kg)', 'Price per kg', 'Total'])).toEqual(['date', 'buyer', 'heads', 'weight', 'price', 'amount']);
    expect(fields(['Date', 'Feed cost', 'Other cost', 'Total', 'Allocation basis'])).toEqual(['date', 'feedCost', 'otherCost', 'amount', 'basis']);
    expect(fields(['Date', 'Quantity (kg)', 'Deaths', 'Cumulative', 'Feed (kg)'])).toEqual(['date', 'feedKg', 'deaths', 'ignore', 'feedKg']);
    expect(fields(['Petsa', 'Uri', 'Batch', 'Mamimili', 'Ulo', 'Timbang', 'Presyo', 'Patay', 'Halaga', 'Paglalarawan']))
      .toEqual(['date', 'type', 'batch', 'buyer', 'heads', 'weight', 'price', 'deaths', 'amount', 'description']);
    expect(typeFromName('Sales')).toBe('sale');
    expect(typeFromName('Benta')).toBe('sale');
    expect(typeFromName('Summary')).toBe('skip');
    expect(typeFromName('Chicks')).toBe('skip');
    expect(typeFromName('ChickPence_Batch_2026-09.csv')).toBeNull(); // the app name is not a chick row
  });

  it('finds the batch in a file name', () => {
    expect(batchFromFileName(`${exportName}.xlsx`, batches)).toBe('Batch 2026-09');
    expect(batchFromFileName('mga log.csv', batches)).toBeNull();
  });
});

describe('ChickPence exports read back', () => {
  it('Excel: every sheet; the Summary and the expense shares are left out', async () => {
    const buffer = await writeXlsxFile(buildXlsxSheets(report)).toBuffer();
    const sheets = await readExcelFile(new Blob([buffer]));
    const result = tablesToEntries(sheets.map((s) => ({ name: s.sheet, rows: s.data })), { today, batches, fileName: `${exportName}.xlsx` });
    expect(result.entries.map(pick).sort(byDateType)).toEqual(expectedFromExport);
    expect(result.shares).toBe(1);
    expect(result.unread).toEqual([]);
    expect(importNotes(result)).toContain("each batch's share of an expense");
  });

  it('CSV ledger: types from the Type column, chick row skipped', () => {
    const csv = tableToCsv(buildBatchLedger(report));
    const result = tablesToEntries([{ name: '', rows: parseCsv(csv) }], { today, batches, fileName: `${exportName}.csv` });
    expect(result.entries.map(pick).sort(byDateType)).toEqual(expectedFromExport);
    expect(result.shares).toBe(1);
    expect(result.skipped).toBe(1); // the chick purchase
  });

  it('PDF: tables found again from the text layer', async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const blob = await renderReportBlob(report, 'pdf');
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), useSystemFonts: true }).promise;
    const rows = await pdfRows(doc);
    const result = tablesToEntries([{ name: '', rows }], { today, batches, fileName: `${exportName}.pdf` });
    expect(result.entries.map(pick).sort(byDateType)).toEqual(expectedFromExport);
    expect(result.shares).toBe(1);
  });
});

describe('files people make themselves', () => {
  it('a Filipino table with a Type column, batch column and one amount column', () => {
    const rows = parseCsv([
      'Petsa,Uri,Batch,Paglalarawan,Dami (kg),Patay,Mamimili,Ulo,Timbang,Presyo,Halaga',
      '10/26/2026,Gastos,,Patuka 5 sako,,,,,,,"12,500"',
      '10/26/2026,Gastos,,Kuryente,,,,,,,850',
      '10/27/2026,Patuka,Batch 2026-09,,150,,,,,,',
      '10/27/2026,Patay,B-07,,,2,,,,,',
      '10/28/2026,Benta,Batch 2026-07,,,,Aling Nena,120,245.5,118,'
    ].join('\n'));
    const { entries } = tablesToEntries([{ name: '', rows }], { today, batches, fileName: 'log.csv' });
    expect(entries.map(pick)).toEqual([
      { type: 'expense', date: '2026-10-26', feed: 12500 },
      { type: 'expense', date: '2026-10-26', other: 850 },
      { type: 'feed', date: '2026-10-27', batch: 'Batch 2026-09', kg: 150 },
      { type: 'mortality', date: '2026-10-27', batch: 'B-07', count: 2 },
      { type: 'sale', date: '2026-10-28', batch: 'Batch 2026-07', buyer: 'Aling Nena', heads: 120, weight: 245.5, price: 118 }
    ]);
  });

  it('a sheet per type, price worked out from the total', () => {
    const tables = [
      { name: 'Benta', rows: [['Date', 'Buyer', 'Heads', 'Kg', 'Total'], ['2026-10-28', 'Mang Jun', 80, 160, 19200]] },
      { name: 'Mortality', rows: [['Date', 'Count'], ['2026-10-27', 3]] }
    ];
    const { entries } = tablesToEntries(tables, { today, batches, fileName: 'Batch 2026-07 logs.xlsx' });
    expect(entries.map(pick)).toEqual([
      { type: 'sale', date: '2026-10-28', batch: 'Batch 2026-07', buyer: 'Mang Jun', heads: 80, weight: 160, price: 120 },
      { type: 'mortality', date: '2026-10-27', batch: 'Batch 2026-07', count: 3 }
    ]);
  });

  it('logbook lines typed into cells, without a header', () => {
    const rows = parseCsv([
      'Okt 26,Batch 2026-09 patay 4',
      'Okt 26,vitamins + kuryente P850',
      'random note about the weather'
    ].join('\n'));
    const result = tablesToEntries([{ name: '', rows }], { today, batches, fileName: 'notes.csv' });
    expect(result.entries.map(pick)).toEqual([
      { type: 'mortality', date: '2026-10-26', batch: 'Batch 2026-09', count: 4 },
      { type: 'expense', date: '2026-10-26', other: 850 }
    ]);
    expect(result.unread).toEqual(['random note about the weather']);
    expect(importNotes(result)).toContain('1 line was not recognised: "random note about the weather"');
  });

  it.each(['xls', 'biff5', 'ods'])('an old Excel or OpenDocument file (%s) with real date cells', (bookType) => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['Petsa', 'Batch', 'Patay'],
      [new Date(Date.UTC(2026, 9, 26)), 'Batch 2026-09', 4],
      [new Date(Date.UTC(2026, 9, 27)), 'Batch 2026-07', 2]
    ], { cellDates: true, UTC: true });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Mortality');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Total deaths', 6]]), 'Summary');
    const data = XLSX.write(wb, { bookType, type: 'array' });

    const tables = sheetJsTables(XLSX, XLSX.read(new Uint8Array(data), { type: 'array', cellNF: true }));
    expect(tables[0].rows[1][0]).toEqual(new Date(Date.UTC(2026, 9, 26))); // a date cell, not its serial number
    const result = tablesToEntries(tables, { today, batches, fileName: `log.${bookType}` });
    expect(result.entries.map(pick)).toEqual([
      { type: 'mortality', date: '2026-10-26', batch: 'Batch 2026-09', count: 4 },
      { type: 'mortality', date: '2026-10-27', batch: 'Batch 2026-07', count: 2 }
    ]);
  });

  it('rows without a date are kept but flagged', () => {
    const { entries } = tablesToEntries([{ name: 'Feed', rows: [['Date', 'Kg'], ['', 50]] }], { today, batches });
    expect(entries[0]).toMatchObject({ type: 'feed', date: null, quantity_kg: 50, uncertain_fields: ['date'] });
  });
});

describe('duplicates and the review modal', () => {
  const existing = {
    expenses: [{ expense_id: 'e1', entry_date: '2026-10-26', feed_centavos: 1250000, other_centavos: 0 }],
    feed: [{ batch_id: 'b9', entry_date: '2026-10-27', quantity_g: 150000 }],
    mortality: [{ batch_id: 'b7', entry_date: '2026-10-27', count: 2, deleted_at: '2026-10-28' }],
    sales: [{ batch_id: 'b7', sale_date: '2026-10-28', quantity_sold: 120, weight_kg: 245.5, price_per_kg: 118 }]
  };
  const raw = [
    { type: 'expense', date: '2026-10-26', feed_amount: 12500, confidence: 1, uncertain_fields: [] },
    { type: 'feed', date: '2026-10-27', batch_hint: 'Batch 2026-09', quantity_kg: 150, confidence: 1, uncertain_fields: [] },
    { type: 'mortality', date: '2026-10-27', batch_hint: 'Batch 2026-07', count: 2, confidence: 1, uncertain_fields: [] },
    { type: 'sale', date: '2026-10-28', batch_hint: 'Batch 2026-07', buyer_name: 'Aling Nena', quantity_sold: 120, weight_kg: 245.5, price_per_kg: 118, confidence: 1, uncertain_fields: [] },
    { type: 'sale', date: '2026-10-28', batch_hint: 'Batch 2026-07', buyer_name: 'Aling Nena', quantity_sold: 100, weight_kg: 200, price_per_kg: 118, confidence: 1, uncertain_fields: [] }
  ];

  it('unticks entries already in ChickPence (deleted ones do not count)', () => {
    const drafts = markDuplicates(normalizeDrafts(raw, openBatches), existing);
    expect(drafts.map((d) => [d.type, !!d.duplicate, d.include])).toEqual([
      ['expense', true, false],
      ['feed', true, false],
      ['mortality', false, true],
      ['sale', true, false],
      ['sale', false, true]
    ]);
  });

  it('the modal says where the entries came from and marks duplicates', () => {
    const drafts = markDuplicates(normalizeDrafts(raw, openBatches), existing);
    const html = renderImportReviewModal(drafts, openBatches, 'note <b>', new Map(), 'logs <1>.csv');
    expect(html).toContain('Review Imported Entries');
    expect(html).toContain('Found <b>5</b> entries in <b>logs &lt;1&gt;.csv</b>');
    expect(html).toContain('3 are already in ChickPence and left unticked');
    expect(html.match(/Already saved/g)).toHaveLength(3);
    expect(html).not.toContain('AI confidence');
    expect(html).toContain('<b>Notes:</b> note &lt;b&gt;');
    // Photos keep the old wording
    expect(renderImportReviewModal(drafts, openBatches)).toContain('Review Scanned Entries');
  });
});

describe('PDF text layout', () => {
  it('groups text into lines and splits wide gaps into cells', () => {
    const items = [
      { str: 'Date', x: 40, y: 700, width: 20, height: 10 },
      { str: 'Deaths', x: 200, y: 700, width: 30, height: 10 },
      { str: '2026-09-05', x: 40, y: 685, width: 50, height: 10 },
      { str: '10', x: 200, y: 684.5, width: 10, height: 10 },
      { str: 'Aling', x: 40, y: 670, width: 22, height: 10 },
      { str: 'Nena', x: 64, y: 670, width: 20, height: 10 }
    ];
    expect(textItemsToRows(items)).toEqual([['Date', 'Deaths'], ['2026-09-05', '10'], ['Aling Nena']]);
  });
});
