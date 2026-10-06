// Log a grip sale into the POS sheet from Jude's iPhone Shortcut.
// Paste into the LOCO spreadsheet: Extensions → Apps Script, then
// Deploy → New deployment → Web app (Execute as: Me, Who has access: Anyone).
// Spec: docs/superpowers/specs/2026-10-07-grip-sale-shortcut-design.md
//
// KEY is a shared secret with the Shortcut. Never commit the real one
// (this repo is public).

const KEY = 'PASTE_KEY_HERE';
const TAB = 'POS - Grips';
const STOCK_FIRST = 7, STOCK_LAST = 18;   // B:G — model, color, price, initial, sold, available
const LOG_FIRST = 23, LOG_LAST = 113;     // stock SUMIFS only count rows 23–113
const PAYMENTS = ['Cash', 'GCash', 'Maribank'];
const NOT_PAID = 'Not paid yet';
const TZ = 'Asia/Manila';

function reply(text) {
  return ContentService.createTextOutput(text).setMimeType(ContentService.MimeType.TEXT);
}

// "Tough Cookie (dry overgrip, sweat-resistant)" → "Tough Cookie"
function shortModel(model) {
  return String(model).split(' (')[0].trim();
}

function stockRows(sheet) {
  const n = STOCK_LAST - STOCK_FIRST + 1;
  return sheet.getRange(STOCK_FIRST, 2, n, 6).getValues()
    .map(r => ({ model: r[0], color: r[1], price: Number(r[2]) || 0, left: Number(r[5]) || 0 }))
    .filter(r => String(r.model).trim() && String(r.color).trim());
}

function label(s) {
  return shortModel(s.model) + ' · ' + s.color;
}

function doGet(e) {
  if (!e || !e.parameter || e.parameter.key !== KEY) return reply('Not allowed');
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TAB);
  const lines = stockRows(sheet).filter(s => s.left > 0).map(s => label(s) + ' · ' + s.left + ' left');
  return reply(lines.length ? lines.join('\n') : 'No grips in stock');
}

function doPost(e) {
  let p;
  try { p = JSON.parse(e.postData.contents); } catch (err) { return reply('Not logged: bad request'); }
  if (p.key !== KEY) return reply('Not allowed');

  const item = String(p.item || '').replace(/ · \d+ left$/, '').trim();
  const qty = Number(p.qty);
  const name = String(p.name || '').trim();
  const payment = String(p.payment || '').trim();

  if (!name) return reply('Not logged: customer name is empty');
  if (!Number.isInteger(qty) || qty < 1) return reply('Not logged: qty must be 1 or more');
  if (payment !== NOT_PAID && PAYMENTS.indexOf(payment) === -1) return reply('Not logged: unknown payment "' + payment + '"');

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return reply('Not logged: sheet busy, try again');
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TAB);
    const s = stockRows(sheet).find(r => label(r) === item);
    if (!s) return reply('Not logged: grip not found "' + item + '"');
    if (qty > s.left) return reply('Not logged: only ' + s.left + ' left of ' + item);

    // First row where every column we write is blank. G, H, K are array-formula
    // spill columns and N is a helper formula, so they are never read or written.
    const n = LOG_LAST - LOG_FIRST + 1;
    const log = sheet.getRange(LOG_FIRST, 2, n, 11).getValues(); // B:L
    const blank = v => String(v).trim() === '';
    let idx = -1;
    for (let i = 0; i < n; i++) {
      const r = log[i]; // B=0 C=1 D=2 E=3 F=4 I=7 J=8 L=10
      if ([0, 1, 2, 3, 4, 7, 8, 10].every(c => blank(r[c]))) { idx = i; break; }
    }
    if (idx === -1) return reply('Not logged: log is full, tell Eve');
    const row = LOG_FIRST + idx;

    const paid = payment !== NOT_PAID;
    const amount = paid ? qty * s.price : 0;
    const today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
    sheet.getRange(row, 2, 1, 5).setValues([[today, name, s.model, s.color, qty]]); // B:F
    sheet.getRange(row, 9, 1, 2).setValues([[paid ? payment : '', amount]]);       // I:J
    sheet.getRange(row, 12).setValue(paid ? 'Paid' : 'Unpaid');                     // L
    SpreadsheetApp.flush();

    const left = s.left - qty;
    return reply('Logged: ' + qty + ' × ' + item + ' for ' + name +
      (paid ? ' · ₱' + amount + ' ' + payment : ' · NOT PAID ₱' + qty * s.price) +
      ' · ' + left + ' left');
  } finally {
    lock.releaseLock();
  }
}
