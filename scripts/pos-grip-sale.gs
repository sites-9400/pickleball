// Log a grip sale into the POS sheet from Jude's iPhone Shortcut.
// Runs as its own standalone Apps Script project (script.google.com → New
// project), NOT inside the sheet's existing Apps Script, which already has a
// doPost of its own. Deploy → New deployment → Web app
// (Execute as: Me, Who has access: Anyone).
// Spec: docs/superpowers/specs/2026-10-07-grip-sale-shortcut-design.md
//
// GS_KEY is a shared secret with the Shortcut. Never commit the real one
// (this repo is public).

const GS_KEY = 'PASTE_KEY_HERE';
const GS_SHEET_ID = '1uOQwQraDg4DbG6lK_6FswPoM8dwv9sNJKjzejGELkPI'; // LOCO
const GS_TAB = 'POS - Grips';
const GS_STOCK_FIRST = 7, GS_STOCK_LAST = 18; // B:G — model, color, price, initial, sold, available
const GS_LOG_FIRST = 23, GS_LOG_LAST = 113;   // stock SUMIFS only count rows 23–113
const GS_PAYMENTS = ['Cash', 'GCash', 'Maribank'];
const GS_NOT_PAID = 'Not paid yet';
const GS_TZ = 'Asia/Manila';

function gs_reply(text) {
  return ContentService.createTextOutput(text).setMimeType(ContentService.MimeType.TEXT);
}

// "Tough Cookie (dry overgrip, sweat-resistant)" → "Tough Cookie"
function gs_shortModel(model) {
  return String(model).split(' (')[0].trim();
}

function gs_stockRows(sheet) {
  const n = GS_STOCK_LAST - GS_STOCK_FIRST + 1;
  return sheet.getRange(GS_STOCK_FIRST, 2, n, 6).getValues()
    .map(r => ({ model: r[0], color: r[1], price: Number(r[2]) || 0, left: Number(r[5]) || 0 }))
    .filter(r => String(r.model).trim() && String(r.color).trim());
}

function gs_label(s) {
  return gs_shortModel(s.model) + ' · ' + s.color;
}

function doGet(e) {
  if (!e || !e.parameter || e.parameter.key !== GS_KEY) return gs_reply('Not allowed');
  const sheet = SpreadsheetApp.openById(GS_SHEET_ID).getSheetByName(GS_TAB);
  const lines = gs_stockRows(sheet).filter(s => s.left > 0).map(s => gs_label(s) + ' · ' + s.left + ' left');
  return gs_reply(lines.length ? lines.join('\n') : 'No grips in stock');
}

function doPost(e) {
  let p;
  try { p = JSON.parse(e.postData.contents); } catch (err) { return gs_reply('Not logged: bad request'); }
  if (p.key !== GS_KEY) return gs_reply('Not allowed');

  const item = String(p.item || '').replace(/ · \d+ left$/, '').trim();
  const qty = Number(p.qty);
  const name = String(p.name || '').trim();
  const payment = String(p.payment || '').trim();

  if (!name) return gs_reply('Not logged: customer name is empty');
  if (!Number.isInteger(qty) || qty < 1) return gs_reply('Not logged: qty must be 1 or more');
  if (payment !== GS_NOT_PAID && GS_PAYMENTS.indexOf(payment) === -1) return gs_reply('Not logged: unknown payment "' + payment + '"');

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return gs_reply('Not logged: sheet busy, try again');
  try {
    const sheet = SpreadsheetApp.openById(GS_SHEET_ID).getSheetByName(GS_TAB);
    const s = gs_stockRows(sheet).find(r => gs_label(r) === item);
    if (!s) return gs_reply('Not logged: grip not found "' + item + '"');
    if (qty > s.left) return gs_reply('Not logged: only ' + s.left + ' left of ' + item);

    // First row where every column we write is blank. G, H, K are array-formula
    // spill columns and N is a helper formula, so they are never read or written.
    const n = GS_LOG_LAST - GS_LOG_FIRST + 1;
    const log = sheet.getRange(GS_LOG_FIRST, 2, n, 11).getValues(); // B:L
    const blank = v => String(v).trim() === '';
    let idx = -1;
    for (let i = 0; i < n; i++) {
      const r = log[i]; // B=0 C=1 D=2 E=3 F=4 I=7 J=8 L=10
      if ([0, 1, 2, 3, 4, 7, 8, 10].every(c => blank(r[c]))) { idx = i; break; }
    }
    if (idx === -1) return gs_reply('Not logged: log is full, tell Eve');
    const row = GS_LOG_FIRST + idx;

    const paid = payment !== GS_NOT_PAID;
    const amount = paid ? qty * s.price : 0;
    const today = Utilities.formatDate(new Date(), GS_TZ, 'yyyy-MM-dd');
    sheet.getRange(row, 2, 1, 5).setValues([[today, name, s.model, s.color, qty]]); // B:F
    sheet.getRange(row, 9, 1, 2).setValues([[paid ? payment : '', amount]]);       // I:J
    sheet.getRange(row, 12).setValue(paid ? 'Paid' : 'Unpaid');                     // L
    SpreadsheetApp.flush();

    const left = s.left - qty;
    return gs_reply('Logged: ' + qty + ' × ' + item + ' for ' + name +
      (paid ? ' · ₱' + amount + ' ' + payment : ' · NOT PAID ₱' + qty * s.price) +
      ' · ' + left + ' left');
  } finally {
    lock.releaseLock();
  }
}
