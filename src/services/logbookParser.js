/**
 * logbookParser.js
 * Rule-based reader for common logbook lines, in English, Filipino or Taglish:
 *
 *   Okt 26  Batch 2026-09  patay 4              → mortality
 *   Okt 26  feeds 5 sako  P12,500               → expense (feed)
 *   Okt 26  vitamins + kuryente  P850           → expense (other)
 *   Okt 27  B-07  benta Aling Nena 120 hds 245.5 kg @118/kg → sale
 *   Okt 27  Batch 2026-09  patuka 150 kg        → feed
 *
 * It is instant and predictable, so it runs first. Lines it cannot read are
 * passed to the local text model (see localLlm.js). Output has the same shape
 * as the model's entries, so normalizeDrafts() handles both.
 */

const MONTHS = {
  ene: 1, jan: 1, peb: 2, feb: 2, mar: 3, abr: 4, apr: 4, may: 5, mayo: 5,
  hun: 6, jun: 6, hul: 7, jul: 7, ago: 8, aug: 8, set: 9, sep: 9,
  okt: 10, 'ok+': 10, oct: 10, nob: 11, nov: 11, dis: 12, dec: 12
};

const pad = (n) => String(n).padStart(2, '0');
const toNum = (s) => (s == null ? null : Number(String(s).replace(/,/g, '')));

