/**
 * ───────────────────────────────
 *  Base Script : Bang Dika Ardnt
 *  Recode By   : Bang Wilykun
 *  WhatsApp    : 6289688206739
 *  Telegram    : @Wilykun1994
 * ───────────────────────────────
 *  Script ini khusus donasi/VIP
 *  Support dari kalian bikin saya
 *  makin semangat update fitur,
 *  fix bug, dan rawat script ini.
 *
 *  Dilarang menjual ulang script ini
 *  Tanpa izin resmi dari developer.
 *  Jika ketahuan = NO UPDATE / NO FIX
 *
 *  Hargai karya, gunakan dengan bijak.
 *  Terima kasih sudah support.
 * ───────────────────────────────
 */
'use strict';

const { cekHP } = require('./cekhp.cjs');

const SHORT_LABELS = {
  'Layar':         { cat: 'Display',       keys: ['Size'] },
  'Resolusi':      { cat: 'Display',       keys: ['Resolution'] },
  'Refresh Rate':  { cat: 'Display',       keys: ['Type'] },
  'OS':            { cat: 'Platform',      keys: ['OS'] },
  'Chipset':       { cat: 'Platform',      keys: ['Chipset'] },
  'CPU':           { cat: 'Platform',      keys: ['CPU'] },
  'GPU':           { cat: 'Platform',      keys: ['GPU'] },
  'RAM & Storage': { cat: 'Memory',        keys: ['Internal'] },
  'Kamera Utama':  { cat: 'Main Camera',   keys: ['Triple', 'Quad', 'Dual', 'Single'] },
  'Kamera Depan':  { cat: 'Selfie camera', keys: ['Single', 'Dual'] },
  'Baterai':       { cat: 'Battery',       keys: ['Type'] },
  'Charging':      { cat: 'Battery',       keys: ['Charging'] },
  'Dimensi':       { cat: 'Body',          keys: ['Dimensions'] },
  'Berat':         { cat: 'Body',          keys: ['Weight'] },
  'NFC':           { cat: 'Comms',         keys: ['NFC'] },
  '5G':            { cat: 'Network',       keys: ['Technology'] },
  'Rilis':         { cat: 'Launch',        keys: ['Announced'] },
};

function getSpec(specs, cat, keys) {
  const catData = specs[cat];
  if (!catData) return null;
  for (const k of keys) {
    if (catData[k] && catData[k] !== '-') {
      return catData[k].split('\n')[0].trim().split('(')[0].trim();
    }
  }
  return null;
}

function shortVal(val, max = 35) {
  if (!val) return '—';
  const s = String(val).trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function formatComparison(a, b) {
  const priceA = a.priceInfo?.raw ? a.priceInfo.raw.slice(0, 30) : '—';
  const priceB = b.priceInfo?.raw ? b.priceInfo.raw.slice(0, 30) : '—';

  const idrA = a.priceInfo?.idr
    ? 'Rp ' + Math.round(a.priceInfo.idr).toLocaleString('id-ID')
    : null;
  const idrB = b.priceInfo?.idr
    ? 'Rp ' + Math.round(b.priceInfo.idr).toLocaleString('id-ID')
    : null;

  const nameA = a.name || 'HP A';
  const nameB = b.name || 'HP B';

  let rows = [];

  for (const [label, cfg] of Object.entries(SHORT_LABELS)) {
    const valA = getSpec(a.specs, cfg.cat, cfg.keys);
    const valB = getSpec(b.specs, cfg.cat, cfg.keys);
    if (!valA && !valB) continue;

    let winner = '';
    if (label === 'Baterai') {
      const numA = parseInt((valA || '').match(/\d+/)?.[0] || 0);
      const numB = parseInt((valB || '').match(/\d+/)?.[0] || 0);
      if (numA > numB) winner = ' 🏆';
      else if (numB > numA) winner = '';
    }

    rows.push({ label, valA: shortVal(valA), valB: shortVal(valB), winner });
  }

  let out = '';
  out += `╭─「 📱 *BANDINGKAN HP* 」\n`;
  out += `│\n`;
  out += `│ 🅰️ *${nameA}*\n`;
  out += `│ 🅱️ *${nameB}*\n`;
  out += `│\n`;
  out += `├─「 💰 *Harga Global* 」\n`;
  out += `│ 🅰️ ${priceA}\n`;
  out += `│ 🅱️ ${priceB}\n`;
  if (idrA || idrB) {
    out += `│\n`;
    out += `├─「 🇮🇩 *Estimasi IDR* 」\n`;
    if (idrA) out += `│ 🅰️ ${idrA}\n`;
    if (idrB) out += `│ 🅱️ ${idrB}\n`;
  }
  out += `│\n`;
  out += `├─「 ⚡ *Spesifikasi Utama* 」\n`;

  for (const row of rows) {
    out += `│\n`;
    out += `│ 📌 *${row.label}*\n`;
    out += `│ 🅰️ ${row.valA}${row.winner}\n`;
    out += `│ 🅱️ ${row.valB}${row.winner ? '' : (row.valA !== row.valB ? '' : '')}\n`;
  }

  out += `│\n`;
  out += `╰────────────────────\n`;
  out += `_Data dari GSMArena • Gunakan .cekhp untuk detail lengkap_`;

  return out;
}

async function bandingkanHP(queryA, queryB) {
  const [a, b] = await Promise.all([
    cekHP(queryA),
    cekHP(queryB)
  ]);
  return { a, b, text: formatComparison(a, b) };
}

module.exports = { bandingkanHP, formatComparison };
