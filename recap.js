/* Paddle District — Open Play Recap
 * Shared end-of-session recap: podium + top 10 + QR, rendered identically in
 * view.html (player-facing ended state) and app.html (admin Recap tab).
 *
 * Exposes window.PDRecap = { buildRecapData, render, saveImage }.
 * buildRecapData is pure (no DOM) and is unit-tested in recap.test.js under Node.
 */
(function (global) {
  'use strict';

  // ---- pure helpers ----------------------------------------------------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var WD = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
  var MO = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY',
            'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];

  function fmtDate(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    return WD[d.getDay()] + ' · ' + MO[d.getMonth()] + ' ' + d.getDate();
  }

  function hm(d) { // -> {h12, mer, min}
    var h = d.getHours(), mer = h < 12 ? 'AM' : 'PM', h12 = h % 12; if (h12 === 0) h12 = 12;
    return { h12: h12, mer: mer, min: d.getMinutes() };
  }
  function pcs(p) { return p.min ? p.h12 + ':' + (p.min < 10 ? '0' : '') + p.min : '' + p.h12; }

  function fmtTimeRange(start, end) {
    if (!start) return '';
    var a = hm(new Date(start));
    if (!end) return pcs(a) + ' ' + a.mer;
    var b = hm(new Date(end));
    if (a.mer === b.mer) return pcs(a) + '–' + pcs(b) + ' ' + b.mer; // e.g. 4–9 PM
    return pcs(a) + ' ' + a.mer + '–' + pcs(b) + ' ' + b.mer;         // e.g. 10 AM–1 PM
  }

  function fmtCourts(courtDefs) {
    var defs = courtDefs || [];
    if (!defs.length) return '';
    var nums = [];
    for (var i = 0; i < defs.length; i++) {
      var m = String(defs[i].name || '').match(/\d+/);
      if (m) nums.push(parseInt(m[0], 10)); else { nums = null; break; }
    }
    if (nums && nums.length === defs.length) {
      var min = Math.min.apply(null, nums), max = Math.max.apply(null, nums);
      return min === max ? 'COURT ' + min : 'COURTS ' + min + '–' + max;
    }
    return defs.length + (defs.length === 1 ? ' COURT' : ' COURTS');
  }

  // ---- data builder (pure) ---------------------------------------------
  function buildRecapData(state, opts) {
    state = state || {}; opts = opts || {};
    var roster = (state.players || [])
      .map(function (p) {
        return {
          name: p.name,
          gamesPlayed: p.gamesPlayed || 0,
          wins: p.wins || 0,
          losses: p.losses || 0,
          diff: (p.points || 0) - (p.pointsAgainst || 0)
        };
      })
      .filter(function (p) { return p.gamesPlayed > 0; });

    // Same ranking the live standings use: wins desc, then score-diff desc, then name.
    roster.sort(function (a, b) {
      if (b.wins !== a.wins) return b.wins - a.wins;
      if (b.diff !== a.diff) return b.diff - a.diff;
      return String(a.name).localeCompare(String(b.name));
    });

    var start = state.sessionStartTime || null;
    var end = state.sessionEndTime || null;
    var now = opts.now || null;
    var durationMs = start ? ((end || now || start) - start) : 0;
    var hours = Math.max(0, Math.round(durationMs / 3600000));

    return {
      brand: 'PADDLE DISTRICT',
      title: 'OPEN PLAY RECAP',
      sessionName: state.sessionName || 'Open Play',
      dateLabel: fmtDate(start),
      timeLabel: fmtTimeRange(start, end),
      courtLabel: fmtCourts(state.courtDefs),
      stats: { games: (state.gameHistory || []).length, players: roster.length, hours: hours },
      podium: roster.slice(0, 3),
      top10: roster.slice(0, 10),
      totalPlayers: roster.length,
      viewUrl: opts.viewUrl || ''
    };
  }

  // ---- rendering (browser only) ----------------------------------------
  var CSS = [
    '.pdr{--pdr-forest:#14331e;--pdr-forest2:#1e4a2c;--pdr-cream:#f7f4ea;--pdr-panel:#fff;',
    '--pdr-gold:#d4a017;--pdr-army:#4a5c2f;--pdr-ink:#20241a;--pdr-muted:#7c806d;--pdr-line:#e8e5d6;',
    "font-family:'Montserrat',-apple-system,Segoe UI,Roboto,sans-serif;color:var(--pdr-ink);",
    'background:var(--pdr-cream);border-radius:16px;overflow:hidden;box-shadow:0 10px 34px rgba(20,30,15,.18);',
    'max-width:680px;margin:0 auto;container-type:inline-size;}',
    '.pdr *{box-sizing:border-box;}',
    '.pdr-hmain{padding-right:104px;}', // reserve room for the QR in wide layout
    // hero
    '.pdr-hero{position:relative;background:linear-gradient(150deg,var(--pdr-forest2),var(--pdr-forest) 62%);color:#fff;padding:22px 22px 20px;}',
    '.pdr-hero::after{content:"";position:absolute;inset:0;background:radial-gradient(120% 90% at 85% -10%,rgba(143,179,57,.18),transparent 55%);pointer-events:none;}',
    '.pdr-eyebrow{font-size:.66rem;font-weight:800;letter-spacing:.22em;opacity:.9;text-transform:uppercase;}',
    '.pdr-meta{font-size:.64rem;font-weight:700;letter-spacing:.13em;color:var(--pdr-gold);margin-top:14px;text-transform:uppercase;}',
    '.pdr-title{font-size:2.5rem;line-height:.95;font-weight:900;letter-spacing:-.01em;margin-top:6px;text-transform:uppercase;}',
    '.pdr-title span{color:#a9cf5a;}',
    '.pdr-statrow{display:flex;gap:20px;margin-top:16px;flex-wrap:wrap;}',
    '.pdr-stat b{font-size:1.5rem;font-weight:900;}',
    '.pdr-stat i{font-style:normal;font-size:.62rem;font-weight:700;letter-spacing:.1em;opacity:.82;text-transform:uppercase;margin-left:5px;}',
    '.pdr-qr{position:absolute;top:20px;right:20px;background:#fff;border-radius:10px;padding:7px 7px 4px;text-align:center;width:96px;}',
    '.pdr-qr canvas,.pdr-qr img{width:80px!important;height:80px!important;display:block;}',
    '.pdr-qr small{display:block;font-size:.44rem;font-weight:800;letter-spacing:.06em;color:var(--pdr-army);margin-top:3px;line-height:1.15;text-transform:uppercase;}',
    '@container (max-width:520px){.pdr-hmain{padding-right:0;}.pdr-qr{position:static;width:auto;display:inline-flex;gap:9px;align-items:center;text-align:left;margin-top:16px;padding:6px 10px 6px 6px;}.pdr-qr small{margin-top:0;max-width:80px;}.pdr-title{font-size:2rem;}}',
    // podium
    '.pdr-body{padding:18px 20px 8px;}',
    '.pdr-sec{display:flex;align-items:baseline;justify-content:space-between;margin:2px 0 12px;}',
    '.pdr-sec h3{font-size:.82rem;font-weight:900;letter-spacing:.16em;text-transform:uppercase;}',
    '.pdr-sec span{font-size:.6rem;font-weight:700;letter-spacing:.08em;color:var(--pdr-muted);text-transform:uppercase;}',
    '.pdr-podium{display:grid;grid-template-columns:1fr 1.12fr 1fr;gap:10px;align-items:end;}',
    '.pdr-pod{background:var(--pdr-panel);border:1px solid var(--pdr-line);border-radius:13px;padding:14px 8px 13px;text-align:center;}',
    '.pdr-pod.champ{background:linear-gradient(180deg,#fbf3d7,#fff);border-color:#eBd493;box-shadow:0 6px 16px rgba(212,160,23,.16);padding-top:18px;padding-bottom:16px;}',
    '.pdr-medal{font-size:1.5rem;line-height:1;}',
    '.pdr-pod.champ .pdr-medal{font-size:1.8rem;}',
    '.pdr-nm{font-weight:800;font-size:.92rem;margin-top:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    '.pdr-pod.champ .pdr-nm{font-size:1.02rem;}',
    '.pdr-place{font-size:.54rem;font-weight:800;letter-spacing:.12em;color:var(--pdr-muted);text-transform:uppercase;margin-top:2px;}',
    '.pdr-pod.champ .pdr-place{color:var(--pdr-gold);}',
    '.pdr-wins{font-size:1.9rem;font-weight:900;color:var(--pdr-army);line-height:1;margin-top:8px;}',
    '.pdr-pod.champ .pdr-wins{font-size:2.3rem;}',
    '.pdr-wins i{font-style:normal;font-size:.5rem;font-weight:800;letter-spacing:.14em;color:var(--pdr-muted);display:block;margin-top:3px;}',
    '.pdr-sub{font-size:.62rem;font-weight:700;color:var(--pdr-muted);margin-top:7px;}',
    '.pdr-sub b{color:var(--pdr-army);}',
    // top 10
    '.pdr-top{margin-top:20px;display:grid;grid-template-columns:1fr 1fr;gap:2px 22px;}',
    '@container (max-width:520px){.pdr-top{grid-template-columns:1fr;}}',
    '.pdr-row{display:flex;align-items:center;gap:9px;padding:7px 4px;border-bottom:1px solid var(--pdr-line);}',
    '.pdr-rk{font-size:.72rem;font-weight:800;color:var(--pdr-muted);width:20px;text-align:center;flex-shrink:0;}',
    '.pdr-row.medal .pdr-rk{font-size:.95rem;}',
    '.pdr-rn{font-weight:700;font-size:.86rem;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    '.pdr-rw{font-weight:900;color:var(--pdr-army);font-size:.98rem;}',
    '.pdr-rm{font-size:.58rem;font-weight:700;color:var(--pdr-muted);letter-spacing:.03em;white-space:nowrap;}',
    // footer + actions
    '.pdr-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 20px 18px;color:var(--pdr-muted);}',
    '.pdr-foot b{color:var(--pdr-ink);font-weight:900;letter-spacing:.02em;}',
    '.pdr-foot .r{font-size:.58rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;text-align:right;}',
    '.pdr-actions{padding:0 20px 18px;}',
    '.pdr-save{width:100%;border:none;border-radius:9px;background:var(--pdr-army);color:#fff;font-family:inherit;font-weight:800;font-size:.82rem;letter-spacing:.03em;padding:12px;cursor:pointer;transition:filter .15s;}',
    '.pdr-save:hover{filter:brightness(1.08);}',
    '.pdr-save:disabled{opacity:.6;cursor:default;}',
    '.pdr-empty{padding:40px 20px;text-align:center;color:var(--pdr-muted);font-weight:600;}'
  ].join('');

  function injectCSS() {
    if (typeof document === 'undefined') return;
    if (document.getElementById('pd-recap-css')) return;
    var st = document.createElement('style');
    st.id = 'pd-recap-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  var MEDALS = ['🥇', '🥈', '🥉'];
  var PLACES = ['CHAMPION', '2ND PLACE', '3RD PLACE'];

  function podStats(p) {
    var d = p.diff, ds = d > 0 ? '+' + d : d === 0 ? '±0' : '' + d;
    return '<div class="pdr-sub">' + p.gamesPlayed + ' GP · <b>' + ds + '</b></div>';
  }

  function podCard(p, i) {
    if (!p) return '<div></div>';
    return '<div class="pdr-pod' + (i === 0 ? ' champ' : '') + '">' +
      '<div class="pdr-medal">' + MEDALS[i] + '</div>' +
      '<div class="pdr-nm">' + esc(p.name) + '</div>' +
      '<div class="pdr-place">' + PLACES[i] + '</div>' +
      '<div class="pdr-wins">' + p.wins + '<i>WINS</i></div>' +
      podStats(p) + '</div>';
  }

  function topRow(p, i) {
    var d = p.diff, ds = d > 0 ? '+' + d : d === 0 ? '±0' : '' + d;
    var rk = i < 3 ? MEDALS[i] : (i + 1);
    return '<div class="pdr-row' + (i < 3 ? ' medal' : '') + '">' +
      '<span class="pdr-rk">' + rk + '</span>' +
      '<span class="pdr-rn">' + esc(p.name) + '</span>' +
      '<span class="pdr-rw">' + p.wins + '</span>' +
      '<span class="pdr-rm">' + p.gamesPlayed + ' GP · ' + ds + '</span></div>';
  }

  function render(container, state, opts) {
    injectCSS();
    var r = buildRecapData(state, opts || {});
    if (!r.podium.length) {
      container.innerHTML = '<div class="pdr"><div class="pdr-empty">🏆<br>The recap appears once games have been played.</div></div>';
      return r;
    }
    var meta = [r.dateLabel, r.timeLabel, r.courtLabel].filter(Boolean).join('  ·  ');
    var hoursLabel = r.stats.hours === 1 ? 'HOUR' : 'HOURS';
    var showAll = r.totalPlayers > 10 ? ('scan for all ' + r.totalPlayers + ' players') : 'ranked by wins';

    var html = '' +
      '<div class="pdr" id="pdr-card">' +
        '<div class="pdr-hero">' +
          (r.viewUrl ? '<div class="pdr-qr"><div class="pdr-qrcode"></div><small>Scan for full results</small></div>' : '') +
          '<div class="pdr-hmain">' +
            '<div class="pdr-eyebrow">' + esc(r.brand) + '</div>' +
            (meta ? '<div class="pdr-meta">' + esc(meta) + '</div>' : '') +
            '<div class="pdr-title">OPEN PLAY <span>RECAP</span></div>' +
            '<div class="pdr-statrow">' +
              '<div class="pdr-stat"><b>' + r.stats.games + '</b><i>GAMES</i></div>' +
              '<div class="pdr-stat"><b>' + r.stats.players + '</b><i>PLAYERS</i></div>' +
              '<div class="pdr-stat"><b>' + r.stats.hours + '</b><i>' + hoursLabel + '</i></div>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="pdr-body">' +
          '<div class="pdr-sec"><h3>Podium</h3><span>ranked by wins</span></div>' +
          '<div class="pdr-podium">' +
            podCard(r.podium[1], 1) + podCard(r.podium[0], 0) + podCard(r.podium[2], 2) +
          '</div>' +
          '<div class="pdr-sec" style="margin-top:22px"><h3>Top ' + Math.min(10, r.top10.length) + ' · Most Wins</h3><span>' + esc(showAll) + '</span></div>' +
          '<div class="pdr-top">' + r.top10.map(topRow).join('') + '</div>' +
        '</div>' +
        '<div class="pdr-foot"><div>See you next <b>OPEN PLAY</b></div><div class="r">Paddle District</div></div>' +
        '<div class="pdr-actions"><button class="pdr-save" type="button">⬇ Save image</button></div>' +
      '</div>';

    container.innerHTML = html;

    // QR — reuse the qrcodejs lib the host pages already load.
    if (r.viewUrl) genQR(container.querySelector('.pdr-qrcode'), r.viewUrl);

    // Save-as-image
    var btn = container.querySelector('.pdr-save');
    if (btn) btn.addEventListener('click', function () { saveImage(container.querySelector('#pdr-card'), btn); });

    return r;
  }

  function genQR(el, url, tries) {
    if (!el) return;
    tries = tries || 0;
    if (!global.QRCode) { if (tries < 12) setTimeout(function () { genQR(el, url, tries + 1); }, 300); return; }
    el.innerHTML = '';
    try {
      new global.QRCode(el, { text: url, width: 80, height: 80, colorDark: '#14331e', colorLight: '#ffffff', correctLevel: global.QRCode.CorrectLevel.M });
    } catch (e) { /* leave blank on failure */ }
  }

  // Lazy-load html2canvas, snapshot the card, trigger a PNG download.
  var H2C = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
  function loadH2C() {
    return new Promise(function (resolve, reject) {
      if (global.html2canvas) return resolve(global.html2canvas);
      var s = document.createElement('script');
      s.src = H2C; s.onload = function () { resolve(global.html2canvas); };
      s.onerror = function () { reject(new Error('load failed')); };
      document.head.appendChild(s);
    });
  }
  function saveImage(card, btn) {
    if (!card) return;
    var label = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Rendering…'; }
    loadH2C().then(function (h2c) {
      return h2c(card, { backgroundColor: '#f7f4ea', scale: Math.min(3, (global.devicePixelRatio || 1) * 2), useCORS: true });
    }).then(function (canvas) {
      var a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = 'paddle-district-recap-' + new Date().toISOString().slice(0, 10) + '.png';
      a.click();
      if (btn) { btn.disabled = false; btn.textContent = label; }
    }).catch(function () {
      if (btn) { btn.disabled = false; btn.textContent = 'Save unavailable — use the QR'; setTimeout(function(){ btn.textContent = label; }, 2600); }
    });
  }

  var api = { buildRecapData: buildRecapData, render: render, saveImage: saveImage };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.PDRecap = api;
  else if (typeof globalThis !== 'undefined') globalThis.PDRecap = api; // Node ESM test hook
})(typeof window !== 'undefined' ? window : globalThis);
