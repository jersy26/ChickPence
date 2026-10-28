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

const MONTH_DAY = /(?:^|\s)(ene|jan|peb|feb|mar|abr|apr|mayo|may|hun|jun|hul|jul|ago|aug|set|sep|okt|ok\+|oct|nob|nov|dis|dec)[a-z]*\.?\s*(\d{1,2})\b/i;

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

  for (const mm of text.matchAll(new RegExp(MONTH_DAY.source, 'gi'))) {
    // Filipino "may 3 patay" means "there are 3 dead", so a bare "may" only counts at the start
    if (mm[1].toLowerCase() === 'may' && mm.index > 0) continue;
    return withYear(MONTHS[mm[1].toLowerCase()], Number(mm[2]), today);
  }

  m = text.match(/(?:^|\s)(\d{1,2})[/-](\d{1,2})(?![\d/-])/); // M/D, as written in the Philippines
  if (m) return withYear(Number(m[1]), Number(m[2]), today);

  if (/\bkahapon\b|\byesterday\b/i.test(text)) return shiftDays(today, -1);
  if (/\bngayon\b|\btoday\b|\bkanina\b/i.test(text)) return today;
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
const MORTALITY = /\b(patay|namatay|namatayan|nangamatay|dead|died|deaths?|mortality)\b/i;
const SALE = /\b(benta|nabenta|binenta|naibenta|nagbenta|ibinenta|sold|sale|sell)\b/i;
const FEED_USE = /\b(patuka|pakain|nagpakain|pinakain|kinain|kumain|fed|ate|feed\s*(?:used|consumed)|consumed)\b/i;
const FEED_WORD = /\b(feeds?|patuka|sako|sacks?|bags?)\b/i;
const SACKS = /(\d+(?:\.\d+)?)\s*(?:sako|sacks?|bags?)\b/i;
// A cost said without a peso sign ("nagbayad ng kuryente 850")
const EXPENSE_WORD = /\b(bayad|nagbayad|binayaran|gastos|gumastos|bumili|binili|paid|bought|spent|cost)\b/i;
const BATCH_REF = /\bbatch\s*\d[\d-]*|\bb-?\d+\b/gi;

function kgAmount(text) {
  // kg that is not part of a price ("118/kg")
  const m = text.match(/(\d[\d,]*(?:\.\d+)?)\s*kg\b/i);
  if (!m) return null;
  const before = text.slice(0, m.index).trimEnd();
  return /[/@Ø©]$/.test(before) ? null : toNum(m[1]);
}