/** Year of `today`, or the year before if that would put the date in the future. */
function withYear(month, day, today) {
  const [ty, tm, td] = today.split('-').map(Number);
  const year = month > tm || (month === tm && day > td) ? ty - 1 : ty;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

function shiftDays(iso, days) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseDate(text, today) {
  let m = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  const monthRe = /(?:^|\s)(ene|jan|peb|feb|mar|abr|apr|mayo|may|hun|jun|hul|jul|ago|aug|set|sep|okt|ok\+|oct|nob|nov|dis|dec)[a-z]*\.?\s*(\d{1,2})\b/gi;
  for (const mm of text.matchAll(monthRe)) {
    // Filipino "may 3 patay" means "there are 3 dead", so a bare "may" only counts at the start
    if (mm[1].toLowerCase() === 'may' && mm.index > 0) continue;
    return withYear(MONTHS[mm[1].toLowerCase()], Number(mm[2]), today);
  }

  m = text.match(/(?:^|\s)(\d{1,2})[/-](\d{1,2})(?![\d/-])/); // M/D, as written in the Philippines
  if (m) return withYear(Number(m[1]), Number(m[2]), today);

  if (/\bkahapon\b|\byesterday\b/i.test(text)) return shiftDays(today, -1);
  if (/\bngayon\b|\btoday\b/i.test(text)) return today;
  return null;
}

/** "Batch 2026-09", "batch 09", "B-07", "B07" → the matching open batch name, or null. */
export function parseBatch(text, batchNames) {
  const full = text.match(/batch\s*(\d{4}-\d{2})/i);
  if (full) return batchNames.find((n) => n.includes(full[1])) ?? `Batch ${full[1]}`;

  const short = text.match(/\b(?:batch\s*|b-?)(\d{1,2})\b/i);
  if (short) {
    const suffix = `-${pad(Number(short[1]))}`;
    const matches = batchNames.filter((n) => n.endsWith(suffix));
    if (matches.length === 1) return matches[0];
  }
  return null;
}

const PESO = /(?:₱|\bphp\s?|\bp\s?)(\d[\d,]*(?:\.\d+)?)/i;
const MORTALITY = /\b(patay|namatay|dead|died|mortality)\b/i;
const SALE = /\b(benta|nabenta|binenta|sold|sale|naibenta)\b/i;
const FEED_USE = /\b(patuka|pakain|kinain|feed\s*(?:used|consumed)|consumed)\b/i;
const FEED_WORD = /\b(feeds?|patuka|sako|sacks?|bags?)\b/i;
const SACKS = /(\d+(?:\.\d+)?)\s*(?:sako|sacks?|bags?)\b/i;

function kgAmount(text) {
  // kg that is not part of a price ("118/kg")
  const m = text.match(/(\d[\d,]*(?:\.\d+)?)\s*kg\b/i);
  if (!m) return null;
  const before = text.slice(0, m.index).trimEnd();
  return /[/@Ø©]$/.test(before) ? null : toNum(m[1]);
}

function parseSale(text) {
  const heads = text.match(/(\d[\d,]*)\s*(?:hds?|heads?|ulo|pcs|manok)\b/i);
  const price = text.match(/(?:[@Ø©]|\bat\b)\s*(?:₱|p)?\s*(\d[\d,]*(?:\.\d+)?)\s*(?:\/\s*kg)?|(\d[\d,]*(?:\.\d+)?)\s*\/\s*kg/i);
  const buyer = text.match(/\b(?:benta|nabenta|binenta|naibenta|sold)\s+(?:kay\s+|to\s+)?([A-Za-zñÑ.' ]+?)(?=\s+\d|\s*[,;]|$)/i);
  // Weight: the kg value that is not the price
  const withoutPrice = price ? text.replace(price[0], ' ') : text;
  return {
    buyer_name: buyer ? buyer[1].trim() : null,
    quantity_sold: heads ? toNum(heads[1]) : null,
    weight_kg: kgAmount(withoutPrice),
    price_per_kg: price ? toNum(price[1] ?? price[2]) : null
  };
}

function firstInteger(text, keyword) {
  const after = text.match(new RegExp(`${keyword.source}\\s*:?\\s*(\\d+)`, 'i'));
  if (after) return Number(after[2]);
  const before = text.match(new RegExp(`(\\d+)\\s*${keyword.source}`, 'i'));
  return before ? Number(before[1]) : null;
}

const blank = () => ({
  feed_amount: null, other_amount: null, quantity_kg: null, count: null,
  buyer_name: null, quantity_sold: null, weight_kg: null, price_per_kg: null
});

/**
 * Parse one record. Returns an entry, or null when the line is not recognised.
 * @param {string} text
 * @param {{today: string, batches: string[], previousDate?: string|null}} ctx
 */
export function parseRecord(text, { today, batches, previousDate = null }) {
  const uncertain = [];
  let date = parseDate(text, today);
  if (!date) {
    date = previousDate; // logbooks often write the date once for several lines
    if (!date) uncertain.push('date');
  }
  const batch_hint = parseBatch(text, batches);
  const peso = text.match(PESO);
  const entry = { type: null, date, batch_hint, ...blank() };

  if (SALE.test(text)) {
    Object.assign(entry, { type: 'sale', ...parseSale(text) });
  } else if (MORTALITY.test(text)) {
    entry.type = 'mortality';
    entry.count = firstInteger(text, MORTALITY);
  } else if (peso) {
    entry.type = 'expense';
    entry.batch_hint = null; // expenses are farm-level and get allocated
    if (FEED_WORD.test(text)) entry.feed_amount = toNum(peso[1]);
    else entry.other_amount = toNum(peso[1]);
  } else if (FEED_USE.test(text) || (FEED_WORD.test(text) && (kgAmount(text) || SACKS.test(text)))) {
    entry.type = 'feed';
    entry.quantity_kg = kgAmount(text);
    const sacks = text.match(SACKS);
    if (entry.quantity_kg == null && sacks) {
      entry.quantity_kg = Number(sacks[1]) * 50;
      uncertain.push('quantity_kg');
    }
  } else {
    return null;
  }

  const required = {
    sale: ['buyer_name', 'quantity_sold', 'weight_kg', 'price_per_kg'],
    mortality: ['count'],
    feed: ['quantity_kg'],
    expense: []
  }[entry.type];
  for (const f of required) if (entry[f] == null) uncertain.push(f);

  return {
    ...entry,
    confidence: uncertain.length ? 0.5 : 0.9,
    uncertain_fields: uncertain
  };
}

/**
 * Parse every record. Returns { entries, unparsed } where unparsed lists the
 * 1-based record numbers the rules could not read.
 */
export function parseRecords(records, { today, batches }) {
  const entries = [];
  const unparsed = [];
  let previousDate = null;
  records.forEach((text, i) => {
    const entry = parseRecord(text, { today, batches, previousDate });
    if (entry) {
      entries.push({ ...entry, line: i + 1, source_text: text });
      if (entry.date) previousDate = entry.date;
    } else {
      unparsed.push(i + 1);
      previousDate = parseDate(text, today) || previousDate;
    }
  });
  return { entries, unparsed };
}
