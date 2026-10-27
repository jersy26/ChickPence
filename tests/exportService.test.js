import { describe, it, expect } from 'vitest';
import writeXlsxFile from 'write-excel-file/node';
import {
  buildBatchReport,
  buildBatchListReport,
  buildBatchLedger,
  buildXlsxSheets,
  tableToCsv,
  csvField,
  formatForText,
  safeFileName
} from '../src/services/exportService.js';

const batch = {
  batch_id: 'b1',
  batch_name: 'Batch 2026-07',
  start_date: '2026-07-01',
  end_date: '2026-08-15',
  initial_chick_count: 1000,
  chick_cost: 30000,
  mortality_threshold_pct: 5,
  status: 'Closed'
};

const batchData = {
  batch,
  feed: [
    { feed_log_id: 'f2', entry_date: '2026-07-10', quantity_g: 50500 },
    { feed_log_id: 'f1', entry_date: '2026-07-02', quantity_g: 25000 },
    { feed_log_id: 'f3', entry_date: '2026-07-03', quantity_g: 99000, deleted_at: '2026-07-04' }
  ],
  mortality: [
    { mortality_id: 'm1', entry_date: '2026-07-05', count: 10 },
    { mortality_id: 'm2', entry_date: '2026-07-08', count: 5 }
  ],
  sales: [
    {
      sale_id: 's1', sale_date: '2026-08-15', buyer_name: 'Aling Nena, Inc.',
      quantity_sold: 900, weight_kg: 1800, price_per_kg: 120, total_amount: 216000
    }
  ],
  allocations: [
    { expense_id: 'e1', batch_id: 'b1', feed_centavos: 5000000, other_centavos: 250000, basis_heads: 1000, total_heads: 1000 }
  ]
};

const expensesById = new Map([['e1', { expense_id: 'e1', entry_date: '2026-07-02' }]]);

const section = (report, name) => report.sections.find((s) => s.name === name).table;

describe('buildBatchReport', () => {
  const report = buildBatchReport(batchData, expensesById);

  it('produces the five sections in order', () => {
    expect(report.sections.map((s) => s.name)).toEqual(['Summary', 'Expenses', 'Feed', 'Mortality', 'Sales']);
    expect(report.fileBase).toBe('ChickPence_Batch_2026-07');
  });

  it('uses the allocated expense share and the expense entry date', () => {
    expect(section(report, 'Expenses').rows).toEqual([['2026-07-02', 50000, 2500, 52500, '1,000 / 1,000 heads']]);
  });

  it('converts feed grams to kg, drops deleted rows and sorts by date', () => {
    expect(section(report, 'Feed').rows).toEqual([['2026-07-02', 25], ['2026-07-10', 50.5]]);
  });

  it('adds a cumulative mortality column', () => {
    expect(section(report, 'Mortality').rows).toEqual([['2026-07-05', 10, 10], ['2026-07-08', 5, 15]]);
  });

  it('matches calcBatchMetrics totals', () => {
    // 30,000 chicks + 50,000 feed + 2,500 other
    expect(report.metrics.totalCost).toBe(82500);
    expect(report.metrics.netProfit).toBe(216000 - 82500);
  });
});

describe('CSV', () => {
  it('escapes commas, quotes and newlines', () => {
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('line\nbreak')).toBe('"line\nbreak"');
    expect(csvField(42)).toBe('42');
    expect(csvField(null)).toBe('');
  });

  it('neutralises formula injection in text but not negative numbers', () => {
    expect(csvField('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvField('@cmd')).toBe("'@cmd");
    expect(csvField(-500)).toBe('-500');
  });

  it('builds a dated ledger with a BOM and header row', () => {
    const report = buildBatchReport(batchData, expensesById);
    const csv = tableToCsv(buildBatchLedger(report));
    const lines = csv.replace('﻿', '').trim().split('\r\n');

    expect(csv.startsWith('﻿')).toBe(true);
    expect(lines[0]).toBe('Date,Type,Buyer,Heads,Weight (kg),Price per kg,Feed (kg),Deaths,Amount,Feed cost,Other cost');
    expect(lines).toHaveLength(1 + 1 + 1 + 2 + 2 + 1); // header, chicks, expense, feed×2, mortality×2, sale
    expect(lines[1]).toBe('2026-07-01,Chicks,,1000,,,,,30000,,');
    expect(lines.at(-1)).toBe('2026-08-15,Sale,"Aling Nena, Inc.",900,1800,120,,,216000,,');
  });
});

describe('formatForText (PDF)', () => {
  it('writes currency as PHP since jsPDF fonts lack the peso sign', () => {
    expect(formatForText(1234.5, 'peso')).toBe('PHP 1,234.50');
    expect(formatForText(-1568000, 'peso')).toBe('-PHP 1,568,000.00');
    expect(formatForText(12.345, 'pct')).toBe('12.35%');
    expect(formatForText('N/A', 'peso')).toBe('N/A');
    expect(formatForText(null, 'peso')).toBe('—');
  });
});

describe('Excel', () => {
  it('writes a valid multi-sheet .xlsx', async () => {
    const report = buildBatchReport(batchData, expensesById);
    const sheets = buildXlsxSheets(report);
    expect(sheets.map((s) => s.sheet)).toEqual(['Summary', 'Expenses', 'Feed', 'Mortality', 'Sales']);

    const buffer = await writeXlsxFile(sheets).toBuffer();
    expect(buffer.subarray(0, 2).toString()).toBe('PK'); // .xlsx is a zip archive
  });

  it('stores dates as real Excel dates and money as numbers', () => {
    const sheets = buildXlsxSheets(buildBatchReport(batchData, expensesById));
    const salesRow = sheets.find((s) => s.sheet === 'Sales').data[1];
    expect(salesRow[0].value.toISOString()).toBe('2026-08-15T00:00:00.000Z');
    expect(salesRow[5]).toMatchObject({ value: 216000, type: Number, format: '#,##0.00' });
  });
});

describe('buildBatchListReport', () => {
  it('has one row per batch with N/A metrics left as N/A', () => {
    const openBatch = { ...batch, batch_id: 'b2', batch_name: 'Open one', status: 'Open', end_date: null };
    const report = buildBatchListReport([batchData, { batch: openBatch, feed: [], mortality: [], sales: [], allocations: [] }]);
    const rows = report.sections[0].table.rows;
    expect(rows).toHaveLength(2);
    expect(rows[1][8]).toBe('N/A'); // margin with no revenue
  });
});

describe('safeFileName', () => {
  it('strips characters that are invalid in file names', () => {
    expect(safeFileName('Batch #3 / July')).toBe('Batch_3_July');
    expect(safeFileName('')).toBe('batch');
  });
});