function parseSale(text) {
  const heads = text.match(/(\d[\d,]*)\s*(?:hds?|heads?|ulo|pcs|manok|birds?|chickens?|piraso)\b/i);
  // "118/kg" first: in Taglish "at" also means "and" ("120 heads at 245 kg")
  const price =
    text.match(/(\d[\d,]*(?:\.\d+)?)\s*\/\s*kg/i) ||
    text.match(/(?:[@Ø©]|\bat\b)\s*(?:₱|p)?\s*(\d[\d,]*(?:\.\d+)?)(?![\d,.]|\s*kg)/i);
  const buyer =
    text.match(/\b(?:kay|to)\s+([A-Za-zñÑ.' ]+?)(?=\s+(?:ng|ang|na|of|at|and|sa)\b|\s+\d|\s*[,;]|$)/i) ||
    text.match(/\b(?:benta|nabenta|binenta|naibenta|sold)\s+([A-Za-zñÑ.' ]+?)(?=\s+\d|\s*[,;]|$)/i);
  // Weight: the kg value that is not the price
  const withoutPrice = price ? text.replace(price[0], ' ') : text;
  return {
    buyer_name: buyer ? buyer[1].trim() : null,
    quantity_sold: heads ? toNum(heads[1]) : null,
    weight_kg: kgAmount(withoutPrice),
    price_per_kg: price ? toNum(price[1]) : null
  };
}

function firstInteger(text, keyword) {
  const after = text.match(new RegExp(`${keyword.source}\\s*:?\\s*(\\d+)`, 'i'));
  if (after) return Number(after[2]);
  // Spoken order: "3 ang namatay", "3 chickens died", "patay ang 3". Filler words, never numbers.
  const filler = '(?:[a-zñ]+\\s+){0,2}';
  const before = text.match(new RegExp(`(\\d+)\\s*${filler}${keyword.source}`, 'i'));
  if (before) return Number(before[1]);
  const later = text.match(new RegExp(`${keyword.source}\\s+${filler}(\\d+)`, 'i'));
  return later ? Number(later[2]) : null;
}

/** First number that is not a weight, head count, sack count, date or batch: the pesos of a spoken cost. */
function bareAmount(text) {
  const cleaned = text
    .replace(BATCH_REF, ' ')
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ')
    .replace(new RegExp(MONTH_DAY.source, 'gi'), ' ')
    .replace(/(?:^|\s)\d{1,2}[/-]\d{1,2}(?![\d/-])/g, ' ');
  const m = cleaned.match(/(\d[\d,]*(?:\.\d+)?)(?![\d,.])(?!\s*(?:kg|sako|sacks?|bags?|hds?|heads?|ulo|birds?|chickens?)\b)/i);
  return m ? toNum(m[1]) : null;
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
    entry.count = firstInteger(text.replace(BATCH_REF, ' '), MORTALITY);
  } else if (peso || (EXPENSE_WORD.test(text) && bareAmount(text) != null)) {
    const amount = peso ? toNum(peso[1]) : bareAmount(text);
    entry.type = 'expense';
    entry.batch_hint = null; // expenses are farm-level and get allocated
    if (FEED_WORD.test(text)) entry.feed_amount = amount;
    else entry.other_amount = amount;
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

// ---------------------------------------------------------------------------
// SPOKEN TEXT (voice input)
// ---------------------------------------------------------------------------

const NUMBER_WORDS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  isa: 1, dalawa: 2, tatlo: 3, apat: 4, lima: 5, anim: 6, pito: 7, walo: 8, siyam: 9, sampu: 10,
  dalawampu: 20, tatlumpu: 30, apatnapu: 40, limampu: 50, animnapu: 60, pitumpu: 70, walumpu: 80, siyamnapu: 90
};
const SCALE_WORDS = { hundred: 100, daan: 100, raan: 100, sandaan: 100, thousand: 1000, libo: 1000, sanlibo: 1000 };
const FIL_TEENS = { isa: 11, dalawa: 12, tatlo: 13, apat: 14, lima: 15, anim: 16, pito: 17, walo: 18, siyam: 19 };

// Filipino words take the linker -ng ("tatlong", "isang", "daang")
const NUM_WORD = `(?:${[...Object.keys(NUMBER_WORDS), ...Object.keys(SCALE_WORDS)].sort((a, b) => b.length - a.length).join('|')})(?:ng|g)?`;
const NUM_RUN = new RegExp(`\\b${NUM_WORD}(?:[\\s-]+(?:(?:and|at|na)[\\s-]+)?${NUM_WORD})*\\b`, 'gi');

function wordValue(word) {
  const w = word.toLowerCase();
  for (const cut of [w, w.replace(/ng$/, ''), w.replace(/g$/, '')]) {
    if (cut in NUMBER_WORDS) return { n: NUMBER_WORDS[cut] };
    if (cut in SCALE_WORDS) return { scale: SCALE_WORDS[cut], one: cut.startsWith('san') };
  }
  return null;
}

/** "dalawang daan at limampu" → 250, "one hundred twenty" → 120. */
function runValue(run) {
  let total = 0;
  let current = 0;
  for (const word of run.split(/[\s-]+/)) {
    const v = wordValue(word);
    if (!v) continue; // "and", "at", "na"
    if (v.n !== undefined) current += v.n;
    else if (v.scale === 100) current = (v.one ? 1 : current || 1) * 100;
    else { total += (v.one ? 1 : current || 1) * v.scale; current = 0; }
  }
  return total + current;
}

/**
 * Filipino spelling varies (o/u: "tatlong" / "tatlung"), and Whisper splits or
 * joins words ("limang pu", "walungdaan", "Nagbentakay"). Bring the number
 * words and "kay" back to one spelling before the number words are read.
 * Suffixes: -ng / -g linker, -t for "'t" ("apatnaput lima" = apatnapu't lima).
 */
// Tens: written as one word the -pu may be spelled -po ("limampo"); split off
// it must be "pu", so a polite "po" ("apat na po", "four, po") stays 4.
const tens = (stem, word) => [new RegExp(`\\b(?:${stem}\\s+pu|${stem}p[ou])(ng|g|t)?\\b`, 'gi'), word];

const SPELLING = [
  tens('dalawam', 'dalawampu'),
  tens('tatl[ou]m', 'tatlumpu'),
  tens('apat\\s?na', 'apatnapu'),
  tens('lima(?:ng|m)', 'limampu'),
  tens('anim\\s?na', 'animnapu'),
  tens('pit[ou]m', 'pitumpu'),
  tens('wal[ou]m', 'walumpu'),
  tens('siyam\\s?na', 'siyamnapu'),
  [/\bsamp[ou](ng|g|t)?\b/gi, 'sampu'],
  [/\btatl[ou](ng|g)?\b/gi, 'tatlo'],
  [/\bpit[ou](ng|g)?\b/gi, 'pito'],
  [/\bwal[ou](ng|g)?\b/gi, 'walo']
];

function standardizeFilipino(text) {
  let out = text
    // "walungdaan" → "walung daan"
    .replace(/\b(isang|dalawang|tatl[ou]ng|apat\s?na|limang|anim\s?na|pit[ou]ng|wal[ou]ng|siyam\s?na)(daan|raan|libo)\b/gi, '$1 $2')
    // "Nagbentakay" → "Nagbenta kay", "kayaling Nena" → "kay aling Nena"
    .replace(/\b(nagbenta|binenta|benta|ibinenta|sold)kay\b/gi, '$1 kay')
    .replace(/\bkay(aling|mang|kuya|ate|ka)\b/gi, 'kay $1')
    .replace(/\bna\s(matay)\b/gi, 'na$1');
  for (const [pattern, word] of SPELLING) {
    out = out.replace(pattern, (_, suffix = '') => `${word}${suffix.toLowerCase() === 't' ? "'t" : suffix}`);
  }
  // Before p/b the -ng linker is said -m ("tatlong patay" → "tatlum patay",
  // written "tatlumpatay"); runs after the tens so "limampu" stays 50
  return out.replace(/\b(isa|dalawa|tatl[ou]|lima|pit[ou]|wal[ou])m(?!pu)\s?(?=[pb])/gi, (_, n) => `${n.replace(/u$/i, 'o')}ng `);
}

/** "100 at 20" → 120, "200 at 45" → 245: digits and number words said together. */
function joinSpokenParts(text) {
  return text.replace(/\b(\d+)\s+(?:at|and)\s+(\d+)\b(?![.,]\d)/gi, (all, a, b) => {
    const [big, small] = [Number(a), Number(b)];
    const fits = (scale) => big >= scale && big % scale === 0 && small < scale;
    return fits(1000) || fits(100) ? String(big + small) : all;
  });
}

/**
 * Rewrite a spoken sentence into the logbook wording the rules read:
 * number words → digits, kilo → kg, "118 pesos per kilo" → "118/kg",
 * "850 pesos" → "₱850", "ika-26 ng Oktubre" → "Oktubre 26".
 */
export function normalizeSpoken(text) {
  const words = standardizeFilipino(String(text || '').trim().replace(/\s+/g, ' '))
    .replace(/'t\b/g, ' at') // "dalawampu't lima"
    .replace(/\blabi(?:ng|n|m)[\s-]?(isa|dalawa|tatlo|apat|lima|anim|pito|walo|siyam)\b/gi, (_, u) => String(FIL_TEENS[u.toLowerCase()]))
    // "2 daan" (a digit with a Filipino or English hundred) → 200
    .replace(/\b(\d+)\s+(?:daan|raan|hundred)(?:g|ng)?\b/gi, (_, n) => String(Number(n) * 100))
    .replace(NUM_RUN, (run) => String(runValue(run)));
  return joinSpokenParts(words)
    .replace(/(\d+(?:\.\d+)?)\s*(?:k|thousand|libo)\b/gi, (_, n) => String(Math.round(Number(n) * 1000)))
    .replace(/(\d),(?=\d{3}\b)/g, '$1') // "12,500" → "12500" so later steps see one number
    .replace(/\b(?:kilos?|kilograms?|kilogramo|kgs)\b/gi, 'kg')
    .replace(/(\d+(?:\.\d+)?)\s*(?:pesos?|piso)?\s+(?:per|kada|bawat|a|an|isang|1)\s*kg\b/gi, '$1/kg')
    .replace(/\btig-?\s*(?=\d)/gi, '@')
    .replace(/(\d+(?:\.\d+)?)\s*(?:pesos?|piso)\b/gi, '₱$1')
    .replace(/\b(?:ika-?\s*)?(\d{1,2})(?:st|nd|rd|th)?\s+(?:ng|of)\s+([a-z]{3,})/gi, (all, d, mon) => (parseDate(`${mon} ${d}`, '2000-12-31') ? `${mon} ${d}` : all))
    .replace(/\b(\d{1,2})(?:st|nd|rd|th)\b/gi, '$1')
    .replace(/\bbatch\s*(\d{4})\s+(\d{1,2})\b/gi, (_, y, m) => `Batch ${y}-${pad(Number(m))}`)
    // "May 3 patay" said aloud is "there are 3 dead", not May 3
    .replace(/^may\s+(?=\d+\s+(?:na\s+)?(?:patay|namatay|manok|ulo|heads?|sako|kg|birds?|chickens?)\b)/i, 'meron ')
    .trim();
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
