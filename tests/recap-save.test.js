// Recap "Save image" on phones. Root cause of the iOS failures (Safari AND Chrome —
// both are WebKit on iOS): a synthetic <a download> click on a data:/blob: URL is
// ignored or silently dropped, and inside the installed PWA (display:standalone)
// downloads never work. The only route to "Save Image → Photos" is the share sheet
// (navigator.share with a File), and it must be invoked synchronously inside the
// tap — any await first (script load, html2canvas, toBlob) lets the transient user
// activation expire and iOS drops the sheet without an error.
//
// These tests drive PDRecap.saveImage with a fake DOM + injected PNG producer and
// assert the delivery strategy per environment and the sync-inside-the-tap rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../recap.js';

const { pickSaveStrategy, saveImage } = globalThis.PDRecap;

// ---- pure strategy chooser -------------------------------------------------
test('pickSaveStrategy: iOS with file sharing → share sheet (Save Image → Photos)', () => {
  assert.equal(pickSaveStrategy({ isIOS: true, canShareFiles: true, coarse: true }), 'share');
});
test('pickSaveStrategy: iOS without file sharing (e.g. some WKWebView browsers) → preview for press-and-hold', () => {
  assert.equal(pickSaveStrategy({ isIOS: true, canShareFiles: false, coarse: true }), 'preview');
});
test('pickSaveStrategy: other touch devices with file sharing → share sheet', () => {
  assert.equal(pickSaveStrategy({ isIOS: false, canShareFiles: true, coarse: true }), 'share');
});
test('pickSaveStrategy: desktop → plain download', () => {
  assert.equal(pickSaveStrategy({ isIOS: false, canShareFiles: true, coarse: false }), 'download');
  assert.equal(pickSaveStrategy({ isIOS: false, canShareFiles: false, coarse: false }), 'download');
});

// ---- fake DOM ----------------------------------------------------------------
function fakeEl(tag) {
  const el = {
    tagName: tag, style: {}, textContent: '', className: '', children: [], parentNode: null,
    disabled: false, href: '', download: '', clicks: 0, listeners: {},
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html || ''; },
    appendChild(c) { c.parentNode = el; el.children.push(c); return c; },
    removeChild(c) { el.children = el.children.filter(x => x !== c); c.parentNode = null; },
    querySelector() { return null; }, querySelectorAll() { return []; },
    cloneNode() { return fakeEl(tag); },
    addEventListener(t, fn) { (el.listeners[t] ||= []).push(fn); },
    click() { el.clicks++; },
    setAttribute() {}, getAttribute() { return null; },
  };
  return el;
}
function fakeDom() {
  const body = fakeEl('body');
  const created = [];
  const document = {
    body,
    createElement(tag) { const e = fakeEl(tag); created.push(e); return e; },
    head: fakeEl('head'),
  };
  return { document, body, created };
}
const flush = () => new Promise(r => setTimeout(r, 0));

// A ready PNG: what the producer resolves to.
function readyPng() {
  return { file: { name: 'recap.png', type: 'image/png', size: 3 }, url: 'blob:test/png' };
}

// Helper: build the opts saveImage accepts for tests (env + png producer + share fn).
function setup(env, { pngReady = true, share } = {}) {
  const dom = fakeDom();
  const card = fakeEl('div');
  const btn = fakeEl('button'); btn.textContent = '⬇ Save image';
  const calls = { produce: 0, share: [] };
  const shareFn = share || (() => Promise.resolve());
  const opts = {
    document: dom.document,
    env,
    share: (d) => { calls.share.push(d); return shareFn(d); },
    producePng: () => { calls.produce++; return Promise.resolve(readyPng()); },
    cache: pngReady ? { png: readyPng() } : {},
  };
  return { dom, card, btn, calls, opts };
}

// ---- share path ----------------------------------------------------------------
test('iOS + PNG ready: tap calls navigator.share SYNCHRONOUSLY with the PNG File', () => {
  const { card, btn, calls, opts } = setup({ isIOS: true, canShareFiles: true, coarse: true });
  saveImage(card, btn, opts);
  // No await yet — the share must already have been requested inside the tap.
  assert.equal(calls.share.length, 1);
  assert.equal(calls.share[0].files[0].type, 'image/png');
  assert.equal(calls.produce, 0, 'a ready PNG is delivered without re-rendering');
});

test('iOS + PNG ready: user cancelling the share sheet (AbortError) is not an error → no preview overlay', async () => {
  const err = Object.assign(new Error('abort'), { name: 'AbortError' });
  const { dom, card, btn, opts } = setup({ isIOS: true, canShareFiles: true, coarse: true }, { share: () => Promise.reject(err) });
  saveImage(card, btn, opts);
  await flush();
  assert.equal(dom.body.children.filter(c => c.classList.contains('pdr-ovl')).length, 0);
  assert.equal(btn.disabled, false);
});

test('iOS + share refused (NotAllowedError / activation lost) → falls back to the press-and-hold preview overlay', async () => {
  const err = Object.assign(new Error('nope'), { name: 'NotAllowedError' });
  const { dom, card, btn, opts } = setup({ isIOS: true, canShareFiles: true, coarse: true }, { share: () => Promise.reject(err) });
  saveImage(card, btn, opts);
  await flush();
  const ovl = dom.body.children.find(c => c.classList.contains('pdr-ovl'));
  assert.ok(ovl, 'overlay appended to body');
  assert.match(ovl.innerHTML, /blob:test\/png/);
  assert.match(ovl.innerHTML, /Save to Photos/i);
});

// ---- not-ready path: never auto-fire after async on iOS -------------------------
test('iOS + PNG not ready: tap renders, then arms the button for a SECOND tap (no auto-share after await)', async () => {
  const { card, btn, calls, opts } = setup({ isIOS: true, canShareFiles: true, coarse: true }, { pngReady: false });
  saveImage(card, btn, opts);
  assert.equal(calls.share.length, 0);
  assert.equal(btn.disabled, true);
  await flush(); await flush();
  assert.equal(calls.produce, 1);
  assert.equal(calls.share.length, 0, 'must NOT call share after an await — iOS would drop it');
  assert.equal(btn.disabled, false);
  assert.match(btn.textContent, /tap/i, 'button invites the second tap');
  assert.ok(opts.cache.png, 'rendered PNG cached for the second tap');
  // Second tap: delivered synchronously from cache.
  saveImage(card, btn, opts);
  assert.equal(calls.share.length, 1);
  assert.equal(calls.produce, 1);
});

// ---- preview path (iOS browser that cannot share files) ------------------------
test('iOS without file share + PNG ready: tap opens the preview overlay (press-and-hold → Save to Photos)', () => {
  const { dom, card, btn, calls, opts } = setup({ isIOS: true, canShareFiles: false, coarse: true });
  saveImage(card, btn, opts);
  assert.equal(calls.share.length, 0);
  assert.ok(dom.body.children.find(c => c.classList.contains('pdr-ovl')));
});

// ---- desktop path ----------------------------------------------------------------
test('desktop: tap downloads via an <a download> pointing at the blob URL (async is fine here)', async () => {
  const { dom, card, btn, calls, opts } = setup({ isIOS: false, canShareFiles: false, coarse: false }, { pngReady: false });
  saveImage(card, btn, opts);
  await flush(); await flush();
  const a = dom.created.find(e => e.tagName === 'a' && e.clicks === 1);
  assert.ok(a, 'anchor clicked');
  assert.equal(a.href, 'blob:test/png');
  assert.match(a.download, /^paddle-district-recap-\d{4}-\d{2}-\d{2}\.png$/);
  assert.equal(calls.share.length, 0);
  assert.equal(btn.disabled, false);
});
